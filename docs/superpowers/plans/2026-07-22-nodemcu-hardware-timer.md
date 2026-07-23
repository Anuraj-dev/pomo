# NodeMCU Hardware Timer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an ESP8266 NodeMCU with a 16x2 LCD, buzzer and single button mirror and control the Pomo timer over the LAN, so a silenced phone in another room still gets an audible alarm and physical controls.

**Architecture:** The device is a third thin client alongside the home-screen widget and `desktop-client/`, talking to the existing `PhoneServer` REST + WebSocket API. `PomodoroService` stays the sole write boundary — the device renders broadcast state and sends commands, never authoring timer or history state. Two additive Android changes support it: mDNS advertising so the device finds the phone by name instead of a hardcoded IP, and a `phase_complete` WebSocket event so the buzzer can distinguish a natural completion from a manual skip.

**Tech Stack:** Kotlin / Ktor CIO / Gson / `android.net.nsd.NsdManager` on the phone. Arduino C++ on ESP8266 core 3.1.x with `ArduinoJson` 7.x, `arduinoWebSockets` (Links2004) 2.4+, `LiquidCrystal_I2C`.

**Spec:** `docs/superpowers/specs/2026-07-22-nodemcu-hardware-timer-design.md`

**Branch:** `feat/nodemcu-hardware-timer` (already created, spec already committed)

## Global Constraints

- **Do NOT run lint or tests locally.** Per `CLAUDE.md`: create a branch, commit, open a PR. CI handles formatting, linting and testing. This overrides the "run the test" steps below — write them, commit them, and let CI report. Where a step says "run the test", record it as a checkbox you satisfy by reasoning through the assertion, not by invoking Gradle.
- Kotlin is compiled with `-Xexplicit-api=strict`: **every** top-level and member declaration needs an explicit visibility modifier and an explicit return type. Look at `PhoneServer.kt` for the house style (`public class`, `public fun`, `private fun`).
- Kotlin is compiled with `allWarningsAsErrors = true`: no unused imports, no unused parameters, no deprecation warnings. An unused import fails CI.
- `ktlintCheck` runs before tests in CI. Match surrounding formatting exactly; trailing commas are used throughout this codebase.
- Tests are JUnit 4, in `app/src/test/java/com/pomo/...`, with `public class` and `public fun` (explicit API applies to tests too). See `app/src/test/java/com/pomo/service/TimerConfigPayloadsTest.kt` for the pattern.
- minSdk 26, compileSdk 35, JVM target 17.
- Never commit `firmware/PomoLink/secrets.h`.
- The archived standalone sketch referenced for melodies lives at `/home/raja/Anuraj-Dev/Pomodoro_timer/Pomodoro_timer.ino` and on GitHub at `Anuraj-dev/pomodoro-timer-esp8266-notion`. Read it, do not modify it.
- `arduino-cli` is **not** installed on this machine. Firmware cannot be compiled here. It is verified by Raja flashing from a Windows machine (Task 10).

## File Structure

**Android — created:**

| File | Responsibility |
| --- | --- |
| `app/src/main/java/com/pomo/network/PhoneMessages.kt` | Pure builders for WebSocket frame JSON. No Android or Ktor dependencies, so it is unit-testable. |
| `app/src/main/java/com/pomo/network/PomoServiceAdvertiser.kt` | mDNS registration state machine + the `NsdRegistrar` seam it talks through. |
| `app/src/test/java/com/pomo/network/PhoneMessagesTest.kt` | Frame shape tests. |
| `app/src/test/java/com/pomo/network/PomoServiceAdvertiserTest.kt` | Register/unregister idempotency against a fake registrar. |

**Android — modified:**

| File | Change |
| --- | --- |
| `app/src/main/java/com/pomo/network/PhoneServer.kt` | Delegate `stateMessage()` to `PhoneMessages`; add `broadcastEvent()`. |
| `app/src/main/java/com/pomo/service/PomodoroService.kt` | Emit `phase_complete` in `onTimerComplete()`; own the advertiser lifecycle. |
| `docs/protocol.md` | Document the event frame and mDNS discovery. |
| `docs/architecture.md` | List the hardware device as a control surface. |
| `.gitignore` | Ignore `firmware/PomoLink/secrets.h`. |

**Firmware — created (all under `firmware/`):**

| File | Responsibility |
| --- | --- |
| `README.md` | Wiring table, library versions, board settings, flashing steps. |
| `PomoLink/secrets.h.example` | Credential template. |
| `PomoLink/Buzzer.h` / `.cpp` | Non-blocking melody sequencer. Owns the buzzer pin. |
| `PomoLink/Buttons.h` / `.cpp` | Non-blocking debounce, click counting, long-press. Emits a gesture enum. |
| `PomoLink/TimerModel.h` / `.cpp` | Last known state + countdown extrapolation. No I/O. |
| `PomoLink/Display.h` / `.cpp` | 16x2 rendering from a `TimerModel` + connection status. Owns the LCD. |
| `PomoLink/PomoClient.h` / `.cpp` | WiFi, mDNS discovery, WebSocket lifecycle, REST commands, JSON parsing. |
| `PomoLink/PomoLink.ino` | `setup()` / `loop()`, wiring modules together. |

Split by responsibility so each file stays small enough to hold in context. `TimerModel` deliberately has no I/O so the display and the network layer can be reasoned about separately.

---

### Task 1: Frame builders (`PhoneMessages`)

Extract WebSocket frame construction into a pure object and add the event frame. Doing this first means Task 2 has something tested to call, and it is the only part of the WebSocket layer that can be unit-tested without standing up a server.

**Files:**
- Create: `app/src/main/java/com/pomo/network/PhoneMessages.kt`
- Create: `app/src/test/java/com/pomo/network/PhoneMessagesTest.kt`
- Modify: `app/src/main/java/com/pomo/network/PhoneServer.kt:166-172`

**Interfaces:**
- Consumes: `com.pomo.timer.TimerState` (existing; Gson-serialized, `@SerializedName` handles `daily_goal` / `start_time` / `next_phase` / `last_action_time`).
- Produces: `PhoneMessages.state(gson: Gson, state: TimerState): String` and `PhoneMessages.event(gson: Gson, event: String, phase: String): String`, both used by Task 2.

- [ ] **Step 1: Write the failing test**

Create `app/src/test/java/com/pomo/network/PhoneMessagesTest.kt`:

```kotlin
package com.pomo.network

import com.google.gson.Gson
import com.google.gson.JsonParser
import com.pomo.timer.TimerState
import org.junit.Assert.assertEquals
import org.junit.Test

public class PhoneMessagesTest {
    private val gson = Gson()

    @Test
    public fun state_wrapsSnapshotInStateEnvelope() {
        val state = TimerState()
        state.status = TimerState.STATUS_RUNNING
        state.phase = TimerState.PHASE_WORK
        state.remaining = 1432.0

        val parsed = JsonParser.parseString(PhoneMessages.state(gson, state)).asJsonObject

        assertEquals("state", parsed.get("type").asString)
        assertEquals("running", parsed.getAsJsonObject("data").get("status").asString)
        assertEquals(1432.0, parsed.getAsJsonObject("data").get("remaining").asDouble, 0.0)
    }

    @Test
    public fun event_buildsPhaseCompleteEnvelope() {
        val parsed =
            JsonParser.parseString(
                PhoneMessages.event(gson, "phase_complete", TimerState.PHASE_WORK),
            ).asJsonObject

        assertEquals("event", parsed.get("type").asString)
        assertEquals("phase_complete", parsed.get("event").asString)
        assertEquals("work", parsed.get("phase").asString)
    }

    @Test
    public fun event_isDistinguishableFromState() {
        val stateFrame = JsonParser.parseString(PhoneMessages.state(gson, TimerState())).asJsonObject
        val eventFrame =
            JsonParser.parseString(
                PhoneMessages.event(gson, "phase_complete", TimerState.PHASE_SHORT),
            ).asJsonObject

        assertEquals("state", stateFrame.get("type").asString)
        assertEquals("event", eventFrame.get("type").asString)
        assertEquals(false, eventFrame.has("data"))
    }
}
```

- [ ] **Step 2: Confirm the test cannot pass yet**

`PhoneMessages` does not exist, so this is a compile failure: `Unresolved reference: PhoneMessages`. Do not run Gradle (see Global Constraints).

- [ ] **Step 3: Write the implementation**

Create `app/src/main/java/com/pomo/network/PhoneMessages.kt`:

```kotlin
package com.pomo.network

import com.google.gson.Gson
import com.pomo.timer.TimerState

/**
 * Builders for the frames sent over the phone API WebSocket.
 *
 * Kept free of Ktor and Android types so frame shape is unit-testable without
 * standing up a server. Clients are contractually required to ignore frames
 * whose `type` they do not recognise, which is what makes adding new event
 * types backward-compatible.
 */
public object PhoneMessages {
    public const val TYPE_STATE: String = "state"
    public const val TYPE_EVENT: String = "event"
    public const val EVENT_PHASE_COMPLETE: String = "phase_complete"

    public fun state(
        gson: Gson,
        state: TimerState,
    ): String =
        gson.toJson(
            mapOf(
                "type" to TYPE_STATE,
                "data" to state,
            ),
        )

    public fun event(
        gson: Gson,
        event: String,
        phase: String,
    ): String =
        gson.toJson(
            mapOf(
                "type" to TYPE_EVENT,
                "event" to event,
                "phase" to phase,
            ),
        )
}
```

