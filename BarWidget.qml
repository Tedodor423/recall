import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "ServiceModel.js" as Model

// Bar glyph with the number of due cards and the time to the next pop-up.
// Left click: quick panel. Right click: review now. Middle click: pause/resume.
BarWidget {
  id: root
  moduleName: "theo.recall"

  // The service can come up after the bar (or be recreated by a plugin
  // reload), and serviceFor() is not a notifying binding, so poll until found.
  property var service: null

  function lookupService() {
    var s = bar && bar.shell && typeof bar.shell.serviceFor === "function" ? bar.shell.serviceFor(root.moduleName) : null
    if (s !== root.service) root.service = s
  }

  readonly property string glyph: "󰧑"
  readonly property string countText: !service || !service.ready ? "…" : (service.vaultOk ? String(service.stats.due) : "!")
  readonly property string timerText: {
    if (!service) return ""
    if (service.timerState === "paused") return "󰏤"
    if (service.timerState === "scheduled") return Model.shortCountdown(service.nextPopupIn)
    return ""
  }
  readonly property string displayText: glyph + " " + countText + (timerText ? " " + timerText : "")
  readonly property var verticalLines: [glyph, countText].concat(timerText ? [timerText] : [])

  readonly property string tooltip: {
    if (!service) return "Recall"
    if (!service.ready) return service.error ? "Recall · " + service.error : "Recall · loading the vault…"
    if (!service.vaultOk) return "Recall · " + (service.error || "vault unavailable")
    var t = service.stats.due + " due · " + service.stats.fresh + " new"
    switch (service.timerState) {
    case "off": return t + " · pop-ups off"
    case "paused": return t + " · paused" + (service.pausedForever ? "" : " until " + Model.clockTime(service.pausedUntil))
    case "quiet": return t + " · quiet hours"
    case "open": return t
    case "scheduled": return t + " · next card in " + Model.formatCountdown(service.nextPopupIn)
    }
    return t
  }

  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false
  readonly property real openPanelIndicatorWidth: button.labelWidth
  readonly property real openPanelIndicatorHeight: Math.max(Style.space(10), Math.round(Style.bar.iconSlot * 0.55))

  function open() { if (panelLoader.item) panelLoader.item.open() }
  function close() { if (panelLoader.item) panelLoader.item.close() }
  function togglePanel() { if (panelLoader.item) panelLoader.item.toggle() }
  function closeForPopoutSwitch() { if (panelLoader.item) panelLoader.item.closeForPopoutSwitch() }

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
    if ("service" in target) target.service = root.service
  }

  function togglePause() {
    if (!root.service) return
    if (root.service.paused) root.service.resume()
    else root.service.pause(60)
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: { lookupService(); injectPanel() }
  onSettingsChanged: injectPanel()
  onServiceChanged: injectPanel()
  Component.onCompleted: lookupService()

  Timer {
    interval: root.service ? 5000 : 1000
    running: true
    repeat: true
    onTriggered: root.lookupService()
  }

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("RecallPanel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  IpcHandler {
    target: "theo.recall.panel"

    function open(): void { root.broadcast("open") }
    function close(): void { root.broadcast("close") }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.togglePanel() }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.vertical ? "" : root.displayText
    labelVisible: !root.vertical
    hasVisualContent: root.displayText !== ""
    tooltipText: root.tooltip
    dimmed: !!root.service && root.service.ready && root.service.vaultOk && root.service.stats.due === 0
    horizontalMargin: 8.75
    verticalPadding: 8.75
    fixedHeight: root.vertical ? root.verticalLines.length * Style.bar.iconSlot : -1

    onPressed: function(b) {
      if (b === Qt.RightButton) {
        if (root.service) root.service.open("review")
      } else if (b === Qt.MiddleButton) {
        root.togglePause()
      } else {
        root.togglePanel()
      }
    }

    Column {
      visible: root.vertical
      anchors.fill: parent

      Repeater {
        model: root.verticalLines

        OpticalGlyph {
          required property string modelData
          width: button.width
          height: Style.bar.iconSlot
          text: modelData
          fontFamily: button.fontFamily
          fontSize: modelData.length > 3 ? button.fontSize * 0.85 : button.fontSize
          color: button.foreground
        }
      }
    }
  }
}
