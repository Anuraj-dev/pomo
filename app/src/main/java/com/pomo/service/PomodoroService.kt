package com.pomo.service

import android.app.Service
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.content.Context
import android.content.Intent
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.*
import android.util.Log
import com.google.gson.Gson
import com.pomo.db.HistoryCacheRepository
import com.pomo.network.PhoneServer
import com.pomo.timer.OfflineTimer
import com.pomo.timer.TimerObserver
import com.pomo.timer.TimerState
import com.pomo.util.UtilPreferenceManager
import com.pomo.widget.TimerWidgetProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.net.Inet4Address
import java.net.NetworkInterface

public class PomodoroService : Service(), TimerObserver {

    private val binder = LocalBinder()
    private lateinit var notificationHelper: NotificationHelper
    private lateinit var offlineTimer: OfflineTimer
    private lateinit var historyCacheRepository: HistoryCacheRepository
    private lateinit var prefs: UtilPreferenceManager
    private var currentState: TimerState = TimerState()
    private lateinit var phoneServer: PhoneServer
    private var activePhoneServerPort: Int = PhoneServer.DEFAULT_PORT
    private var currentRingtone: Ringtone? = null
    private val gson = Gson()

    private var lastSavedState: TimerState? = null

    private val serviceScope = MainScope()
    private val commandMutex = Mutex()

    public val pairingToken: String
        get() = prefs.pairingToken

    public val pairingUrl: String
        get() = "http://${getLocalIpAddress()}:${prefs.phoneServerPort}"

    private val isPhoneServerServing: Boolean
        get() = prefs.isPhoneServerEnabled && (!prefs.isPhoneServerWifiOnly || hasActiveLanNetwork())

    public val pairingPayload: String
        get() = gson.toJson(mapOf("url" to pairingUrl, "token" to pairingToken))

    public inner class LocalBinder : Binder() {
        public val service: PomodoroService
            get() = this@PomodoroService
    }

    override fun onCreate() {
        super.onCreate()
        prefs = UtilPreferenceManager(this)
        currentState.goal = prefs.dailyGoal
        notificationHelper = NotificationHelper(this)
        historyCacheRepository = HistoryCacheRepository(this)

        offlineTimer = OfflineTimer(this, prefs, historyCacheRepository, serviceScope)
        activePhoneServerPort = prefs.phoneServerPort
        phoneServer = PhoneServer(this, activePhoneServerPort)

        val savedState = prefs.loadTimerState()
        var shouldCompleteRestoredTimer = false
        if (savedState != null) {
            Log.d(TAG, "Restoring saved state: ${savedState.status} - ${savedState.remaining}s")
            if (savedState.status == TimerState.STATUS_RUNNING) {
                val now = System.currentTimeMillis() / 1000.0
                val elapsed = now - savedState.start_time
                val newRemaining = savedState.duration - elapsed

                if (newRemaining <= 0) {
                    savedState.remaining = 0.0
                    shouldCompleteRestoredTimer = true
                } else {
                    savedState.remaining = newRemaining
                }
            }
            sanitizeState(savedState)
            currentState = savedState
            if (!shouldCompleteRestoredTimer) {
                serviceScope.launch {
                    reconcileStateWithHistory()
                }
            }
        } else {
            currentState.date = historyCacheRepository.getEffectiveDateString(prefs.dayStartHour)
            sanitizeState(currentState)
            serviceScope.launch {
                currentState.completed = historyCacheRepository.getTodayCompletedCount(prefs.dayStartHour)
                offlineTimer.updateState(currentState)
                saveCurrentState()
                updateNotification()
                broadcastStateUpdate()
            }
        }

        if (savedState != null) {
            offlineTimer.updateState(currentState)
        }

        startForeground(
            NotificationHelper.NOTIFICATION_ID,
            notificationHelper.buildNotification(currentState, isPhoneServerServing),
        )

        restartPhoneServerIfNeeded()

        if (shouldCompleteRestoredTimer) {
            offlineTimer.completeExpiredTimer()
        }
    }

    private fun saveCurrentState() {
        val stateToSave = currentState.copy()
        lastSavedState = stateToSave
        prefs.saveTimerState(stateToSave)
    }