- [ ] **Step 4: Route `PhoneServer` through it**

In `app/src/main/java/com/pomo/network/PhoneServer.kt`, replace the existing private `stateMessage()` (lines 166-172):

```kotlin
    private suspend fun stateMessage(): String =
        gson.toJson(
            mapOf(
                "type" to "state",
                "data" to service.stateSnapshot(),
            ),
        )
```

with:

```kotlin
    private suspend fun stateMessage(): String = PhoneMessages.state(gson, service.stateSnapshot())
```

No import is needed — `PhoneMessages` is in the same `com.pomo.network` package.

- [ ] **Step 5: Verify the test now passes by inspection**

`PhoneMessages.state` produces `{"type":"state","data":{...}}`, identical to what `PhoneServer` produced before, so existing WebSocket clients are unaffected. `PhoneMessages.event` produces a frame with no `data` key, satisfying `event_isDistinguishableFromState`.

- [ ] **Step 6: Commit**

```bash
git add app/src/main/java/com/pomo/network/PhoneMessages.kt \
        app/src/test/java/com/pomo/network/PhoneMessagesTest.kt \
        app/src/main/java/com/pomo/network/PhoneServer.kt
git commit -m "refactor(network): extract WebSocket frame builders into PhoneMessages"
```

---

### Task 2: Broadcast `phase_complete`

**Files:**
- Modify: `app/src/main/java/com/pomo/network/PhoneServer.kt:146-164` (add a method after `broadcastState`)
- Modify: `app/src/main/java/com/pomo/service/PomodoroService.kt:334-346` (`onTimerComplete`)

**Interfaces:**
- Consumes: `PhoneMessages.event(gson, event, phase)` from Task 1.
- Produces: `PhoneServer.broadcastEvent(event: String, phase: String)` — suspend, used by `PomodoroService`.

- [ ] **Step 1: Add the send-to-all helper and `broadcastEvent`**

`broadcastState` currently inlines its fan-out and dead-session pruning. Adding a second broadcaster that duplicates that loop would be the wrong move, so extract it once.

In `PhoneServer.kt`, replace the whole existing `broadcastState` method (lines 146-164):

```kotlin
    public suspend fun broadcastState() {
        val message = stateMessage()
        val deadSessions = mutableListOf<DefaultWebSocketServerSession>()
        val activeSessions = synchronized(sessionsLock) { sessions.toList() }

        activeSessions.forEach { session ->
            try {
                session.send(Frame.Text(message))
            } catch (e: Exception) {
                deadSessions.add(session)
            }
        }

        if (deadSessions.isNotEmpty()) {
            synchronized(sessionsLock) {
                sessions.removeAll(deadSessions.toSet())
            }
        }
    }
```

with:

```kotlin
    public suspend fun broadcastState() {
        sendToAll(stateMessage())
    }

    /**
     * Sends a one-shot event frame to every subscribed client.
     *
     * Events describe things that happened, not current state — a hardware
     * client cannot tell a natural phase completion from a manual skip using
     * state snapshots alone. Clients that do not recognise the frame type
     * ignore it, so this is safe to add to an existing protocol.
     */
    public suspend fun broadcastEvent(
        event: String,
        phase: String,
    ) {
        sendToAll(PhoneMessages.event(gson, event, phase))
    }

    private suspend fun sendToAll(message: String) {
        val deadSessions = mutableListOf<DefaultWebSocketServerSession>()
        val activeSessions = synchronized(sessionsLock) { sessions.toList() }

        activeSessions.forEach { session ->
            try {
                session.send(Frame.Text(message))
            } catch (_: Exception) {
                deadSessions.add(session)
            }
        }

        if (deadSessions.isNotEmpty()) {
            synchronized(sessionsLock) {
                sessions.removeAll(deadSessions.toSet())
            }
        }
    }
```

Note the `catch (_: Exception)` — the original bound `e` without using it, which `allWarningsAsErrors` tolerates today only because it predates the flag on that line. Use the underscore form, matching `parseHelloToken` (`PhoneServer.kt:186`).

- [ ] **Step 2: Emit the event from the service**

In `PomodoroService.kt`, replace `onTimerComplete` (lines 334-346):

```kotlin
    override fun onTimerComplete(state: TimerState) {
        val completedPhase = currentState.phase
        this.currentState = state
        saveCurrentState()
        updateNotification()
        broadcastStateUpdate()
        StateCueEvent.forCompletedPhase(completedPhase)?.let { cueEngine.playCompletion(it) }
        if (completedPhase == TimerState.PHASE_WORK) {
            publishCrewSnapshot("work block complete")
            checkForNewAchievements()
        }
    }
```

with:

```kotlin
    override fun onTimerComplete(state: TimerState) {
        val completedPhase = currentState.phase
        this.currentState = state
        saveCurrentState()
        updateNotification()
        broadcastPhaseComplete(completedPhase)
        broadcastStateUpdate()
        StateCueEvent.forCompletedPhase(completedPhase)?.let { cueEngine.playCompletion(it) }
        if (completedPhase == TimerState.PHASE_WORK) {
            publishCrewSnapshot("work block complete")
            checkForNewAchievements()
        }
    }
```

Then add this private method immediately after `broadcastStateUpdate()` (which ends at line 402):

```kotlin
    /**
     * Tells remote clients a phase ended on its own, before the state broadcast
     * that follows. Hardware clients ring on this and stay silent on skip or
     * reset, which a state snapshot alone cannot distinguish.
     */
    private fun broadcastPhaseComplete(completedPhase: String) {
        serviceScope.launch {
            phoneServer.broadcastEvent(PhoneMessages.EVENT_PHASE_COMPLETE, completedPhase)
        }
    }
```

Add the import alongside the existing `com.pomo.network.PhoneServer` import (line 24):

```kotlin
import com.pomo.network.PhoneMessages
```

- [ ] **Step 3: Check ordering by inspection**

`broadcastPhaseComplete` is called before `broadcastStateUpdate()` so the device rings while its LCD still shows the phase that just ended. Both launch on `serviceScope`, so ordering is by dispatch, not guaranteed by suspension — that is acceptable because the firmware treats the two independently: the buzzer reacts to the event, the display to the state. Neither blocks on the other.

- [ ] **Step 4: Confirm no existing client breaks**

`desktop-client/src/api.ts` polls REST and does not open a WebSocket, so it cannot see the new frame at all. Confirm this before committing:

```bash
grep -rn "WebSocket\|/ws" desktop-client/src/
```

Expected: no matches. If there are matches, add a guard so unknown `type` values are ignored, and say so in the commit message.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/java/com/pomo/network/PhoneServer.kt \
        app/src/main/java/com/pomo/service/PomodoroService.kt
git commit -m "feat(network): broadcast phase_complete event to WebSocket clients"
```

---

### Task 3: mDNS advertiser

**Files:**
- Create: `app/src/main/java/com/pomo/network/PomoServiceAdvertiser.kt`
- Create: `app/src/test/java/com/pomo/network/PomoServiceAdvertiserTest.kt`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, all used by Task 4:
  - `PomoServiceAdvertiser(registrar: NsdRegistrar)` — constructor
  - `PomoServiceAdvertiser.advertise(port: Int)` — idempotent; re-registers only if the port changed
  - `PomoServiceAdvertiser.stop()` — idempotent
  - `PomoServiceAdvertiser.Companion.forContext(context: Context): PomoServiceAdvertiser`
  - `PomoServiceAdvertiser.SERVICE_TYPE: String` = `"_pomo._tcp"`, `SERVICE_NAME: String` = `"Pomo"`

`NsdRegistrar` is the seam that keeps the state machine testable: the real one wraps `NsdManager`, the test one records calls. Without it this class would need Robolectric, whose `NsdManager` shadow does not model registration callbacks.

- [ ] **Step 1: Write the failing test**

Create `app/src/test/java/com/pomo/network/PomoServiceAdvertiserTest.kt`:

```kotlin
package com.pomo.network

import org.junit.Assert.assertEquals
import org.junit.Test

public class PomoServiceAdvertiserTest {
    private class FakeRegistrar : NsdRegistrar {
        val calls: MutableList<String> = mutableListOf()
        var failNextRegister: Boolean = false

        override fun register(
            serviceName: String,
            serviceType: String,
            port: Int,
        ) {
            if (failNextRegister) {
                failNextRegister = false
                throw IllegalStateException("nsd unavailable")
            }
            calls.add("register:$serviceName:$serviceType:$port")
        }

        override fun unregister() {
            calls.add("unregister")
        }
    }

    @Test
    public fun advertise_registersOnce() {
        val registrar = FakeRegistrar()
        PomoServiceAdvertiser(registrar).advertise(9876)

        assertEquals(listOf("register:Pomo:_pomo._tcp:9876"), registrar.calls)
    }

    @Test
    public fun advertise_isIdempotentForSamePort() {
        val registrar = FakeRegistrar()
        val advertiser = PomoServiceAdvertiser(registrar)

        advertiser.advertise(9876)
        advertiser.advertise(9876)
        advertiser.advertise(9876)

        assertEquals(listOf("register:Pomo:_pomo._tcp:9876"), registrar.calls)
    }

