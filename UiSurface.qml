import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui

// The card in the middle of the dimmed screen: header (mode tabs + counts),
// the body of the current mode, footer hints. Everything it shows and does
// goes through `service` (Service.qml, or tests/MockService.qml offscreen).
// No window types here, so the harness can host it in a plain window.
BorderSurface {
  id: root

  property var service: null
  property real availableWidth: 1280
  property real availableHeight: 800
  // The mode the overlay was opened in: Esc from add/stats/settings returns
  // to review only when the session started there.
  property string entryMode: "review"

  readonly property var svc: root.service
  readonly property string mode: svc ? svc.mode : "review"
  readonly property var cfg: svc && svc.cfg ? svc.cfg : ({})
  readonly property bool locked: !!(svc && svc.popupMode && cfg.strict)

  // ------------------------------------------------------------- theme
  readonly property color fg: Commons.Color.menu.text
  readonly property color bg: Commons.Color.menu.background
  readonly property color accent: Commons.Color.accent
  readonly property color urgent: Commons.Color.urgent
  readonly property color muted: Util.alpha(fg, 0.55)
  readonly property color faint: Util.alpha(fg, 0.35)
  readonly property string fontFamily: Style.font.family
  readonly property bool dark: (0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b) < 0.5
  readonly property int cardFontSize: Math.round(Style.font.heading * 1.25)
  readonly property var cardPalette: ({
    text: root.fg, muted: root.muted, accent: root.accent, cloze: root.accent, clozeAnswer: root.accent,
    highlight: Util.alpha(root.accent, 0.30), code: root.fg, codeBg: Util.alpha(root.fg, 0.08),
    link: root.accent, border: Util.alpha(root.fg, 0.28)
  })
  readonly property int pad: Style.spacing.panelPadding
  // Big enough for a finger on the touchscreen.
  readonly property int touchHeight: Math.max(Style.space(44), Style.font.heading * 3)

  readonly property real innerWidth: width - leftPadding - rightPadding - borderLeft - borderRight
  readonly property real maxBodyHeight: Math.max(Style.space(200),
    availableHeight * 0.9 - header.height - footer.height - pad * 2 - Style.spacing.panelGap * 3)

  width: Math.min(Style.space(860), Math.max(Style.space(420), availableWidth - Style.gapsOut * 8))
  height: Math.min(availableHeight * 0.9, column.implicitHeight + topPadding + bottomPadding + borderTop + borderBottom)
  radius: Style.cornerRadius
  color: root.bg
  borderSpec: Border.surfaceSpec("menu", "border", Commons.Color.menu.border, Math.max(1, Style.space(2)))
  padding: root.pad

  // The service's last status line ("Saved · next 3 days"), shown for a few
  // seconds after it changes rather than forever.
  property string flash: ""
  Connections {
    target: root.svc
    ignoreUnknownSignals: true
    function onLastMessageChanged() {
      root.flash = root.svc.lastMessage || ""
      if (root.flash) flashTimer.restart()
    }
  }
  Timer { id: flashTimer; interval: 6000; onTriggered: root.flash = "" }

  // ----------------------------------------------------------- actions
  function setMode(m) {
    if (!svc) return
    if (m === svc.mode) { focusMode(); return }
    svc.open(m)
    focusMode()
  }

  function closeOverlay() {
    if (svc) svc.close()
  }

  function back() {
    if (mode !== "review" && (root.entryMode === "review" || (svc && svc.current))) setMode("review")
    else closeOverlay()
  }

  function focusMode() {
    Qt.callLater(function() {
      if (root.mode === "add") addView.focusFirst()
      else keyCatcher.forceActiveFocus()
    })
  }

  // Keys that reach the surface: the key catcher's own, plus anything a
  // focused field in add/settings did not take (Esc, Ctrl+...).
  function handleKey(event) {
    var k = event.key
    var ctrl = (event.modifiers & Qt.ControlModifier) !== 0
    var t = event.text ? event.text.toLowerCase() : ""
    if (ctrl && (k === Qt.Key_W || k === Qt.Key_Q)) {
      if (!root.locked) closeOverlay()
      return true
    }
    if (k === Qt.Key_Escape) {
      if (reviewView.snoozeOpen) { reviewView.snoozeOpen = false; return true }
      if (mode === "review") {
        if (svc && svc.current) { if (!root.locked) svc.skip() }
        else closeOverlay()
      } else back()
      return true
    }
    if (ctrl || (event.modifiers & (Qt.AltModifier | Qt.MetaModifier))) return false
    if (mode === "review") return reviewView.handleKey(event)
    if (mode === "stats" || mode === "settings") {
      if (t === "a") { setMode("add"); return true }
      if (t === "s") { setMode(mode === "stats" ? "review" : "stats"); return true }
      if (t === ",") { setMode(mode === "settings" ? "review" : "settings"); return true }
      if (t === "r") { setMode("review"); return true }
      if (mode === "stats") return statsView.handleKey(event)
    }
    return false
  }

  Keys.onPressed: function(event) { if (root.handleKey(event)) event.accepted = true }

  // Swallow clicks so they do not reach the scrim's close handler.
  MouseArea { anchors.fill: parent; onClicked: keyCatcher.forceActiveFocus() }

  // Holds focus in review/stats/settings; its keys bubble up to Keys above.
  Item {
    id: keyCatcher
    focus: true
  }

  Column {
    id: column
    x: root.contentLeftInset
    y: root.contentTopInset
    width: root.innerWidth
    spacing: Style.spacing.panelGap

    // ---------------------------------------------------------- header
    Item {
      id: header
      width: parent.width
      height: Math.max(tabs.height, countsRow.height)

      Row {
        id: tabs
        spacing: Style.spacing.sm
        anchors.verticalCenter: parent.verticalCenter
        Repeater {
          model: [
            { mode: "review", label: "review", key: "r" },
            { mode: "add", label: "add", key: "a" },
            { mode: "stats", label: "stats", key: "s" },
            { mode: "settings", label: "settings", key: "," }
          ]
          delegate: Button {
            required property var modelData
            text: modelData.label
            selected: root.mode === modelData.mode
            foreground: root.fg
            accent: root.accent
            fontFamily: root.fontFamily
            fontSize: Style.font.body
            verticalPadding: Style.spacing.controlPaddingY + Style.space(2)
            tooltipText: modelData.key
            onClicked: root.setMode(modelData.mode)
          }
        }
      }

      Row {
        id: countsRow
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        spacing: Style.spacing.lg

        Text {
          anchors.verticalCenter: parent.verticalCenter
          textFormat: Text.PlainText
          visible: !!(root.svc && root.svc.scanning)
          text: "scanning…"
          color: root.muted
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
        }
        Text {
          anchors.verticalCenter: parent.verticalCenter
          textFormat: Text.RichText
          text: {
            var s = root.svc && root.svc.stats ? root.svc.stats : { due: 0, fresh: 0 }
            var done = root.svc ? root.svc.todayReviewed : 0
            var a = String(root.accent)
            return '<span style="color:' + a + '">' + s.due + "</span> due · " + s.fresh + " new · " + done + " today"
          }
          color: root.muted
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
        }
        Button {
          anchors.verticalCenter: parent.verticalCenter
          visible: !root.locked
          iconText: "󰅖"
          foreground: root.fg
          accent: root.accent
          fontFamily: root.fontFamily
          tooltipText: "close (ctrl+w)"
          onClicked: root.closeOverlay()
        }
      }
    }

    // ---------------------------------------------------------- banners
    Text {
      width: parent.width
      visible: text !== ""
      textFormat: Text.PlainText
      wrapMode: Text.Wrap
      text: !root.svc ? "The recall service is not running." :
            root.svc.readOnlyReason ? "Read-only: " + root.svc.readOnlyReason :
            (!root.svc.vaultOk && root.svc.error) ? root.svc.error : ""
      color: root.urgent
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }

    // ------------------------------------------------------------ body
    UiReview {
      id: reviewView
      width: parent.width
      visible: root.mode === "review"
      surface: root
      service: root.svc
    }

    UiAdd {
      id: addView
      width: parent.width
      visible: root.mode === "add"
      active: root.mode === "add"
      surface: root
      service: root.svc
    }

    UiStats {
      id: statsView
      width: parent.width
      visible: root.mode === "stats"
      active: root.mode === "stats"
      surface: root
      service: root.svc
    }

    UiSettings {
      id: settingsView
      width: parent.width
      visible: root.mode === "settings"
      active: root.mode === "settings"
      surface: root
      service: root.svc
    }

    // ---------------------------------------------------------- footer
    Item {
      id: footer
      width: parent.width
      height: hints.implicitHeight

      Text {
        id: hints
        width: parent.width - messageText.implicitWidth - Style.spacing.lg
        textFormat: Text.PlainText
        wrapMode: Text.Wrap
        color: root.faint
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        text: {
          if (root.mode === "review") return reviewView.hints
          if (root.mode === "add") return "ctrl+enter save · tab next field · esc " + (root.entryMode === "add" ? "close" : "back")
          if (root.mode === "stats") return "1–4 depth · a add · , settings · esc back"
          return "a add · s stats · esc back"
        }
      }
      Text {
        id: messageText
        anchors.right: parent.right
        anchors.top: parent.top
        width: Math.min(implicitWidth, parent.width * 0.5)
        horizontalAlignment: Text.AlignRight
        textFormat: Text.PlainText
        elide: Text.ElideRight
        visible: text !== ""
        text: root.flash
        color: root.muted
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }
    }
  }

  onModeChanged: focusMode()
  Component.onCompleted: focusMode()
}