    private fun shouldSaveState(newState: TimerState): Boolean {
        val last = lastSavedState ?: return true

        if (newState.status != last.status) return true
        if (newState.phase != last.phase) return true
        if (newState.goal != last.goal) return true
        if (newState.completed != last.completed) return true
        if (newState.date != last.date) return true
        if (newState.start_time != last.start_time) return true

        if (newState.status != TimerState.STATUS_RUNNING && newState.remaining != last.remaining) {
            return true
        }

        return false
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent != null && intent.action != null) {
            handleAction(intent.action!!)
        }
        return START_STICKY
    }

    private fun handleAction(action: String) {
        when (action) {
            "TOGGLE" -> toggleTimer()
            "SKIP" -> skipTimer()
            "RECONNECT" -> Unit
        }
    }

    override fun onBind(intent: Intent): IBinder? {
        return binder
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
        phoneServer.stop()
    }

    private fun sanitizeState(state: TimerState) {
        if (state.duration <= 0) {
            when (state.phase) {
                TimerState.PHASE_WORK -> state.duration = (prefs.pomodoroDuration * 60).toDouble()
                TimerState.PHASE_SHORT -> state.duration = (prefs.shortBreakDuration * 60).toDouble()
                TimerState.PHASE_LONG -> state.duration = (prefs.longBreakDuration * 60).toDouble()
                else -> state.duration = (prefs.pomodoroDuration * 60).toDouble()
            }
        }
        if (state.remaining > state.duration) {
            state.remaining = state.duration
        }
        if (state.status == TimerState.STATUS_STOPPED && state.remaining <= 0) {
            state.remaining = state.duration
        }
        if (state.version < TimerState().version) {
            state.version = TimerState().version
        }

        if (state.next_phase == null) {
            if (TimerState.PHASE_WORK == state.phase) {
                val nextCompleted = state.completed + 1
                if (nextCompleted > 0 && nextCompleted % prefs.longBreakAfter == 0) {
                    state.next_phase = TimerState.PHASE_LONG
                } else {
                    state.next_phase = TimerState.PHASE_SHORT
                }
            } else {
                state.next_phase = TimerState.PHASE_WORK
            }
        }
    }

    private suspend fun reconcileStateWithHistory() {
        val today = historyCacheRepository.getEffectiveDateString(prefs.dayStartHour)
        val completed = historyCacheRepository.getTodayCompletedCount(prefs.dayStartHour)
        var changed = false

        if (currentState.date != today) {
            currentState.status = TimerState.STATUS_STOPPED
            currentState.phase = TimerState.PHASE_WORK
            currentState.next_phase = null
            currentState.start_time = 0.0
            currentState.duration = 0.0
            currentState.remaining = 0.0
            currentState.date = today
            currentState.last_action_time = System.currentTimeMillis() / 1000
            changed = true
        }

        if (currentState.completed != completed) {
            currentState.completed = completed
            changed = true
        }

        sanitizeState(currentState)
        offlineTimer.updateState(currentState)
        if (changed) {
            saveCurrentState()
            updateNotification()
            broadcastStateUpdate()
        }
    }

    override fun onTimerUpdate(state: TimerState) {
        this.currentState = state
        if (shouldSaveState(state)) {
            saveCurrentState()
        }
        updateNotification()
        broadcastStateUpdate()
    }

    override fun onTimerComplete(state: TimerState) {
        this.currentState = state
        saveCurrentState()
        updateNotification()
        broadcastStateUpdate()
        vibrate()
        playSound()
    }

    private fun broadcastStateUpdate() {
        val intent = Intent("com.pomo.STATE_UPDATE")
        sendBroadcast(intent)
        TimerWidgetProvider.updateAllWidgets(this, currentState)
        serviceScope.launch {
            phoneServer.broadcastState()
        }
    }

    private fun updateNotification() {
        notificationHelper.updateNotification(currentState, isPhoneServerServing)
    }

    public fun toggleTimer() {
        serviceScope.launch { toggleTimerBlocking() }
    }

    public fun skipTimer() {
        serviceScope.launch { skipTimerBlocking() }
    }

    public fun resetTimer() {
        serviceScope.launch { resetTimerBlocking() }
    }

    public fun extendTimer(minutes: Int) {
        serviceScope.launch { extendTimerBlocking(minutes) }
    }

    public suspend fun toggleTimerBlocking(): TimerState = runTimerCommand {
        offlineTimer.toggle()
    }

    public suspend fun skipTimerBlocking(): TimerState = runTimerCommand {
        offlineTimer.skip()
    }

    public suspend fun resetTimerBlocking(): TimerState = runTimerCommand {
        offlineTimer.reset()
    }

    public suspend fun extendTimerBlocking(minutes: Int): TimerState = runTimerCommand {
        offlineTimer.extend(minutes)
    }

    private suspend fun runTimerCommand(action: () -> Unit): TimerState = commandMutex.withLock {
        withContext(Dispatchers.Main) {
            reconcileDayTransitionIfNeeded(notify = false)
            action()
            currentState.copy()
        }
    }

    private suspend fun reconcileDayTransitionIfNeeded(notify: Boolean) {
        val today = historyCacheRepository.getEffectiveDateString(prefs.dayStartHour)
        if (currentState.date == today) return

        val completed = historyCacheRepository.getTodayCompletedCount(prefs.dayStartHour)

        Log.d(TAG, "Day transition detected: ${currentState.date} -> $today. Resetting state.")
        currentState.status = TimerState.STATUS_STOPPED
        currentState.phase = TimerState.PHASE_WORK
        currentState.next_phase = null
        currentState.start_time = 0.0
        currentState.duration = 0.0
        currentState.remaining = 0.0
        currentState.date = today
        currentState.last_action_time = System.currentTimeMillis() / 1000
        currentState.completed = completed

        sanitizeState(currentState)
        offlineTimer.updateState(currentState)
        saveCurrentState()

        if (notify) {
            updateNotification()
            broadcastStateUpdate()
        }
    }

    public fun updateDailyGoal() {
        val newGoal = prefs.dailyGoal
        if (currentState.goal != newGoal) {
            currentState.goal = newGoal
            saveCurrentState()
            updateNotification()
            broadcastStateUpdate()
        }
    }

    public fun syncConfig() {
        updateDailyGoal()
        restartPhoneServerIfNeeded()
        broadcastStateUpdate()
    }

    private fun restartPhoneServerIfNeeded() {
        val newPort = prefs.phoneServerPort
        val shouldServe = isPhoneServerServing
        if (!shouldServe) {
            phoneServer.stop()
            return
        }

        if (newPort == activePhoneServerPort && phoneServer.isRunning) return

        Log.d(TAG, "Restarting phone API on port $newPort")
        phoneServer.stop()
        activePhoneServerPort = newPort
        phoneServer = PhoneServer(this, activePhoneServerPort)
        phoneServer.start()
    }

    public fun rotatePairingToken(): String {
        val token = prefs.rotatePairingToken()
        restartPhoneServerIfNeeded()
        broadcastStateUpdate()
        return token
    }

    public suspend fun stateSnapshot(): TimerState = commandMutex.withLock {
        withContext(Dispatchers.Main) {
            reconcileDayTransitionIfNeeded(notify = true)
            currentState.copy()
        }
    }

    public fun getConfigPayload(): ConfigPayload {
        return ConfigPayload(
            durations = Durations(
                work = prefs.pomodoroDuration,
                short_break = prefs.shortBreakDuration,
                long_break = prefs.longBreakDuration,
            ),
            long_break_after = prefs.longBreakAfter,
            daily_goal = prefs.dailyGoal,
            day_start_hour = prefs.dayStartHour,
        )
    }

    public suspend fun applyConfigPayload(body: String): TimerState = withContext(Dispatchers.Main) {
        val config = parseConfigPayload(body)
        config.durations?.work?.takeIf { it > 0 }?.let { prefs.pomodoroDuration = it }
        config.durations?.short_break?.takeIf { it > 0 }?.let { prefs.shortBreakDuration = it }
        config.durations?.long_break?.takeIf { it > 0 }?.let { prefs.longBreakDuration = it }
        config.long_break_after?.takeIf { it > 0 }?.let { prefs.longBreakAfter = it }
        config.daily_goal?.takeIf { it >= 0 }?.let { prefs.dailyGoal = it }
        config.day_start_hour?.takeIf { it in 0..23 }?.let { prefs.dayStartHour = it }

        currentState.goal = prefs.dailyGoal
        if (currentState.status != TimerState.STATUS_RUNNING) {
            currentState.duration = getDurationForPhase(currentState.phase)
            currentState.remaining = currentState.duration
        }
        sanitizeState(currentState)
        offlineTimer.updateState(currentState)
        saveCurrentState()
        updateNotification()
        broadcastStateUpdate()
        currentState.copy()
    }

    private fun parseConfigPayload(body: String): PartialConfigPayload {
        return gson.fromJson(body, PartialConfigPayload::class.java)
            ?: throw IllegalArgumentException("config body must be a JSON object")
    }

    public suspend fun getHistoryPayload(): Map<String, HistoryCacheRepository.ServerDayEntry> {
        return historyCacheRepository.getHistoryPayload()
    }

    private fun getDurationForPhase(phase: String): Double {
        val minutes = when (phase) {
            TimerState.PHASE_WORK -> prefs.pomodoroDuration
            TimerState.PHASE_SHORT -> prefs.shortBreakDuration
            TimerState.PHASE_LONG -> prefs.longBreakDuration
            else -> prefs.pomodoroDuration
        }
        return (minutes * 60).toDouble()
    }

    private fun getLocalIpAddress(): String {
        getActiveLanIpAddress()?.let { return it }

        return try {
            NetworkInterface.getNetworkInterfaces().toList()
                .flatMap { it.inetAddresses.toList() }
                .filterIsInstance<Inet4Address>()
                .firstOrNull { !it.isLoopbackAddress && it.isSiteLocalAddress }?.hostAddress
                ?: NetworkInterface.getNetworkInterfaces().toList()
                    .flatMap { it.inetAddresses.toList() }
                    .filterIsInstance<Inet4Address>()
                    .firstOrNull { !it.isLoopbackAddress }?.hostAddress
                ?: "127.0.0.1"
        } catch (e: Exception) {
            "127.0.0.1"
        }
    }

    private fun getActiveLanIpAddress(): String? {
        return try {
            val connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val network = connectivityManager.activeNetwork ?: return null
            val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return null
            if (!capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
                !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
            ) {
                return null
            }

            connectivityManager.getLinkProperties(network)
                ?.linkAddresses
                ?.map { it.address }
                ?.filterIsInstance<Inet4Address>()
                ?.firstOrNull { !it.isLoopbackAddress && it.isSiteLocalAddress }
                ?.hostAddress
        } catch (e: Exception) {
            null
        }
    }

    private fun hasActiveLanNetwork(): Boolean {
        return try {
            val connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val network = connectivityManager.activeNetwork ?: return false
            val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
        } catch (e: Exception) {
            false
        }
    }

    private fun vibrate() {
        if (!prefs.isVibrateEnabled) return

        val v = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vibratorManager.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            v.vibrate(VibrationEffect.createOneShot(500, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            v.vibrate(500)
        }
    }

    private fun playSound() {
        if (!prefs.isSoundEnabled) return

        try {
            if (currentRingtone != null && currentRingtone!!.isPlaying) {
                currentRingtone!!.stop()
            }

            val notification = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            currentRingtone = RingtoneManager.getRingtone(applicationContext, notification)

            if (currentRingtone != null) {
                currentRingtone!!.play()
            } else {
                Log.w(TAG, "Could not get ringtone")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to play sound", e)
        }
    }

    public companion object {
        private const val TAG: String = "PomodoroService"
    }

    public data class ConfigPayload(
        val durations: Durations,
        val long_break_after: Int,
        val daily_goal: Int,
        val day_start_hour: Int,
    )

    public data class Durations(
        val work: Int,
        val short_break: Int,
        val long_break: Int,
    )

    public data class PartialConfigPayload(
        val durations: PartialDurations?,
        val long_break_after: Int?,
        val daily_goal: Int?,
        val day_start_hour: Int?,
    )

    public data class PartialDurations(
        val work: Int?,
        val short_break: Int?,
        val long_break: Int?,
    )
}