    @Test
    public fun advertise_reregistersWhenPortChanges() {
        val registrar = FakeRegistrar()
        val advertiser = PomoServiceAdvertiser(registrar)

        advertiser.advertise(9876)
        advertiser.advertise(9999)

        assertEquals(
            listOf(
                "register:Pomo:_pomo._tcp:9876",
                "unregister",
                "register:Pomo:_pomo._tcp:9999",
            ),
            registrar.calls,
        )
    }

    @Test
    public fun stop_unregistersOnlyWhenAdvertising() {
        val registrar = FakeRegistrar()
        val advertiser = PomoServiceAdvertiser(registrar)

        advertiser.stop()
        assertEquals(emptyList<String>(), registrar.calls)

        advertiser.advertise(9876)
        advertiser.stop()
        advertiser.stop()

        assertEquals(
            listOf("register:Pomo:_pomo._tcp:9876", "unregister"),
            registrar.calls,
        )
    }

    @Test
    public fun advertise_failureLeavesAdvertiserRetryable() {
        val registrar = FakeRegistrar()
        val advertiser = PomoServiceAdvertiser(registrar)
        registrar.failNextRegister = true

        advertiser.advertise(9876)
        advertiser.advertise(9876)

        assertEquals(listOf("register:Pomo:_pomo._tcp:9876"), registrar.calls)
    }
}
```

The last test is the important one: a failed registration must not latch the advertiser into believing it is advertising, or a transient `NsdManager` failure would permanently disable discovery until the service restarts.

- [ ] **Step 2: Confirm the test cannot pass yet**

`NsdRegistrar` and `PomoServiceAdvertiser` do not exist — compile failure, `Unresolved reference`.

- [ ] **Step 3: Write the implementation**

Create `app/src/main/java/com/pomo/network/PomoServiceAdvertiser.kt`:

```kotlin
package com.pomo.network

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log

/**
 * The NsdManager operations [PomoServiceAdvertiser] needs, behind an interface
 * so the registration state machine can be tested without the Android framework.
 */
public interface NsdRegistrar {
    public fun register(
        serviceName: String,
        serviceType: String,
        port: Int,
    )

    public fun unregister()
}

/**
 * Advertises the phone API over mDNS as `_pomo._tcp`, so LAN clients can find
 * the phone by name instead of a hardcoded IP that breaks on every DHCP lease
 * change.
 *
 * Advertising is optional, exactly like the phone API itself: registration
 * failures are logged and swallowed so a non-critical feature can never take
 * the timer down.
 *
 * Not thread-safe by itself. [PomodoroService] drives it from the service
 * lifecycle and its config-change path, both on the main thread.
 */
public class PomoServiceAdvertiser(
    private val registrar: NsdRegistrar,
) {
    private var advertisedPort: Int? = null

    public val isAdvertising: Boolean
        get() = advertisedPort != null

    /** Registers the service, or re-registers it if [port] differs from the live registration. */
    public fun advertise(port: Int) {
        if (advertisedPort == port) return
        if (advertisedPort != null) stop()

        try {
            registrar.register(SERVICE_NAME, SERVICE_TYPE, port)
            advertisedPort = port
            Log.d(TAG, "Advertising $SERVICE_NAME ($SERVICE_TYPE) on port $port")
        } catch (e: Exception) {
            // Leave advertisedPort null so a later call retries rather than
            // latching discovery off until the service restarts.
            advertisedPort = null
            Log.w(TAG, "mDNS registration failed on port $port: ${e.message}")
        }
    }

    public fun stop() {
        if (advertisedPort == null) return
        try {
            registrar.unregister()
        } catch (e: Exception) {
            Log.w(TAG, "mDNS unregistration failed: ${e.message}")
        }
        advertisedPort = null
    }

    private class NsdManagerRegistrar(
        private val nsdManager: NsdManager,
    ) : NsdRegistrar {
        private var listener: NsdManager.RegistrationListener? = null

        override fun register(
            serviceName: String,
            serviceType: String,
            port: Int,
        ) {
            val info =
                NsdServiceInfo().apply {
                    this.serviceName = serviceName
                    this.serviceType = serviceType
                    this.port = port
                }
            val newListener =
                object : NsdManager.RegistrationListener {
                    override fun onServiceRegistered(info: NsdServiceInfo) {
                        Log.d(TAG, "mDNS registered as ${info.serviceName}")
                    }

                    override fun onRegistrationFailed(
                        info: NsdServiceInfo,
                        errorCode: Int,
                    ) {
                        Log.w(TAG, "mDNS registration failed, code $errorCode")
                    }

                    override fun onServiceUnregistered(info: NsdServiceInfo) {
                        Log.d(TAG, "mDNS unregistered")
                    }

                    override fun onUnregistrationFailed(
                        info: NsdServiceInfo,
                        errorCode: Int,
                    ) {
                        Log.w(TAG, "mDNS unregistration failed, code $errorCode")
                    }
                }
            // Retain the listener: unregisterService must be called with the
            // same instance that was passed to registerService, or NsdManager
            // throws and leaks the registration.
            listener = newListener
            nsdManager.registerService(info, NsdManager.PROTOCOL_DNS_SD, newListener)
        }

        override fun unregister() {
            val active = listener ?: return
            listener = null
            nsdManager.unregisterService(active)
        }
    }

    public companion object {
        public const val SERVICE_TYPE: String = "_pomo._tcp"
        public const val SERVICE_NAME: String = "Pomo"
        private const val TAG: String = "PomoAdvertiser"

        /** Builds an advertiser backed by the system NsdManager. */
        public fun forContext(context: Context): PomoServiceAdvertiser {
            val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
            return PomoServiceAdvertiser(NsdManagerRegistrar(nsdManager))
        }
    }
}
```

Note: `NsdServiceInfo.setServiceName`/`setPort` are deprecated on API 34+ in favour of builder APIs, but the replacements require API 34 and `targetSdk` here is 34 with `minSdk` 26. If `allWarningsAsErrors` rejects these setters, add `@Suppress("DEPRECATION")` on `NsdManagerRegistrar.register` — do not raise the API floor.

- [ ] **Step 4: Verify the tests pass by inspection**

Trace `advertise_reregistersWhenPortChanges`: first call has `advertisedPort == null`, so it skips the early return, `advertisedPort != null` is false so no `stop()`, then registers and sets `advertisedPort = 9876`. Second call: `9876 != 9999` so no early return, `advertisedPort != null` so `stop()` fires `unregister` and nulls it, then registers 9999. Call list matches.

Trace `advertise_failureLeavesAdvertiserRetryable`: first call throws, catch sets `advertisedPort = null`. Second call therefore does not early-return and registers successfully. One `register` recorded, matching the expectation.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/java/com/pomo/network/PomoServiceAdvertiser.kt \
        app/src/test/java/com/pomo/network/PomoServiceAdvertiserTest.kt
git commit -m "feat(network): add mDNS advertiser for the phone API"
```

---

### Task 4: Wire the advertiser into the service lifecycle

The advertiser must follow the phone server exactly — same enable toggle, same wifi-only rule, same port. Binding it to `restartPhoneServerIfNeeded()` rather than to `onCreate` is what buys that for free.

**Files:**
- Modify: `app/src/main/java/com/pomo/service/PomodoroService.kt` — field declaration near line 50, `onCreate` near line 118, `onDestroy` near line 245, `restartPhoneServerIfNeeded` at 607-622, `rotatePairingToken` at 624-636

**Interfaces:**
- Consumes: `PomoServiceAdvertiser.forContext`, `.advertise(port)`, `.stop()` from Task 3.
- Produces: nothing consumed by later Android tasks.

- [ ] **Step 1: Declare the field**

After the existing `activePhoneServerPort` declaration (`PomodoroService.kt:51`):

```kotlin
    private var activePhoneServerPort: Int = PhoneServer.DEFAULT_PORT
```

add:

```kotlin
    private lateinit var serviceAdvertiser: PomoServiceAdvertiser
```

Add the import next to the other `com.pomo.network` imports:

```kotlin
import com.pomo.network.PomoServiceAdvertiser
```

- [ ] **Step 2: Construct it in `onCreate`**

Immediately after `phoneServer = PhoneServer(this, activePhoneServerPort)` (`PomodoroService.kt:118`):

```kotlin
        serviceAdvertiser = PomoServiceAdvertiser.forContext(this)
```

Construction only — it does not advertise until the server is actually serving. `onCreate` already calls `restartPhoneServerIfNeeded()` at line 164, which is where advertising starts.

- [ ] **Step 3: Advertise and stop alongside the server**

Replace `restartPhoneServerIfNeeded()` (`PomodoroService.kt:607-622`):

```kotlin
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
```

with:

```kotlin
    private fun restartPhoneServerIfNeeded() {
        val newPort = prefs.phoneServerPort
        val shouldServe = isPhoneServerServing
        if (!shouldServe) {
            serviceAdvertiser.stop()
            phoneServer.stop()
            return
        }

        if (newPort == activePhoneServerPort && phoneServer.isRunning) {
            // Already serving on the right port. Still call advertise() — it is
            // idempotent, and this covers the case where the server survived but
            // mDNS registration previously failed.
            serviceAdvertiser.advertise(activePhoneServerPort)
            return
        }

        Log.d(TAG, "Restarting phone API on port $newPort")
        serviceAdvertiser.stop()
        phoneServer.stop()
        activePhoneServerPort = newPort
        phoneServer = PhoneServer(this, activePhoneServerPort)
        phoneServer.start()
        if (phoneServer.isRunning) {
            serviceAdvertiser.advertise(activePhoneServerPort)
        }
    }
```

