import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui

// Review mode: context line, the card (front, then the back under a rule once
// revealed -- a cloze shows its back in place of the front, like the Spaced
// Repetition plugin), and big touch targets for reveal and the four grades.
Column {
  id: root

  property var surface: null
  property var service: null
  property bool snoozeOpen: false
  property double revealedAt: 0
  // Input is ignored for a moment after a card appears, so keys typed into
  // whatever was focused when a pop-up opened (or a held key) cannot reveal
  // and grade a card the user never saw.
  property double armedAt: Date.now()
  readonly property int armDelay: 700
  readonly property int gradeDelay: 400

  readonly property var card: service ? service.current : null
  readonly property bool revealed: !!(service && service.revealed && card)
  readonly property bool cloze: !!(card && card.type === "cloze")
  readonly property bool locked: !!(surface && surface.locked)
  readonly property bool busy: !!(service && service.busy)
  // Response values (engine/Osr.js): Easy 0, Good 1, Hard 2, Again 3.
  readonly property var grades: [
    { key: "1", label: "Again", response: 3, tone: "urgent" },
    { key: "2", label: "Hard", response: 2, tone: "fg" },
    { key: "3", label: "Good", response: 1, tone: "accent" },
    { key: "4", label: "Easy", response: 0, tone: "fg" }
  ]
  readonly property string hints: {
    if (!card) return "a add · s stats · , settings · esc close"
    var h = revealed ? "1–4 grade · space good" : "space reveal"
    if (!locked) h += " · esc skip"
    h += " · z snooze · o obsidian · ↑↓ scroll · a add · s stats · , settings"
    return h
  }

  function fileUrl(p) { return Util.fileUrl(p) }

  function resolver() {
    var svc = root.service
    var from = root.card ? root.card.path : ""
    return function(name) { return svc && typeof svc.resolveEmbed === "function" ? svc.resolveEmbed(name, from) : "" }
  }

  // Drawings are the .md files in the Excalidraw plugin's folder.
  function drawingTest() {
    var exc = root.service && root.service.excalidraw ? root.service.excalidraw : null
    var folder = exc && typeof exc.folder === "string" ? exc.folder.replace(/^\/+|\/+$/g, "") : ""
    var vault = root.service && root.service.vaultPath ? root.service.vaultPath : ""
    return function(path, name) {
      var p = String(path)
      if (/\.excalidraw(\.md)?$/i.test(p)) return true
      if (!/\.md$/i.test(p)) return false
      if (folder && vault && p.indexOf(vault + "/" + folder + "/") === 0) return true
      return /(^|\/)excalidraw\//i.test(p)
    }
  }

  function armed() { return Date.now() - root.armedAt >= root.armDelay }
  function rearm() { root.armedAt = Date.now() }

  function reveal() {
    if (!root.card || root.revealed || !armed()) return
    root.revealedAt = Date.now()
    root.service.reveal()
  }

  function grade(response) {
    if (!root.card || !root.revealed || root.busy || !armed()) return
    if (Date.now() - root.revealedAt < root.gradeDelay) return
    root.snoozeOpen = false
    root.service.grade(response)
  }

  function snooze(minutes) {
    root.snoozeOpen = false
    if (root.service) root.service.snooze(minutes)
  }

  function openNote() {
    if (!root.card || !root.service) return
    root.service.openInObsidian(root.card.path)
    root.service.close()
  }

  function scroll(dy) {
    var max = Math.max(0, flick.contentHeight - flick.height)
    flick.contentY = Math.max(0, Math.min(max, flick.contentY + dy))
  }

  function handleKey(event) {
    var k = event.key
    var t = event.text ? event.text.toLowerCase() : ""
    if (root.snoozeOpen) {
      if (t === "1") { snooze(5); return true }
      if (t === "2") { snooze(15); return true }
      if (t === "3") { snooze(60); return true }
      if (t === "z") { root.snoozeOpen = false; return true }
      return false
    }
    if (k === Qt.Key_Space || k === Qt.Key_Return || k === Qt.Key_Enter) {
      if (!root.card) return false
      if (event.isAutoRepeat) return true
      if (!root.revealed) reveal()
      else grade(1)
      return true
    }
    if (t >= "1" && t <= "4" && t.length === 1) {
      if (event.isAutoRepeat) return true
      if (root.revealed) grade(root.grades[parseInt(t) - 1].response)
      else reveal()
      return true
    }
    if (t === "z") { root.snoozeOpen = true; return true }
    if (t === "o") { openNote(); return true }
    if (t === "a") { root.surface.setMode("add"); return true }
    if (t === "s") { root.surface.setMode("stats"); return true }
    if (t === ",") { root.surface.setMode("settings"); return true }
    var step = root.surface ? root.surface.cardFontSize * 3 : 60
    if (k === Qt.Key_Down || t === "j") { scroll(step); return true }
    if (k === Qt.Key_Up || t === "k") { scroll(-step); return true }
    if (k === Qt.Key_PageDown) { scroll(flick.height * 0.9); return true }
    if (k === Qt.Key_PageUp) { scroll(-flick.height * 0.9); return true }
    return false
  }

  onCardChanged: { flick.contentY = 0; root.snoozeOpen = false; rearm() }
  onVisibleChanged: if (visible) rearm()
  onRevealedChanged: if (revealed && !cloze) Qt.callLater(function() {
    // Bring the answer into view when the front alone already filled the box.
    if (backFace.y > flick.height * 0.6) flick.contentY = Math.min(Math.max(0, flick.contentHeight - flick.height), separator.y)
  })

  spacing: Style.spacing.lg

  // ----------------------------------------------------------- context
  Item {
    id: contextRow
    width: parent.width
    height: Math.max(tagText.implicitHeight, statusText.implicitHeight)
    visible: !!root.card

    Row {
      width: parent.width - statusText.implicitWidth - Style.spacing.lg
      spacing: Style.spacing.md
      clip: true
      Text {
        id: tagText
        textFormat: Text.PlainText
        text: root.card ? root.card.tag : ""
        color: root.surface.accent
        font.family: root.surface.fontFamily
        font.pixelSize: Style.font.body
        font.bold: true
        width: Math.min(implicitWidth, parent.width * 0.55)
        elide: Text.ElideMiddle
      }
      Text {
        textFormat: Text.PlainText
        text: {
          if (!root.card) return ""
          var parts = [root.card.noteTitle].concat(root.card.context || [])
          return parts.filter(function(x) { return x }).join("  ›  ")
        }
        color: root.surface.muted
        font.family: root.surface.fontFamily
        font.pixelSize: Style.font.body
        width: parent.width - tagText.width - parent.spacing
        elide: Text.ElideLeft
      }
    }

    Text {
      id: statusText
      anchors.right: parent.right
      textFormat: Text.PlainText
      text: {
        if (!root.card) return ""
        var s = root.card.isNew ? "new" : "ivl " + root.shortDays(root.card.interval)
        if (root.service && root.service.sessionTarget > 1)
          s += "  ·  " + Math.min(root.service.sessionDone + 1, root.service.sessionTarget) + "/" + root.service.sessionTarget
        else if (root.service && root.service.sessionDone > 0)
          s += "  ·  " + root.service.sessionDone + " done"
        return s
      }
      color: root.surface.muted
      font.family: root.surface.fontFamily
      font.pixelSize: Style.font.body
    }
  }

  function shortDays(d) {
    if (d === null || d === undefined) return "–"
    if (d < 31) return d + "d"
    if (d < 365) return Math.round(d / 3.04375) / 10 + "mo"
    return Math.round(d / 36.525) / 10 + "y"
  }

  // -------------------------------------------------------------- card
  Flickable {
    id: flick
    width: parent.width
    visible: !!root.card
    readonly property real avail: root.surface.maxBodyHeight - contextRow.height - actions.height - root.spacing * 3
    height: Math.max(Math.min(Style.space(150), avail), Math.min(contentHeight, avail))
    contentWidth: width
    contentHeight: faces.height
    clip: true
    boundsBehavior: Flickable.StopAtBounds
    flickableDirection: Flickable.VerticalFlick

    Column {
      id: faces
      width: flick.width - (flick.contentHeight > flick.height ? Style.space(10) : 0)
      spacing: Style.spacing.huge

      CardFace {
        id: frontFace
        visible: !(root.cloze && root.revealed)
        text: root.card ? root.card.front : ""
        resolve: root.resolver()
        isDrawing: root.drawingTest()
        palette: root.surface.cardPalette
        fontFamily: root.surface.fontFamily
        fontSize: root.surface.cardFontSize
        maxWidth: faces.width
        maxImageHeight: Math.max(Style.space(160), root.surface.availableHeight * 0.38)
        dark: root.surface.dark
      }

      Item {
        id: separator
        width: parent.width
        height: Style.font.caption + Style.spacing.md
        visible: root.revealed && !root.cloze
        Rectangle {
          anchors.verticalCenter: parent.verticalCenter
          width: parent.width
          height: 1
          color: Util.alpha(root.surface.fg, 0.18)
        }
        Rectangle {
          anchors.centerIn: parent
          width: sepLabel.implicitWidth + Style.spacing.lg * 2
          height: parent.height
          color: root.surface.bg
          Text {
            id: sepLabel
            anchors.centerIn: parent
            textFormat: Text.PlainText
            text: "answer"
            color: root.surface.faint
            font.family: root.surface.fontFamily
            font.pixelSize: Style.font.caption
          }
        }
      }

      CardFace {
        id: backFace
        visible: root.revealed
        text: root.card && root.revealed ? root.card.back : ""
        resolve: root.resolver()
        isDrawing: root.drawingTest()
        palette: root.surface.cardPalette
        fontFamily: root.surface.fontFamily
        fontSize: root.surface.cardFontSize
        maxWidth: faces.width
        maxImageHeight: Math.max(Style.space(160), root.surface.availableHeight * 0.38)
        dark: root.surface.dark
      }
    }

    // Tap the card to reveal (touch).
    TapHandler {
      enabled: !!root.card && !root.revealed
      onTapped: root.reveal()
    }
  }

  // Scroll indicator
  Rectangle {
    visible: flick.visible && flick.contentHeight > flick.height
    parent: flick
    anchors.right: parent.right
    y: flick.height * flick.visibleArea.yPosition
    width: Style.space(4)
    height: Math.max(Style.space(20), flick.height * flick.visibleArea.heightRatio)
    radius: width / 2
    color: Util.alpha(root.surface.fg, 0.3)
  }

  // ------------------------------------------------------------- empty
  Column {
    width: parent.width
    visible: !root.card
    spacing: Style.spacing.huge
    topPadding: Style.space(30)
    bottomPadding: Style.space(30)

    Text {
      width: parent.width
      horizontalAlignment: Text.AlignHCenter
      textFormat: Text.PlainText
      wrapMode: Text.Wrap
      text: {
        var s = root.service
        if (!s) return "No service"
        if (s.scanning && !s.ready) return "Reading the vault…"
        if (!s.vaultOk && s.error) return "The vault could not be read"
        if (s.lastMessage) return s.lastMessage
        return s.stats && (s.stats.due + s.stats.fresh) > 0 ? "Loading a card…" : "Nothing due right now"
      }
      color: root.surface.fg
      font.family: root.surface.fontFamily
      font.pixelSize: Style.font.display
    }
    Text {
      width: parent.width
      horizontalAlignment: Text.AlignHCenter
      textFormat: Text.PlainText
      wrapMode: Text.Wrap
      text: {
        var s = root.service
        if (!s || !s.allStats) return ""
        var next = s.forecast && s.forecast.length > 1 ? s.forecast[1] : 0
        return s.allStats.total + " cards in the vault" + (next ? " · " + next + " due tomorrow" : "")
      }
      color: root.surface.muted
      font.family: root.surface.fontFamily
      font.pixelSize: Style.font.body
    }
    Row {
      anchors.horizontalCenter: parent.horizontalCenter
      spacing: Style.spacing.md
      Button {
        text: "add a card"; bordered: true
        foreground: root.surface.fg; accent: root.surface.accent; fontFamily: root.surface.fontFamily
        onClicked: root.surface.setMode("add")
      }
      Button {
        text: "stats"; bordered: true
        foreground: root.surface.fg; accent: root.surface.accent; fontFamily: root.surface.fontFamily
        onClicked: root.surface.setMode("stats")
      }
      Button {
        text: "rescan"; bordered: true
        foreground: root.surface.fg; accent: root.surface.accent; fontFamily: root.surface.fontFamily
        onClicked: if (root.service) root.service.rescan()
      }
    }
  }

  // ----------------------------------------------------------- actions
  Column {
    id: actions
    width: parent.width
    visible: !!root.card
    spacing: Style.spacing.md

    UiTouchButton {
      width: parent.width
      height: root.surface.touchHeight
      visible: !root.revealed
      title: "show answer"
      keyHint: "space"
      foreground: root.surface.fg
      tone: root.surface.fg
      accent: root.surface.accent
      fontFamily: root.surface.fontFamily
      titleSize: Style.font.heading
      onClicked: root.reveal()
    }

    Row {
      id: gradeRow
      width: parent.width
      visible: root.revealed
      spacing: Style.spacing.md
      Repeater {
        model: root.grades
        delegate: UiTouchButton {
          required property var modelData
          width: (gradeRow.width - gradeRow.spacing * 3) / 4
          height: root.surface.touchHeight
          enabled: !root.busy
          title: modelData.label
          caption: root.card && root.card.intervalLabels ? String(root.card.intervalLabels[modelData.response]) : ""
          keyHint: modelData.key
          foreground: root.surface.fg
          tone: modelData.tone === "urgent" ? root.surface.urgent : modelData.tone === "accent" ? root.surface.accent : root.surface.fg
          accent: root.surface.accent
          emphasized: modelData.tone === "accent"
          fontFamily: root.surface.fontFamily
          titleSize: Style.font.heading
          captionSize: Style.font.body
          onClicked: root.grade(modelData.response)
        }
      }
    }

    // Secondary actions; the snooze choices replace them while open.
    Item {
      width: parent.width
      height: secondary.height

      Row {
        id: secondary
        spacing: Style.spacing.md
        visible: !root.snoozeOpen
        Button {
          text: "skip"; iconText: "󰒭"; bordered: true; visible: !root.locked
          foreground: root.surface.fg; accent: root.surface.accent; fontFamily: root.surface.fontFamily
          tooltipText: "esc"
          onClicked: if (root.service) root.service.skip()
        }
        Button {
          text: "snooze"; iconText: "󰒲"; bordered: true
          foreground: root.surface.fg; accent: root.surface.accent; fontFamily: root.surface.fontFamily
          tooltipText: "z"
          onClicked: root.snoozeOpen = true
        }
        Button {
          text: "open in obsidian"; iconText: "󰏌"; bordered: true
          foreground: root.surface.fg; accent: root.surface.accent; fontFamily: root.surface.fontFamily
          tooltipText: "o"
          onClicked: root.openNote()
        }
      }

      Row {
        spacing: Style.spacing.md
        visible: root.snoozeOpen
        Text {
          anchors.verticalCenter: parent.verticalCenter
          textFormat: Text.PlainText
          text: "snooze for"
          color: root.surface.muted
          font.family: root.surface.fontFamily
          font.pixelSize: Style.font.body
        }
        Repeater {
          model: [{ m: 5, label: "5 min", key: "1" }, { m: 15, label: "15 min", key: "2" }, { m: 60, label: "1 hour", key: "3" }]
          delegate: Button {
            required property var modelData
            text: modelData.label + "  " + modelData.key
            bordered: true
            foreground: root.surface.fg; accent: root.surface.accent; fontFamily: root.surface.fontFamily
            onClicked: root.snooze(modelData.m)
          }
        }
        Button {
          text: "cancel"
          foreground: root.surface.muted; accent: root.surface.accent; fontFamily: root.surface.fontFamily
          onClicked: root.snoozeOpen = false
        }
      }

      Text {
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        textFormat: Text.PlainText
        visible: root.busy
        text: "saving…"
        color: root.surface.muted
        font.family: root.surface.fontFamily
        font.pixelSize: Style.font.bodySmall
      }
    }
  }
}
