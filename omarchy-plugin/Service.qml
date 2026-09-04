import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root

  property var shell: null
  property var manifest: null

  readonly property string sourceDir: manifest && manifest.__sourceDir ? String(manifest.__sourceDir) : ""
  readonly property string linkPath: sourceDir === "" ? "" : sourceDir + "/bin/pomo-link"

  property bool ready: false
  property string mode: "BOOT"
  property string marker: "."
  property string status: "stopped"
  property string phase: "work"
  property int remaining: 0
  property int duration: 0
  property int completed: 0
  property int goal: 8
  property string date: ""
  property string localToday: ""
  property double startTime: 0
  property bool localOwner: false
  property bool everSynced: false
  property string host: ""
  property int port: 9876
  property bool hasToken: false
  property int queueCount: 0
  property string message: ""
  property string lastError: ""
  property bool busy: false
  // Optimistic toggle: set on send, reconciled by the next real status or
  // reverted by an error event. Prevents "still says Start → click again".
  property string pendingToggle: ""
  property string phaseLabel: phaseName(phase, status)

  property bool _intentionalStop: false
  property bool _restartRequested: false
  property int _restartAttempt: 0
  property double _bootAt: 0
  property var _pendingLines: []

  function phaseName(p, st) {
    if (String(st || "") === "paused") return "Paused"
    var value = String(p || "work")
    if (value === "short") return "Break"
    if (value === "long") return "Long"
    return "Focus"
  }

  function toggleLabel() {
    if (pendingToggle !== "")
      return pendingToggle === "running" ? "Pause" : "Resume"
    var st = String(status || "stopped")
    if (st === "running") return "Pause"
    if (st === "paused") return "Resume"
    return "Start"
  }

  function mmss(sec) {
    var n = Math.max(0, Math.floor(Number(sec) || 0))
    var m = Math.floor(n / 60)
    var s = n % 60
    if (m > 999) m = 999
    var mm = m < 10 ? "0" + m : String(m)
    var ss = s < 10 ? "0" + s : String(s)
    return mm + ":" + ss
  }

  function barText() {
    return mmss(remaining) + " " + phaseName(phase, status) + marker
  }

  function connectionLabel() {
    var m = String(mode || "")
    if (m === "SYNCED") return "Synced — phone owns the clock"
    if (m === "OFFLINE") return "Offline — local timer"
    if (m === "UNPAIRED") return "Unpaired — fix the token"
    if (m === "CONNECTING") return "Connecting"
    if (m === "DISCOVERING") return "Discovering phone"
    return "Starting"
  }

  function concise(text) {
    var value = String(text || "").replace(/\s+/g, " ").trim()
    return value.length > 180 ? value.substring(0, 177) + "..." : value
  }

  function daemonCommand() {
    return ["setpriv", "--pdeathsig", "TERM", "python3", "-u", linkPath]
  }

  function startDaemon() {
    if (linkPath === "" || daemonProcess.running) return
    _intentionalStop = false
    ready = false
    mode = "BOOT"
    marker = "."
    _bootAt = Date.now()
    daemonProcess.command = daemonCommand()
    daemonProcess.running = true
  }

  function scheduleRestart(immediate) {
    if (_intentionalStop || linkPath === "") return
    var delay = immediate === true ? 200 : Math.min(15000, 1000 * Math.pow(2, Math.min(_restartAttempt, 4)))
    _restartAttempt++
    restartTimer.interval = delay
    restartTimer.restart()
  }

  function writeLine(text) {
    if (!daemonProcess.running) {
      var queue = _pendingLines.slice()
      queue.push(String(text))
      _pendingLines = queue
      return
    }
    daemonProcess.write(String(text) + "\n")
  }

  function sendCmd(obj) {
    writeLine(JSON.stringify(obj))
  }

  function toggle() {
    pendingToggle = String(status || "stopped") === "running" ? "paused" : "running"
    sendCmd({ cmd: "toggle" })
  }
  function skip() { sendCmd({ cmd: "skip" }) }
  function reset() { sendCmd({ cmd: "reset" }) }
  function extend() { sendCmd({ cmd: "extend" }) }

  function applyPairing(fields) {
    var payload = { cmd: "pair" }
    if (!fields) return
    var pasteUrl = ""
    var pasteToken = ""
    if (fields.pairingJson) {
      try {
        var parsed = JSON.parse(String(fields.pairingJson))
        if (parsed && typeof parsed === "object") {
          if (parsed.url) pasteUrl = String(parsed.url)
          if (parsed.token) pasteToken = String(parsed.token)
        }
      } catch (error) {
        // Discrete fields still apply.
      }
    }
    if (fields.url) payload.url = String(fields.url)
    if (pasteUrl) payload.url = pasteUrl
    if (fields.token) payload.token = String(fields.token)
    if (pasteToken) payload.token = pasteToken
    // Empty host/port must not ride along with a pasted url and unpin it.
    if (!payload.url) {
      if (fields.host !== undefined) payload.host = String(fields.host || "")
      if (fields.port !== undefined && fields.port !== null && fields.port !== "")
        payload.port = Number(fields.port)
    } else if (fields.host) {
      payload.host = String(fields.host)
      if (fields.port !== undefined && fields.port !== null && fields.port !== "")
        payload.port = Number(fields.port)
    }
    sendCmd(payload)
  }

  function flushPending() {
    if (!daemonProcess.running || _pendingLines.length === 0) return
    var lines = _pendingLines.slice()
    _pendingLines = []
    for (var i = 0; i < lines.length; i++) daemonProcess.write(lines[i] + "\n")
  }

  function handleLine(line) {
    var parsed = null
    try {
      parsed = JSON.parse(String(line || ""))
    } catch (error) {
      lastError = concise(line)
      return
    }
    if (!parsed || typeof parsed !== "object") return
    if (parsed.type === "error") {
      lastError = concise(parsed.message)
      pendingToggle = ""
      return
    }
    if (parsed.type === "event" && parsed.event === "phase_complete") {
      notifyPhaseComplete(parsed.phase)
      return
    }
    if (parsed.type !== "status") return
    ready = true
    // A crash-looping engine emitted status before dying; only a process
    // that stayed up this long has earned a backoff reset.
    if (_bootAt > 0 && Date.now() - _bootAt > 30000) _restartAttempt = 0
    startupTimeout.stop()
    mode = String(parsed.mode || mode)
    marker = parsed.marker === undefined || parsed.marker === null ? marker : String(parsed.marker)
    status = String(parsed.status || status)
    phase = String(parsed.phase || phase)
    remaining = Number(parsed.remaining || 0)
    duration = Number(parsed.duration || 0)
    completed = Number(parsed.completed || 0)
    goal = parsed.goal === undefined || parsed.goal === null ? goal : Number(parsed.goal)
    date = typeof parsed.date === "string" ? parsed.date : ""
    localToday = typeof parsed.local_today === "string" ? parsed.local_today : ""
    startTime = Number(parsed.start_time || 0)
    localOwner = parsed.local_owner === true
    everSynced = parsed.ever_synced === true
    busy = parsed.busy === true
    pendingToggle = ""
    host = String(parsed.host || "")
    port = Number(parsed.port || 9876)
    hasToken = parsed.has_token === true
    queueCount = Number(parsed.queue_count || 0)
    message = String(parsed.message || "")
    lastError = ""
  }

  function notifyPhaseComplete(p) {
    var value = String(p || "work")
    var title = "Focus complete"
    if (value === "short") title = "Break complete"
    else if (value === "long") title = "Long break complete"
    Quickshell.execDetached([
      "omarchy-notification-send",
      "--app-name", "Pomo",
      "--urgency", "normal",
      "--glyph", "󰔟",
      title,
      value === "work" ? "Work block finished" : "Break finished"
    ])
  }

  onLinkPathChanged: if (linkPath !== "") launchTimer.restart()

  Component.onDestruction: {
    _intentionalStop = true
    restartTimer.stop()
    if (daemonProcess.running) daemonProcess.running = false
  }

  Timer {
    id: launchTimer
    interval: 100
    repeat: false
    onTriggered: root.startDaemon()
  }

  Timer {
    id: restartTimer
    interval: 1000
    repeat: false
    onTriggered: root.startDaemon()
  }

  Timer {
    id: startupTimeout
    interval: 8000
    repeat: false
    onTriggered: {
      if (!root.ready && daemonProcess.running)
        root.lastError = "Pomo engine did not become ready"
    }
  }

  Process {
    id: daemonProcess
    command: []
    running: false
    stdinEnabled: true
    stdout: SplitParser {
      onRead: function(line) { root.handleLine(line) }
    }
    stderr: SplitParser {
      onRead: function(line) {
        var value = root.concise(line)
        if (value !== "" && value.indexOf("[pomo-link]") !== 0)
          root.lastError = value
      }
    }
    onStarted: {
      root.mode = "BOOT"
      root.marker = "."
      startupTimeout.restart()
      root.flushPending()
    }
    onExited: function(exitCode, exitStatus) {
      startupTimeout.stop()
      root.ready = false
      if (root._intentionalStop) return
      var immediate = root._restartRequested
      root._restartRequested = false
      root.scheduleRestart(immediate)
    }
  }
}