The `if (phoneServer.isRunning)` guard matters: `PhoneServer.start()` swallows a failed port bind (`PhoneServer.kt:129-137`) and leaves `engine` null. Advertising a port nothing is listening on would send the device to a dead socket every reconnect.

- [ ] **Step 4: Handle token rotation**

`rotatePairingToken()` (`PomodoroService.kt:624-636`) does its own stop/start to force clients to re-pair. Replace its body:

```kotlin
    public fun rotatePairingToken(): String {
        val token = prefs.rotatePairingToken()
        // Force a full stop+start so existing WebSocket clients are disconnected and
        // must re-pair with the new token. restartPhoneServerIfNeeded() skips the
        // restart when the port is unchanged and the server is already running.
        phoneServer.stop()
        if (isPhoneServerServing) {
            phoneServer = PhoneServer(this, activePhoneServerPort)
            phoneServer.start()
        }
        broadcastStateUpdate()
        return token
    }
```

with:

```kotlin
    public fun rotatePairingToken(): String {
        val token = prefs.rotatePairingToken()
        // Force a full stop+start so existing WebSocket clients are disconnected and
        // must re-pair with the new token. restartPhoneServerIfNeeded() skips the
        // restart when the port is unchanged and the server is already running.
        serviceAdvertiser.stop()
        phoneServer.stop()
        if (isPhoneServerServing) {
            phoneServer = PhoneServer(this, activePhoneServerPort)
            phoneServer.start()
            if (phoneServer.isRunning) {
                serviceAdvertiser.advertise(activePhoneServerPort)
            }
        }
        broadcastStateUpdate()
        return token
    }
```

- [ ] **Step 5: Stop advertising on teardown**

In `onDestroy` (`PomodoroService.kt:240-247`), add the advertiser stop immediately before `phoneServer.stop()`:

```kotlin
        serviceScope.cancel()
        serviceAdvertiser.stop()
        phoneServer.stop()
        cueEngine.release()
```

Order matters — unregister the advertisement before killing the server, so a client never resolves a record pointing at a socket that has already closed.

- [ ] **Step 6: Audit every `phoneServer.stop()` call site**

```bash
grep -n "phoneServer.stop()\|phoneServer.start()" app/src/main/java/com/pomo/service/PomodoroService.kt
```

Expected: exactly five `stop()` (two in `restartPhoneServerIfNeeded`, one in `rotatePairingToken`, one in `onDestroy`) and three `start()`. Every `stop()` must be preceded by `serviceAdvertiser.stop()`, and every `start()` followed by a guarded `advertise()`. If the grep shows a call site not covered by Steps 3-5, fix it before committing.

- [ ] **Step 7: Commit**

```bash
git add app/src/main/java/com/pomo/service/PomodoroService.kt
git commit -m "feat(service): advertise the phone API over mDNS while serving"
```

---

### Task 5: Protocol and architecture docs

**Files:**
- Modify: `docs/protocol.md`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: the frame shape from Task 1 and the service type from Task 3.
- Produces: the contract the firmware in Tasks 6-9 implements against.

- [ ] **Step 1: Document discovery in `docs/protocol.md`**

Insert a new section immediately after the pairing payload block (which ends at line 24, just before `## Authentication`):

````markdown
## Discovery

While the phone API is serving, the phone advertises itself over mDNS:

```text
service type: _pomo._tcp
service name: Pomo
port:         the configured phone API port (default 9876)
```

LAN clients should resolve the phone's address this way rather than storing an
IP, which changes whenever the router issues a new DHCP lease. Discovery does
not carry the pairing token — clients still need the token from the pairing
payload. Advertising follows the phone API's own settings: it stops when the
API is disabled and when wifi-only mode has no active LAN network.

Clients on networks that block multicast should fall back to a manually
configured host and port.
````

- [ ] **Step 2: Document the event frame in `docs/protocol.md`**

In the `## WebSocket` section, after the state message block (which ends at line 237), insert:

````markdown
### Event Frames

Events describe something that happened, as opposed to current state. They are
sent to every subscribed client:

```json
{
  "type": "event",
  "event": "phase_complete",
  "phase": "work"
}
```

```text
event: phase_complete
phase: work | short | long
```

`phase_complete` fires only when a phase runs down to zero on its own. Skip,
reset and pause produce a state message and no event, which is what lets a
hardware client sound an alarm on a real completion and stay silent on a manual
action. The event is sent immediately before the state message for the same
transition.

Clients MUST ignore frames whose `type` they do not recognise. New event types
may be added without a protocol version bump.
````

- [ ] **Step 3: Update the client contract in `docs/protocol.md`**

In the `## Client Contract` list (lines 244-251), change the heading line from `Desktop clients should:` to `Remote clients (desktop and hardware) should:` and add two bullets:

```markdown
- Discover the phone through mDNS where possible, with a manual host fallback.
- Ignore WebSocket frames with an unrecognised `type`.
```

- [ ] **Step 4: Update `docs/architecture.md`**

In the `## Source Of Truth` list (lines 11-15), add a fourth bullet after `Home-screen widget actions`:

```markdown
- The NodeMCU desk device, through the same authenticated HTTP commands
```

Then in `## Pairing And Remote Clients`, after the existing "Remote clients are thin" list (ends line 154), add:

```markdown
The NodeMCU desk device (`firmware/PomoLink/`) is one of these thin clients. It
renders broadcast state on an LCD, sends button gestures to the REST endpoints,
and sounds a buzzer on the `phase_complete` event. It runs no timer of its own:
when the phone is unreachable it displays a disconnected marker and refuses
commands rather than authoring state it would later have to reconcile.

While serving, the service advertises `_pomo._tcp` over mDNS so LAN clients
resolve the phone by name.
```

- [ ] **Step 5: Verify the fenced blocks nest correctly**

The Discovery and Event Frames sections contain fenced code blocks inside what this plan shows as a fenced block. When writing to `docs/protocol.md`, the inner ` ```text ` and ` ```json ` fences are literal file content; do not carry the outer ` ```markdown ` fence into the file.

```bash
grep -c '```' docs/protocol.md
```

Expected: an even number. An odd count means a fence was dropped.

- [ ] **Step 6: Commit**

```bash
git add docs/protocol.md docs/architecture.md
git commit -m "docs: document mDNS discovery and phase_complete event frames"
```

---

### Task 6: Firmware scaffold and non-blocking primitives

Buzzer and Buttons come first because they encode the plan's hardest constraint — no `delay()` — and because they are the two modules with no dependency on anything else.

**Files:**
- Create: `firmware/README.md`
- Create: `firmware/PomoLink/secrets.h.example`
- Create: `firmware/PomoLink/Buzzer.h`, `firmware/PomoLink/Buzzer.cpp`
- Create: `firmware/PomoLink/Buttons.h`, `firmware/PomoLink/Buttons.cpp`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces, used by Task 9:
  - `Buzzer::begin(uint8_t pin)`, `Buzzer::playWorkComplete()`, `Buzzer::playBreakComplete()`, `Buzzer::tick()`, `Buzzer::isPlaying() const`
  - `Buttons::begin(uint8_t pin)`, `Buttons::tick() -> Gesture`
  - `enum Gesture { GESTURE_NONE, GESTURE_SINGLE, GESTURE_DOUBLE, GESTURE_TRIPLE, GESTURE_HOLD }`

- [ ] **Step 1: Ignore the secrets file**

Append to `.gitignore`:

```text

# Firmware credentials (copy secrets.h.example and fill in locally)
firmware/PomoLink/secrets.h
```

- [ ] **Step 2: Write the credential template**

Create `firmware/PomoLink/secrets.h.example`:

```c
// Copy this file to secrets.h in the same folder and fill in your values.
// secrets.h is gitignored — never commit it.
#pragma once

#define WIFI_SSID "your-wifi-name"
#define WIFI_PASS "your-wifi-password"

// From Pomo: Settings -> phone pairing. Rotating the token in the app
// requires reflashing with the new value.
#define POMO_TOKEN "paste-pairing-token-here"

// Optional. Used only when mDNS discovery fails, which happens on routers
// that block multicast. Leave as "" to rely on mDNS alone.
#define POMO_HOST_FALLBACK ""
#define POMO_PORT_FALLBACK 9876
```

- [ ] **Step 3: Write the buzzer**

Create `firmware/PomoLink/Buzzer.h`:

```cpp
#pragma once
#include <Arduino.h>

// Plays melodies without blocking. The WebSocket client must be pumped every
// loop iteration; the archived standalone sketch used delay() between notes,
// which would stall the connection for seconds and drop it mid-celebration.
class Buzzer {
 public:
  // Public because the melody tables in Buzzer.cpp are file-scope constants of
  // this type. A private nested struct would not be nameable there.
  struct Note {
    uint16_t frequency;  // Hz, 0 = rest
    uint16_t duration;   // ms the note sounds
    uint16_t gap;        // ms of silence after the note
  };

