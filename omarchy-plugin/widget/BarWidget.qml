import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "raja.pomo"

  readonly property var pomo: bar && bar.shell ? bar.shell.serviceFor("raja.pomo") : null
  readonly property string timerIcon: "\uf51b"
  readonly property string barDisplay: {
    var value = String(setting("barDisplay", "Timer + phase") || "").toLowerCase()
    if (value === "timer only" || value === "timer-only") return "timer-only"
    if (value === "icon only" || value === "icon-only") return "icon-only"
    return "timer-phase"
  }
  readonly property bool iconOnly: barDisplay === "icon-only"
  readonly property string timerText: pomo ? pomo.mmss(pomo.remaining) : "00:00"
  property string lastPairingSignature: ""
  property var lastPairingTarget: null
  readonly property string displayText: barDisplay === "timer-only"
    ? timerText
    : (pomo ? pomo.barText() : "00:00 Focus.")
  readonly property var verticalLines: barDisplay === "timer-only"
    ? [timerText]
    : [timerText, pomo ? pomo.phaseName(pomo.phase, pomo.status) : "Focus", pomo ? pomo.marker : "."]

  function refreshHoverTooltip() {
    var target = buttonLoader.item
    if (!root.bar || !target || !target.tooltipHovered) return
    if (root.bar.tooltipTarget === target)
      root.bar.tooltipText = root.timerText
    else if (root.bar.pendingTooltipTarget === target)
      root.bar.pendingTooltipText = root.timerText
  }

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = buttonLoader.item
    if ("hostWidget" in target) target.hostWidget = root
  }

  function pushPairingFromSettings() {
    if (!pomo) return
    if (pomo !== lastPairingTarget) {
      lastPairingTarget = pomo
      lastPairingSignature = ""
    }
    var fields = {}
    var host = setting("host", "")
    var port = setting("port", 9876)
    var token = setting("token", "")
    var paste = setting("pairingJson", "")
    var signature = [String(host || ""), String(port === undefined || port === null ? "" : port),
      String(token || ""), String(paste || "")].join("\u001f")
    if (signature === lastPairingSignature) return
    if (paste !== "") {
      fields.pairingJson = paste
      if (token !== "") fields.token = token
    } else {
      if (host !== "") fields.host = host
      if (port !== undefined && port !== null && port !== "") fields.port = port
      if (token !== "") fields.token = token
    }
    if (Object.keys(fields).length === 0) return
    lastPairingSignature = signature
    pomo.applyPairing(fields)
  }

  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

  function open() {
    if (panelLoader.item) panelLoader.item.open()
  }

  function close() {
    if (panelLoader.item) panelLoader.item.close()
  }

  function togglePanel() {
    if (panelLoader.item) panelLoader.item.toggle()
  }

  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  readonly property real openPanelIndicatorWidth: buttonLoader.item ? buttonLoader.item.labelWidth : 0

  implicitWidth: buttonLoader.item ? buttonLoader.item.implicitWidth : 0
  implicitHeight: buttonLoader.item ? buttonLoader.item.implicitHeight : 0

  onBarChanged: injectPanel()
  onSettingsChanged: {
    injectPanel()
    pushPairingFromSettings()
  }
  onPomoChanged: if (pomo) pushPairingFromSettings()

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  IpcHandler {
    target: "raja.pomo"

    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.togglePanel() }
  }

  Loader {
    id: buttonLoader
    anchors.fill: parent
    active: true
    sourceComponent: root.iconOnly ? iconButtonComponent : textButtonComponent
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  Timer {
    id: hoverTooltipTimer
    interval: 250
    repeat: true
    running: buttonLoader.item ? buttonLoader.item.tooltipHovered : false
    onTriggered: root.refreshHoverTooltip()
  }

  Component {
    id: textButtonComponent

    WidgetButton {
      id: textButton
      anchors.fill: parent
      bar: root.bar
      text: root.vertical ? "" : root.displayText
      labelVisible: !root.vertical
      hasVisualContent: true
      fixedHeight: root.vertical ? 3 * Style.bar.iconSlot : -1
      horizontalMargin: 8.75
      verticalPadding: 8.75
      tooltipText: root.timerText
      active: root.pomo && (root.pomo.mode === "UNPAIRED" || (root.pomo.status === "running"))
      useActiveColor: root.pomo && root.pomo.mode === "UNPAIRED"

      onPressed: function(b) {
        if (b === Qt.MiddleButton) {
          if (root.pomo) root.pomo.toggle()
        } else {
          root.togglePanel()
        }
      }

      Column {
        visible: root.vertical
        anchors.fill: parent

        Repeater {
          model: root.vertical ? root.verticalLines : []

          Text {
            required property string modelData
            width: parent.width
            height: Style.bar.iconSlot
            text: modelData
            color: textButton.foreground
            font.family: textButton.fontFamily
            font.pixelSize: modelData.length > 3 ? textButton.fontSize * 0.9 : textButton.fontSize
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
          }
        }
      }
    }
  }

  Component {
    id: iconButtonComponent

    BarIconButton {
      anchors.fill: parent
      bar: root.bar
      text: root.timerIcon
      tooltipText: root.timerText
      active: root.pomo && (root.pomo.mode === "UNPAIRED" || (root.pomo.status === "running"))
      useActiveColor: root.pomo && root.pomo.mode === "UNPAIRED"

      onPressed: function(b) {
        if (b === Qt.MiddleButton) {
          if (root.pomo) root.pomo.toggle()
        } else {
          root.togglePanel()
        }
      }
    }
  }
}
