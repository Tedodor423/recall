import QtQuick
import Quickshell
import Quickshell.Wayland
import Quickshell.Hyprland
import qs.Commons
import qs.Commons as Commons
import qs.Ui

// Overlay entry point (kind "overlay"). Dims every screen and shows the card
// surface (UiSurface.qml) on the screen that had focus when it opened.
//
// The open state lives in the service (Service.qml): `opened` is bound to
// service.overlayOpen, and the plugin contract below only forwards to it.
//   shell summon/toggle -> open(payload) -> service.open(mode)  (unless the
//                                           service summoned us itself)
//   shell hide          -> close()       -> service.close()     (unless the
//                                           service is the one closing)
// Service.open/close call shell.summon/hide in turn; the overlayOpen checks
// stop that from looping.
Item {
  id: root

  property var shell: null
  property var manifest: null
  property var service: null

  readonly property string pluginId: (manifest && manifest.id) ? manifest.id : "theo.recall"
  readonly property var svc: service || (shell && typeof shell.serviceFor === "function" ? shell.serviceFor(pluginId) : null)
  readonly property bool opened: !!(svc && svc.overlayOpen)
  readonly property bool locked: !!(svc && svc.popupMode && svc.cfg && svc.cfg.strict)

  property string activeScreen: ""
  property string entryMode: "review"

  function parsePayload(payloadJson) {
    var p = ({})
    try { p = JSON.parse(payloadJson || "{}") } catch (e) { p = ({}) }
    return (p && typeof p === "object") ? p : ({})
  }

  function pickScreen() {
    var m = Hyprland.focusedMonitor
    root.activeScreen = m ? m.name : (Quickshell.screens.length ? Quickshell.screens[0].name : "")
  }

  // ------------------------------------------------------- plugin contract
  function open(payloadJson) {
    var p = parsePayload(payloadJson)
    var mode = typeof p.mode === "string" ? p.mode : ""
    pickScreen()
    if (!root.svc) return
    if (root.svc.overlayOpen) {
      // The service summoned us (or we are already showing).
      root.entryMode = root.svc.mode
      return
    }
    root.entryMode = mode || "review"
    if (p.popup === true && typeof root.svc.openPopup === "function") root.svc.openPopup()
    else root.svc.open(mode || "review")
  }

  function close() {
    if (root.svc && root.svc.overlayOpen) root.svc.close()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.open("{}")
  }

  onOpenedChanged: if (opened) { if (!activeScreen) pickScreen() } else activeScreen = ""

  Variants {
    model: Quickshell.screens

    PanelWindow {
      id: win
      required property var modelData
      readonly property bool isActive: root.activeScreen === "" ? (Quickshell.screens.length && Quickshell.screens[0] === modelData)
                                                                : modelData.name === root.activeScreen
      screen: modelData
      visible: root.opened
      color: "transparent"
      anchors { top: true; bottom: true; left: true; right: true }
      exclusionMode: ExclusionMode.Ignore
      WlrLayershell.namespace: "theo-recall"
      WlrLayershell.layer: WlrLayer.Overlay
      WlrLayershell.keyboardFocus: win.isActive ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

      Rectangle {
        anchors.fill: parent
        color: Util.alpha(Commons.Color.background, 0.82)
      }

      // Clicking the dimmed area closes, except for a strict pop-up.
      MouseArea {
        anchors.fill: parent
        onClicked: if (!root.locked) root.close()
      }

      Loader {
        id: surfaceLoader
        active: win.isActive && root.opened
        anchors.centerIn: parent
        sourceComponent: UiSurface {
          service: root.svc
          entryMode: root.entryMode
          availableWidth: win.width
          availableHeight: win.height
        }
        onLoaded: item.forceActiveFocus()
      }
    }
  }
}