  void begin(uint8_t pin);
  void playWorkComplete();
  void playBreakComplete();
  void tick();
  bool isPlaying() const { return playing_; }

 private:
  void start(const Note* notes, uint8_t count);

  uint8_t pin_ = 0;
  const Note* notes_ = nullptr;
  uint8_t count_ = 0;
  uint8_t index_ = 0;
  bool playing_ = false;
  bool inGap_ = false;
  unsigned long stepStartedAt_ = 0;
};
```

Create `firmware/PomoLink/Buzzer.cpp`:

```cpp
#include "Buzzer.h"

namespace {

// Derived from the archived standalone sketch's playRewardSound()
// (Pomodoro_timer.ino:654-711) with countFactor fixed at 1, which is what that
// sketch always used. Frequencies are baseNote 543 Hz scaled by the major-scale
// intervals {1.0, 1.125, 1.25, 1.33, 1.5, 1.67, 1.875, 2.0}.
const Buzzer::Note kWorkComplete[] = {
    // Intro flourish: ascending arpeggio, intervals 0..2
    {543, 70, 20}, {611, 70, 20}, {679, 70, 20},
    // Main melody: melodyPattern {0, 2, 4}, durations 135/145/155
    {543, 135, 67}, {679, 145, 67}, {815, 155, 67},
    // Finale: interval 4 then interval 7
    {815, 150, 30}, {1086, 330, 0},
};

// Derived from the short-break completion melody
// (Pomodoro_timer.ino:520-550): baseNote 799 Hz, gentle rising arpeggio then a
// two-note resolution. Softer and shorter than the work melody by design.
const Buzzer::Note kBreakComplete[] = {
    {799, 85, 20}, {899, 85, 20}, {999, 85, 80},
    {1063, 160, 30},
    {799, 265, 0},
};

}  // namespace

void Buzzer::begin(uint8_t pin) {
  pin_ = pin;
  pinMode(pin_, OUTPUT);
  digitalWrite(pin_, LOW);
}

void Buzzer::playWorkComplete() {
  start(kWorkComplete, sizeof(kWorkComplete) / sizeof(kWorkComplete[0]));
}

void Buzzer::playBreakComplete() {
  start(kBreakComplete, sizeof(kBreakComplete) / sizeof(kBreakComplete[0]));
}

// A new melody replaces one already playing rather than queueing behind it.
// Two completions cannot legitimately arrive back to back, so a queue would
// only ever delay the melody that reflects current reality.
void Buzzer::start(const Note* notes, uint8_t count) {
  noTone(pin_);
  notes_ = notes;
  count_ = count;
  index_ = 0;
  playing_ = true;
  inGap_ = false;
  stepStartedAt_ = millis();
  tone(pin_, notes_[0].frequency, notes_[0].duration);
}

void Buzzer::tick() {
  if (!playing_) return;

  const Note& note = notes_[index_];
  const unsigned long elapsed = millis() - stepStartedAt_;

  if (!inGap_) {
    if (elapsed < note.duration) return;
    noTone(pin_);
    inGap_ = true;
    stepStartedAt_ = millis();
    return;
  }

  if (elapsed < note.gap) return;

  index_++;
  if (index_ >= count_) {
    playing_ = false;
    notes_ = nullptr;
    noTone(pin_);
    return;
  }

  inGap_ = false;
  stepStartedAt_ = millis();
  tone(pin_, notes_[index_].frequency, notes_[index_].duration);
}
```

- [ ] **Step 4: Write the button handler**

Create `firmware/PomoLink/Buttons.h`:

```cpp
#pragma once
#include <Arduino.h>

enum Gesture {
  GESTURE_NONE,
  GESTURE_SINGLE,
  GESTURE_DOUBLE,
  GESTURE_TRIPLE,
  GESTURE_HOLD,
};

// Single active-low button with millis-based debounce. The archived sketch used
// delay(50) inside its debounce, which is not acceptable here — see Buzzer.h.
class Buttons {
 public:
  void begin(uint8_t pin);

  // Call every loop. Returns GESTURE_NONE except on the single tick where a
  // gesture resolves.
  Gesture tick();

 private:
  static const unsigned long kDebounceMs = 50;
  static const unsigned long kMultiClickMs = 600;
  static const unsigned long kHoldMs = 1000;

  uint8_t pin_ = 0;
  bool pressed_ = false;
  uint8_t clickCount_ = 0;
  unsigned long lastEdgeAt_ = 0;
  unsigned long pressedAt_ = 0;
  unsigned long lastReleaseAt_ = 0;
  bool holdConsumed_ = false;
};
```

Create `firmware/PomoLink/Buttons.cpp`:

```cpp
#include "Buttons.h"

void Buttons::begin(uint8_t pin) {
  pin_ = pin;
  pinMode(pin_, INPUT_PULLUP);
}

Gesture Buttons::tick() {
  const unsigned long now = millis();
  const bool rawPressed = digitalRead(pin_) == LOW;

  if (rawPressed != pressed_ && (now - lastEdgeAt_) >= kDebounceMs) {
    lastEdgeAt_ = now;
    pressed_ = rawPressed;

    if (pressed_) {
      pressedAt_ = now;
      holdConsumed_ = false;
    } else {
      // Long press resolves on release, so it can never be mistaken for the
      // first click of a multi-click sequence.
      if (!holdConsumed_ && (now - pressedAt_) >= kHoldMs) {
        clickCount_ = 0;
        holdConsumed_ = true;
        return GESTURE_HOLD;
      }
      clickCount_++;
      lastReleaseAt_ = now;
    }
  }

  if (clickCount_ > 0 && !pressed_ && (now - lastReleaseAt_) >= kMultiClickMs) {
    const uint8_t count = clickCount_;
    clickCount_ = 0;
    if (count == 1) return GESTURE_SINGLE;
    if (count == 2) return GESTURE_DOUBLE;
    return GESTURE_TRIPLE;
  }

  return GESTURE_NONE;
}
```

- [ ] **Step 5: Write the firmware README**

Create `firmware/README.md`:

```markdown
# PomoLink — NodeMCU desk device

An ESP8266 NodeMCU that mirrors and controls the Pomo timer over your LAN. It is
a thin client: the phone owns the timer, this device displays it and sends
commands. It never runs a timer of its own.

See `docs/protocol.md` for the API it speaks and
`docs/superpowers/specs/2026-07-22-nodemcu-hardware-timer-design.md` for the design.

## Hardware

| Component | NodeMCU pin |
| --- | --- |
| 16x2 I2C LCD, SDA | D2 |
| 16x2 I2C LCD, SCL | D1 |
| 16x2 I2C LCD, VCC / GND | VIN (5V) / GND |
| Passive buzzer, + | D5 |
| Passive buzzer, - | GND |
| Button | GPIO0 (the onboard FLASH button — nothing to wire) |

The LCD is addressed at `0x27`. If yours is at `0x3F`, change `kLcdAddress` in
`Display.cpp`.

## Libraries

Install through the Arduino IDE Library Manager unless noted.

| Library | Version | Notes |
| --- | --- | --- |
| esp8266 boards | 3.1.x or newer | Boards Manager URL: `https://arduino.esp8266.com/stable/package_esp8266com_index.json` |
| ArduinoJson (bblanchon) | 7.x | v6 will not compile — this code uses `JsonDocument` |
| arduinoWebSockets (Links2004) | 2.4.0 or newer | |
| LiquidCrystal_I2C | the fork with a no-argument `lcd.begin()` | |

`ESP8266WiFi`, `ESP8266mDNS`, `ESP8266HTTPClient` and `Wire` ship with the board
package.

## Board settings

- Board: **NodeMCU 1.0 (ESP-12E Module)**
- CPU Frequency: 80 MHz
- Flash Size: 4MB (FS:2MB OTA:~1019KB)
- Upload Speed: 115200

## Flashing

1. Copy the whole `PomoLink/` folder to the machine with the Arduino IDE.
2. Rename `secrets.h.example` to `secrets.h`.
3. Fill in your WiFi credentials and the pairing token from Pomo's Settings screen.
4. Open `PomoLink.ino`, select the board above, and upload.

Open Serial Monitor at 115200 baud to watch discovery and connection state.

## Troubleshooting

| LCD shows | Meaning |
| --- | --- |
| `.` in the bottom-right | Connecting to WiFi, discovering the phone, or opening the WebSocket |
| `!` in the bottom-right | Phone unreachable. Check Pomo is running and the phone API is enabled in Settings. |
| `?` in the bottom-right | Token rejected. Re-copy the pairing token into `secrets.h` and reflash. |

If it never gets past `.`, your router probably blocks mDNS multicast. Set
`POMO_HOST_FALLBACK` in `secrets.h` to the phone's IP (shown in Pomo Settings)
and reflash.
```

- [ ] **Step 6: Commit**

```bash
git add .gitignore firmware/README.md firmware/PomoLink/secrets.h.example \
        firmware/PomoLink/Buzzer.h firmware/PomoLink/Buzzer.cpp \
        firmware/PomoLink/Buttons.h firmware/PomoLink/Buttons.cpp
