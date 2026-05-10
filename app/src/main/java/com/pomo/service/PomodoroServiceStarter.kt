package com.pomo.service

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

public object PomodoroServiceStarter {
    private const val TAG: String = "PomodoroServiceStarter"

    public fun start(context: Context, intent: Intent = Intent(context, PomodoroService::class.java)): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            true
        } catch (e: RuntimeException) {
            Log.w(TAG, "Could not start PomodoroService", e)
            false
        }
    }
}