git commit -m "feat(firmware): add PomoLink scaffold with non-blocking buzzer and buttons"
```

Confirm `git status` does not list `secrets.h`.

---

### Task 7: Timer model

Pure logic, no I/O — the one firmware module whose correctness can be reasoned about in isolation.

**Files:**
- Create: `firmware/PomoLink/TimerModel.h`, `firmware/PomoLink/TimerModel.cpp`

**Interfaces:**
- Consumes: nothing.
- Produces, used by Tasks 8 and 9:
  - `enum ConnState { CONN_BOOT, CONN_WIFI, CONN_DISCOVERING, CONN_CONNECTING, CONN_SYNCED, CONN_OFFLINE, CONN_UNPAIRED }`
  - `TimerModel::applyState(const char* status, const char* phase, double remaining, double duration, int completed, int goal)`
  - `TimerModel::displayedSeconds() const -> long`
  - `TimerModel::status() const -> const char*`, `phase() const -> const char*`
  - `TimerModel::completed() const -> int`, `goal() const -> int`, `duration() const -> double`
  - `TimerModel::isRunning() const -> bool`, `hasState() const -> bool`

- [ ] **Step 1: Write the header**

Create `firmware/PomoLink/TimerModel.h`:

```cpp
#pragma once
#include <Arduino.h>

enum ConnState {
  CONN_BOOT,
  CONN_WIFI,         // connecting to WiFi
  CONN_DISCOVERING,  // resolving the phone via mDNS
  CONN_CONNECTING,   // opening the WebSocket
  CONN_SYNCED,       // authenticated, receiving broadcasts
  CONN_OFFLINE,      // phone unreachable
  CONN_UNPAIRED,     // token rejected
};

// Holds the last state the phone reported and extrapolates the countdown
// between broadcasts. Owns no hardware and performs no I/O.
//
// The phone sends `remaining` in seconds at the moment of the broadcast. This
// class records millis() at receipt and subtracts elapsed time when asked, so
// the display ticks smoothly without the device ever running its own timer.
// Every broadcast re-snaps the baseline, so error cannot accumulate.
class TimerModel {
 public:
  void applyState(const char* status, const char* phase, double remaining,
                  double duration, int completed, int goal);

  // Seconds to show, clamped at zero. Extrapolates only while running.
  long displayedSeconds() const;

  const char* status() const { return status_; }
  const char* phase() const { return phase_; }
  int completed() const { return completed_; }
  int goal() const { return goal_; }
  double duration() const { return duration_; }
  bool isRunning() const { return strcmp(status_, "running") == 0; }
  bool hasState() const { return hasState_; }

 private:
  char status_[10] = "stopped";
  char phase_[8] = "work";
  double remaining_ = 0.0;
  double duration_ = 0.0;
  int completed_ = 0;
  int goal_ = 8;
  unsigned long receivedAt_ = 0;
  bool hasState_ = false;
};
```

- [ ] **Step 2: Write the implementation**

Create `firmware/PomoLink/TimerModel.cpp`:

```cpp
#include "TimerModel.h"

#include <string.h>

void TimerModel::applyState(const char* status, const char* phase,
                            double remaining, double duration, int completed,
                            int goal) {
  strncpy(status_, status, sizeof(status_) - 1);
  status_[sizeof(status_) - 1] = '\0';
  strncpy(phase_, phase, sizeof(phase_) - 1);
  phase_[sizeof(phase_) - 1] = '\0';
  remaining_ = remaining;
  duration_ = duration;
  completed_ = completed;
  goal_ = goal;
  receivedAt_ = millis();
  hasState_ = true;
}

long TimerModel::displayedSeconds() const {
  if (!isRunning()) {
    // Paused and stopped states report a fixed remaining value; extrapolating
    // it would make a paused timer appear to tick down.
    return remaining_ < 0 ? 0 : (long)remaining_;
  }

  // Unsigned subtraction is correct across the millis() rollover at ~49 days.
  const unsigned long elapsedMs = millis() - receivedAt_;
  const long value = (long)remaining_ - (long)(elapsedMs / 1000UL);
  return value < 0 ? 0 : value;
}
```

- [ ] **Step 3: Verify the clamp and pause behaviour by inspection**

With `remaining_ = 60.0` and `status_ = "running"`, after 90 s of `millis()` advance the computed value is `60 - 90 = -30`, clamped to `0`. The device therefore holds at `00:00` rather than counting negative, and never advances the phase itself — it waits for the phone.

With `status_ = "paused"`, `displayedSeconds()` returns `remaining_` unchanged no matter how much time passes.

- [ ] **Step 4: Commit**

```bash
git add firmware/PomoLink/TimerModel.h firmware/PomoLink/TimerModel.cpp
git commit -m "feat(firmware): add TimerModel with countdown extrapolation"
```

---

### Task 8: Display

**Files:**
- Create: `firmware/PomoLink/Display.h`, `firmware/PomoLink/Display.cpp`

**Interfaces:**
- Consumes: `TimerModel`, `ConnState` from Task 7.
- Produces, used by Task 9: `Display::begin()`, `Display::render(const TimerModel&, ConnState)`, `Display::blinkBacklight()`, `Display::tick()`

- [ ] **Step 1: Write the header**

Create `firmware/PomoLink/Display.h`:

```cpp
#pragma once
#include <Arduino.h>

#include "TimerModel.h"

// Renders the 16x2 LCD. Redraws only cells whose content changed — a full
// lcd.clear() every second produces visible flicker over I2C.
class Display {
 public:
  void begin();

  // Cheap to call every loop; only touches the LCD when the rendered text
  // actually differs from what is on screen.
  void render(const TimerModel& model, ConnState conn);

  // Starts the 3x backlight blink used on work completion. Non-blocking.
  void blinkBacklight();

  void tick();

 private:
  void writeRow(uint8_t row, const char* text);

  char shown_[2][17] = {"", ""};
  bool blinking_ = false;
  uint8_t blinkStep_ = 0;
  unsigned long blinkStepAt_ = 0;
};
```

- [ ] **Step 2: Write the implementation**

Create `firmware/PomoLink/Display.cpp`:

```cpp
#include "Display.h"

#include <LiquidCrystal_I2C.h>
#include <Wire.h>
#include <string.h>

namespace {

const uint8_t kLcdAddress = 0x27;
const uint8_t kSdaPin = D2;
const uint8_t kSclPin = D1;
const uint8_t kBlinkSteps = 6;   // 3 off/on pairs
const unsigned long kBlinkMs = 200;

LiquidCrystal_I2C lcd(kLcdAddress, 16, 2);

const char* phaseLabel(const TimerModel& model) {
  if (strcmp(model.status(), "paused") == 0) return "Paused";
  if (strcmp(model.status(), "stopped") == 0) return "Pomo";
  if (strcmp(model.phase(), "work") == 0) return "Focus";
  if (strcmp(model.phase(), "short") == 0) return "Break";
  if (strcmp(model.phase(), "long") == 0) return "Long";
  return "Pomo";
}

char connMarker(ConnState conn) {
  switch (conn) {
    case CONN_SYNCED: return ' ';
    case CONN_OFFLINE: return '!';
    case CONN_UNPAIRED: return '?';
    default: return '.';
  }
}

}  // namespace

void Display::begin() {
  Wire.begin(kSdaPin, kSclPin);
  lcd.begin();
  lcd.backlight();
  lcd.clear();
}

void Display::render(const TimerModel& model, ConnState conn) {
  char row0[17];
  char row1[17];

  // Row 0: phase label left, MM:SS right-aligned at columns 11-15.
  long seconds = model.hasState() ? model.displayedSeconds() : 0;
  if (!model.hasState()) seconds = 0;
  if (strcmp(model.status(), "stopped") == 0 && model.hasState()) {
    // Idle shows the configured phase length rather than a zeroed countdown.
    seconds = (long)model.duration();
  }
  const long minutes = seconds / 60;
  const long secs = seconds % 60;
  snprintf(row0, sizeof(row0), "%-11s%02ld:%02ld", phaseLabel(model), minutes, secs);

  // Row 1: progress left, connection marker at column 15.
  char left[16];
  if (!model.hasState()) {
    snprintf(left, sizeof(left), "Starting up");
  } else if (strcmp(model.status(), "stopped") == 0) {
    snprintf(left, sizeof(left), "Press to start");
  } else {
    snprintf(left, sizeof(left), "%d/%d today", model.completed(), model.goal());
  }
  snprintf(row1, sizeof(row1), "%-15s%c", left, connMarker(conn));

  writeRow(0, row0);
  writeRow(1, row1);
}

void Display::writeRow(uint8_t row, const char* text) {
  if (strcmp(shown_[row], text) == 0) return;

  for (uint8_t col = 0; col < 16; col++) {
    const char next = text[col] ? text[col] : ' ';
    const char prev = shown_[row][col] ? shown_[row][col] : ' ';
    if (next == prev) continue;
    lcd.setCursor(col, row);
    lcd.print(next);
  }

  strncpy(shown_[row], text, 16);
  shown_[row][16] = '\0';
}

void Display::blinkBacklight() {
  blinking_ = true;
  blinkStep_ = 0;
  blinkStepAt_ = millis();
  lcd.noBacklight();
}

void Display::tick() {
  if (!blinking_) return;
  if (millis() - blinkStepAt_ < kBlinkMs) return;

  blinkStep_++;
  blinkStepAt_ = millis();

  if (blinkStep_ >= kBlinkSteps) {
    blinking_ = false;
    lcd.backlight();
    return;
  }

  if (blinkStep_ % 2 == 0) {
    lcd.noBacklight();
  } else {
    lcd.backlight();
  }
}
```

- [ ] **Step 3: Verify the column arithmetic by inspection**

`%-11s` pads the label to 11 characters (columns 0-10), then `%02ld:%02ld` writes 5 characters into columns 11-15 — exactly 16. `"Focus"` becomes `Focus      24:13`. `%-15s%c` fills columns 0-14 then places the marker at column 15.

`snprintf` into `char[17]` guarantees a terminator at index 16, so `writeRow`'s 16-column loop never reads past the buffer.

- [ ] **Step 4: Commit**

```bash
git add firmware/PomoLink/Display.h firmware/PomoLink/Display.cpp
git commit -m "feat(firmware): add flicker-free 16x2 LCD rendering"
```

---

### Task 9: Network client and sketch entry point

**Files:**
- Create: `firmware/PomoLink/PomoClient.h`, `firmware/PomoLink/PomoClient.cpp`
- Create: `firmware/PomoLink/PomoLink.ino`

**Interfaces:**
- Consumes: `TimerModel`, `ConnState` (Task 7); `Gesture` (Task 6).
- Produces: `PomoClient::begin(TimerModel*)`, `::tick()`, `::state() const -> ConnState`, `::sendGesture(Gesture)`, `::setPhaseCompleteHandler(void (*)(const char*))`

- [ ] **Step 1: Write the header**

Create `firmware/PomoLink/PomoClient.h`:

```cpp
#pragma once
#include <Arduino.h>

#include "Buttons.h"
#include "TimerModel.h"

// Owns WiFi, mDNS discovery, the WebSocket connection and REST commands.
//
// Commands go out over REST and state comes back over the WebSocket, matching
// the contract in docs/protocol.md. This client never writes canonical state:
// it does not optimistically update the model after sending a command, it waits
// for the phone's broadcast, so what the LCD shows is always something the
// phone actually said.
class PomoClient {
 public:
  void begin(TimerModel* model);
  void tick();

  ConnState state() const { return state_; }

  // Ignored unless state() == CONN_SYNCED. Commands are never queued for
  // replay: a command applied minutes late would control a timer the user has
  // since changed.
  void sendGesture(Gesture gesture);

  // Called with "work", "short" or "long" when the phone reports a phase ran
  // down on its own.
  void setPhaseCompleteHandler(void (*handler)(const char* phase));

 private:
  void tickWifi();
  void tickDiscovery();
  void tickWebSocket();
  void tickHeartbeat();
  void onWebSocketText(const char* payload, size_t length);
  bool postCommand(const char* path, const char* body);
  bool fetchStatus();
  void setState(ConnState next);
  void scheduleRetry();

  TimerModel* model_ = nullptr;
  ConnState state_ = CONN_BOOT;
  void (*phaseCompleteHandler_)(const char*) = nullptr;

  String host_;
  uint16_t port_ = 0;
  unsigned long lastContactAt_ = 0;
  unsigned long lastPollAt_ = 0;
  unsigned long retryAfter_ = 0;
  uint8_t retryCount_ = 0;
};
```

- [ ] **Step 2: Write the implementation**

Create `firmware/PomoLink/PomoClient.cpp`:

```cpp
#include "PomoClient.h"

#include <ArduinoJson.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WiFi.h>
#include <ESP8266mDNS.h>
#include <WebSocketsClient.h>

#include "secrets.h"

namespace {

const unsigned long kPollIntervalMs = 30000;
const unsigned long kStaleAfterMs = 45000;
const unsigned long kBaseRetryMs = 1000;
const unsigned long kMaxRetryMs = 30000;
const uint16_t kHttpTimeoutMs = 4000;

WebSocketsClient webSocket;
PomoClient* activeClient = nullptr;

}  // namespace

void PomoClient::begin(TimerModel* model) {
  model_ = model;
  activeClient = this;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  setState(CONN_WIFI);
}

void PomoClient::setPhaseCompleteHandler(void (*handler)(const char* phase)) {
  phaseCompleteHandler_ = handler;
}

void PomoClient::setState(ConnState next) {
  if (state_ == next) return;
  state_ = next;
  Serial.printf("[PomoClient] state -> %d\n", (int)next);
}

void PomoClient::scheduleRetry() {
  unsigned long backoff = kBaseRetryMs << (retryCount_ < 5 ? retryCount_ : 5);
  if (backoff > kMaxRetryMs) backoff = kMaxRetryMs;
  if (retryCount_ < 5) retryCount_++;
  retryAfter_ = millis() + backoff;
}

void PomoClient::tick() {
  webSocket.loop();

  switch (state_) {
    case CONN_BOOT:
    case CONN_WIFI:
      tickWifi();
      break;
    case CONN_DISCOVERING:
      tickDiscovery();
      break;
    case CONN_OFFLINE:
      // Stay visibly OFFLINE while retrying, so the LCD keeps showing '!'
      // instead of flickering back to the connecting marker every backoff.
      tickDiscovery();
      break;
    case CONN_CONNECTING:
    case CONN_SYNCED:
      tickWebSocket();
      tickHeartbeat();
      break;
    case CONN_UNPAIRED:
      // Terminal until reflashed with a valid token. Retrying would only
      // hammer the phone's unauthorized rate limiter.
      break;
  }
}

void PomoClient::tickWifi() {
  if (WiFi.status() != WL_CONNECTED) return;

  Serial.print("[PomoClient] WiFi up, IP ");
  Serial.println(WiFi.localIP());
  if (!MDNS.begin("pomolink")) {
    Serial.println("[PomoClient] mDNS responder failed to start");
  }
  retryCount_ = 0;
  retryAfter_ = 0;
  setState(CONN_DISCOVERING);
}

void PomoClient::tickDiscovery() {
  if (WiFi.status() != WL_CONNECTED) {
    setState(CONN_WIFI);
    return;
  }
  if (millis() < retryAfter_) return;

  MDNS.update();
  const int found = MDNS.queryService("pomo", "tcp");
  if (found > 0) {
    host_ = MDNS.IP(0).toString();
    port_ = MDNS.port(0);
    Serial.printf("[PomoClient] discovered %s:%u\n", host_.c_str(), port_);
  } else if (strlen(POMO_HOST_FALLBACK) > 0) {
    host_ = POMO_HOST_FALLBACK;
    port_ = POMO_PORT_FALLBACK;
    Serial.printf("[PomoClient] mDNS miss, using fallback %s:%u\n", host_.c_str(), port_);
  } else {
    Serial.println("[PomoClient] mDNS miss, no fallback configured");
    scheduleRetry();
    return;
  }

  webSocket.begin(host_, port_, "/ws");
  webSocket.onEvent([](WStype_t type, uint8_t* payload, size_t length) {
    if (activeClient == nullptr) return;
    if (type == WStype_CONNECTED) {
      char hello[160];
      snprintf(hello, sizeof(hello), "{\"type\":\"hello\",\"token\":\"%s\"}", POMO_TOKEN);
      webSocket.sendTXT(hello);
    } else if (type == WStype_TEXT) {
      activeClient->onWebSocketText((const char*)payload, length);
    }
  });
  webSocket.setReconnectInterval(kMaxRetryMs);

  lastContactAt_ = millis();
  lastPollAt_ = 0;
  setState(CONN_CONNECTING);
}

void PomoClient::tickWebSocket() {
  if (WiFi.status() != WL_CONNECTED) {
    webSocket.disconnect();
    setState(CONN_WIFI);
  }
}

void PomoClient::tickHeartbeat() {
  const unsigned long now = millis();

  // The 30s poll corrects any drift, re-seeds state after a missed broadcast,
  // and detects a half-open socket that webSocket.loop() still believes is up.
  if (now - lastPollAt_ >= kPollIntervalMs) {
    lastPollAt_ = now;
    if (fetchStatus()) {
      lastContactAt_ = now;
      if (state_ != CONN_UNPAIRED) setState(CONN_SYNCED);
    }
  }

  if (state_ != CONN_UNPAIRED && (now - lastContactAt_) >= kStaleAfterMs) {
    Serial.println("[PomoClient] no contact, going offline");
    webSocket.disconnect();
    scheduleRetry();
    // Deliberately NOT CONN_DISCOVERING: tick() drives rediscovery from the
    // OFFLINE state, so the LCD keeps showing '!' the whole time the phone is
    // actually unreachable rather than a misleading 'connecting' marker.
    setState(CONN_OFFLINE);
  }
}

void PomoClient::onWebSocketText(const char* payload, size_t length) {
  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    Serial.printf("[PomoClient] bad frame: %s\n", error.c_str());
    return;
  }

  const char* type = doc["type"] | "";
  lastContactAt_ = millis();

  if (strcmp(type, "state") == 0) {
    JsonObject data = doc["data"];
    if (data.isNull()) return;
    model_->applyState(data["status"] | "stopped", data["phase"] | "work",
                       data["remaining"] | 0.0, data["duration"] | 0.0,
                       data["completed"] | 0, data["daily_goal"] | 8);
    // A good frame proves the path works end to end, so the next disconnect
    // starts backing off from 1s again rather than from a 30s ceiling.
    retryCount_ = 0;
    setState(CONN_SYNCED);
    return;
  }

  if (strcmp(type, "event") == 0) {
    const char* event = doc["event"] | "";
    if (strcmp(event, "phase_complete") == 0 && phaseCompleteHandler_ != nullptr) {
      phaseCompleteHandler_(doc["phase"] | "work");
    }
    return;
  }

  // Unknown frame types are ignored by contract — see docs/protocol.md.
}

bool PomoClient::fetchStatus() {
  if (host_.length() == 0) return false;

  WiFiClient client;
  HTTPClient http;
  char url[64];
  snprintf(url, sizeof(url), "http://%s:%u/api/status", host_.c_str(), port_);

  http.setTimeout(kHttpTimeoutMs);
  if (!http.begin(client, url)) return false;
  http.addHeader("X-Pomo-Token", POMO_TOKEN);

  const int code = http.GET();
  if (code == 401) {
    Serial.println("[PomoClient] token rejected");
    http.end();
    setState(CONN_UNPAIRED);
    return false;
  }
  if (code != 200) {
    http.end();
    return false;
  }

  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, http.getString());
  http.end();
  if (error) return false;

  model_->applyState(doc["status"] | "stopped", doc["phase"] | "work",
                     doc["remaining"] | 0.0, doc["duration"] | 0.0,
                     doc["completed"] | 0, doc["daily_goal"] | 8);
  return true;
}

bool PomoClient::postCommand(const char* path, const char* body) {
  if (host_.length() == 0) return false;

  WiFiClient client;
  HTTPClient http;
  char url[64];
  snprintf(url, sizeof(url), "http://%s:%u%s", host_.c_str(), port_, path);

  http.setTimeout(kHttpTimeoutMs);
  if (!http.begin(client, url)) return false;
  http.addHeader("X-Pomo-Token", POMO_TOKEN);
  http.addHeader("Content-Type", "application/json");

  const int code = http.POST(body);
  http.end();

  if (code == 401) {
    setState(CONN_UNPAIRED);
    return false;
  }
  if (code == 200) {
    lastContactAt_ = millis();
    return true;
  }
  Serial.printf("[PomoClient] %s failed, code %d\n", path, code);
  return false;
}

void PomoClient::sendGesture(Gesture gesture) {
  if (state_ != CONN_SYNCED) return;

  switch (gesture) {
    case GESTURE_SINGLE:
      postCommand("/api/toggle", "");
      break;
    case GESTURE_DOUBLE:
      postCommand("/api/skip", "");
      break;
    case GESTURE_TRIPLE:
      postCommand("/api/reset", "");
      break;
    case GESTURE_HOLD:
      postCommand("/api/extend", "{\"seconds_delta\":300}");
      break;
    case GESTURE_NONE:
      break;
  }
}
```

- [ ] **Step 3: Write the sketch entry point**

Create `firmware/PomoLink/PomoLink.ino`:

```cpp
// PomoLink — an ESP8266 desk display and remote for the Pomo Android app.
//
// The phone owns the timer. This device renders broadcast state and sends
// button gestures to the phone's REST API. It runs no timer of its own and
// never records a session.
//
// See firmware/README.md for wiring, libraries and flashing steps.

#include "Buttons.h"
#include "Buzzer.h"
#include "Display.h"
#include "PomoClient.h"
#include "TimerModel.h"

namespace {

const uint8_t kButtonPin = 0;   // GPIO0, the onboard FLASH button
const uint8_t kBuzzerPin = D5;

TimerModel model;
Display display;
Buttons buttons;
Buzzer buzzer;
PomoClient client;

void onPhaseComplete(const char* phase) {
  if (strcmp(phase, "work") == 0) {
    buzzer.playWorkComplete();
    display.blinkBacklight();
  } else {
    buzzer.playBreakComplete();
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println("PomoLink starting");

  display.begin();
  buttons.begin(kButtonPin);
  buzzer.begin(kBuzzerPin);

  client.setPhaseCompleteHandler(onPhaseComplete);
  client.begin(&model);

  display.render(model, client.state());
}

// No delay() anywhere in this loop. The WebSocket must be pumped every
// iteration; a blocking melody or debounce would stall it and drop the
// connection.
void loop() {
  client.tick();

  const Gesture gesture = buttons.tick();
  if (gesture != GESTURE_NONE) {
    client.sendGesture(gesture);
  }

  buzzer.tick();
  display.tick();
  display.render(model, client.state());
}
```

- [ ] **Step 4: Check every include resolves**

```bash
ls firmware/PomoLink/
```

Expected: `Buttons.cpp Buttons.h Buzzer.cpp Buzzer.h Display.cpp Display.h PomoClient.cpp PomoClient.h PomoLink.ino TimerModel.cpp TimerModel.h secrets.h.example`

`PomoClient.cpp` includes `secrets.h`, which is gitignored and does not exist in the repo. That is expected — it is created at flash time from the example. The sketch cannot compile without it, which is the intended failure mode.

- [ ] **Step 5: Commit**

```bash
git add firmware/PomoLink/PomoClient.h firmware/PomoLink/PomoClient.cpp \
        firmware/PomoLink/PomoLink.ino
git commit -m "feat(firmware): add discovery, WebSocket sync and REST commands"
```

Confirm `git status` still does not list `secrets.h`.

---

### Task 10: Open the PR and hand off for hardware verification

Firmware cannot be compiled or run on this machine. This task ends with a PR and an explicit hardware gate that only Raja can close.

**Files:** none

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/nodemcu-hardware-timer
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat: NodeMCU desk timer synced with the Pomo phone API" --body "$(cat <<'EOF'
Adds an ESP8266 NodeMCU desk device that mirrors and controls the Pomo timer over the LAN, so a silenced phone in another room still gets an audible alarm and physical controls.

The device is a thin client alongside the widget and `desktop-client/` — `PomodoroService` stays the sole write boundary. It renders broadcast state and sends commands; it runs no timer and records no history.

## Android (additive, ~150 lines)

- `PhoneMessages` — WebSocket frame builders extracted from `PhoneServer` so frame shape is unit-testable
- `PhoneServer.broadcastEvent()` — new `{"type":"event","event":"phase_complete","phase":"work"}` frame, sent from `onTimerComplete()`. Lets the device ring on a real completion and stay silent on skip/reset, which state snapshots alone cannot distinguish
- `PomoServiceAdvertiser` — advertises `_pomo._tcp` over mDNS while the phone API is serving, so the device finds the phone by name instead of an IP that breaks on every DHCP lease. Follows the existing enable toggle, wifi-only mode and port setting
- Protocol and architecture docs updated

No UI changes. No new permissions. `desktop-client/` polls REST and opens no WebSocket, so it is unaffected.

## Firmware (`firmware/PomoLink/`)

Invisible to Gradle and CI. Verified on hardware, not in CI.

- Non-blocking throughout — no `delay()` in the loop path, since a blocking melody would stall `webSocket.loop()` and drop the connection
- Offline behaviour is sync-only: the display holds its last known state, buttons are ignored, and nothing is ever recorded or replayed

Buttons: single = toggle, double = skip, triple = reset, hold 1s = +5 min.

## Verification

Unit tests cover frame shape and advertiser idempotency. Hardware checks are tracked in the plan and must pass before merge.

Spec: `docs/superpowers/specs/2026-07-22-nodemcu-hardware-timer-design.md`
Plan: `docs/superpowers/plans/2026-07-22-nodemcu-hardware-timer.md`
EOF
)"
```

- [ ] **Step 3: Confirm CI is green**

```bash
gh pr checks --watch
```

`ktlintCheck`, `testDevDebugUnitTest` and `assembleDevDebug` must all pass. Fix any failure before handing over — do not ask Raja to flash against a red build.

- [ ] **Step 4: Hand the hardware gate to Raja**

Report these steps for him to run, and stop. Do not claim the feature works until he reports back.

1. Install the dev debug APK and enable the phone API in Pomo Settings.
2. Copy `firmware/PomoLink/` to the Windows machine, rename `secrets.h.example` to `secrets.h`, fill in WiFi credentials and the pairing token from Pomo Settings, flash to NodeMCU 1.0.
3. Idle device shows `Pomo` plus the configured work duration.
4. Start on phone → LCD switches to `Focus` and counts down within ~1 s.
5. Single click → phone pauses within ~1 s. Click again → resumes.
6. Double click → phone advances phase. Triple click → phone resets phase.
7. Hold 1 s → phone's remaining time jumps by 5 minutes.
8. Let a work phase run to zero **with the phone screen off for the full 25 minutes** → buzzer plays the reward melody, backlight blinks 3x, and the session appears in Pomo's history. This is the doze check.
9. Press skip mid-phase → phone advances and the buzzer stays **silent**.
10. Force-stop Pomo → LCD shows `!` within 45 s and buttons stop working.
11. Reopen Pomo → device reconnects and snaps to the phone's state.
12. Reboot the router so the phone gets a new IP → device rediscovers with no reflash.
13. Rotate the pairing token in Settings → LCD shows `?`.

If step 12 fails, the router is blocking mDNS multicast: set `POMO_HOST_FALLBACK` in `secrets.h` and reflash. That is a known-supported outcome, not a bug.
