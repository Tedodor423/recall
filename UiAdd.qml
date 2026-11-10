import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui

// Add mode: deck (fuzzy search / create), where the card will be written,
// front and back (multi-line; a drawing pad under either on demand), reversed,
// save. The form stays open after a save with the deck kept, ready for the
// next card.
Item {
  id: root

  property var surface: null
  property var service: null
  property bool active: false

  property string deckTag: ""
  property bool reversed: false
  property bool drawFront: false
  property bool drawBack: false
  property bool saving: false
  property string resultText: ""
  property bool resultOk: true

  readonly property var plan: service && deckTag ? service.planAdd(deckTag) : null
  readonly property var cfg: service && service.cfg ? service.cfg : ({})

  function focusFirst() {
    if (!root.deckTag) deckPicker.focusField()
    else frontField.forceActiveFocus()
  }

  function initDeck() {
    if (root.deckTag || !root.service) return
    var last = root.cfg.lastDeck || ""
    if (last) { root.deckTag = last; return }
    // No deck used yet: the biggest leaf deck (a root tag would plan a new note).
    var list = root.service.deckList || []
    var best = null
    list.forEach(function(d) {
      var leaf = !list.some(function(o) { return o.key.indexOf(d.key + "/") === 0 })
      if (leaf && (!best || d.total > best.total)) best = d
    })
    if (best) root.deckTag = best.tag
  }

  function padExport(loader) {
    var it = loader.item
    if (!loader.active || !it || it.isEmpty === undefined || it.isEmpty) return ""
    try { return String(it.exportFile() || "") } catch (e) { return "" }
  }

  function save() {
    if (!root.service || root.saving) return
    if (!root.deckTag) { root.resultOk = false; root.resultText = "Pick a deck first"; deckPicker.focusField(); return }
    root.saving = true
    root.resultText = ""
    root.service.addCard({
      front: frontField.text,
      back: backField.text,
      reversed: root.reversed,
      deckTag: root.deckTag,
      frontDrawing: padExport(frontPad),
      backDrawing: padExport(backPad)
    })
  }

  function clearForm() {
    frontField.text = ""
    backField.text = ""
    if (frontPad.item && frontPad.item.clear) frontPad.item.clear()
    if (backPad.item && backPad.item.clear) backPad.item.clear()
    root.drawFront = false
    root.drawBack = false
  }

  Connections {
    target: root.service
    ignoreUnknownSignals: true
    function onAddFinished(ok, message) {
      var mine = root.saving
      root.saving = false
      root.resultOk = ok
      root.resultText = message
      if (ok && mine) {
        root.clearForm()
        frontField.forceActiveFocus()
      }
    }
  }

  onActiveChanged: if (active) { initDeck(); resultText = "" }

  implicitHeight: Math.min(form.implicitHeight, surface ? surface.maxBodyHeight : form.implicitHeight)
  height: implicitHeight

  Keys.onPressed: function(event) {
    if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && (event.modifiers & Qt.ControlModifier)) {
      root.save()
      event.accepted = true
    }
  }

  Flickable {
    id: flick
    anchors.fill: parent
    contentWidth: width
    contentHeight: form.implicitHeight
    clip: true
    boundsBehavior: Flickable.StopAtBounds
    interactive: contentHeight > height

    Column {
      id: form
      width: flick.width - (flick.interactive ? Style.space(10) : Style.space(2))
      spacing: Style.spacing.lg

      // ----------------------------------------------------------- deck
      PanelSectionHeader {
        text: "DECK"
        foreground: root.surface.fg
        fontFamily: root.surface.fontFamily
      }

      UiDeckPicker {
        id: deckPicker
        width: parent.width
        surface: root.surface
        service: root.service
        value: root.deckTag
        nextItem: frontField
        onPicked: function(tag) { root.deckTag = tag }
      }

      Text {
        width: parent.width
        textFormat: Text.PlainText
        wrapMode: Text.Wrap
        visible: text !== ""
        text: {
          var p = root.plan
          if (!p) return ""
          if (p.error) return p.error
          var s = "→ " + p.noteTitle
          if (p.createsNote) s += "  (new note in " + p.notePath.split("/").slice(0, -1).join("/") + ")"
          if (p.cardTag) s += "  ·  card tagged " + p.cardTag
          return s
        }
        color: root.plan && root.plan.error ? root.surface.urgent : root.surface.muted
        font.family: root.surface.fontFamily
        font.pixelSize: Style.font.bodySmall
      }

      // ---------------------------------------------------------- front
      Item {
        width: parent.width
        height: Math.max(frontHeader.height, frontTools.height)
        PanelSectionHeader {
          id: frontHeader
          anchors.verticalCenter: parent.verticalCenter
          text: "FRONT"
          foreground: root.surface.fg
          fontFamily: root.surface.fontFamily
        }
        Row {
          id: frontTools
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.spacing.sm
          Button {
            visible: root.drawFront && !!frontPad.item && !!frontPad.item.undo && frontPad.item.showToolbar !== true
            text: "undo"; foreground: root.surface.muted; fontFamily: root.surface.fontFamily; fontSize: Style.font.bodySmall
            onClicked: frontPad.item.undo()
          }
          Button {
            visible: root.drawFront && !!frontPad.item && !!frontPad.item.clear && frontPad.item.showToolbar !== true
            text: "clear"; foreground: root.surface.muted; fontFamily: root.surface.fontFamily; fontSize: Style.font.bodySmall
            onClicked: frontPad.item.clear()
          }
          Button {
            text: "draw"; iconText: "󰏫"; selected: root.drawFront; bordered: true
            foreground: root.surface.fg; accent: root.surface.accent; fontFamily: root.surface.fontFamily; fontSize: Style.font.bodySmall
            onClicked: root.drawFront = !root.drawFront
          }
        }
      }

      UiTextArea {
        id: frontField
        width: parent.width
        placeholderText: "question"
        foreground: root.surface.fg
        accent: root.surface.accent
        nextItem: backField
        previousItem: deckPicker.fieldItem
        onSubmit: root.save()
      }

      UiPadSlot {
        id: frontPad
        width: parent.width
        active: root.drawFront
        surface: root.surface
      }

      // ----------------------------------------------------------- back
      Item {
        width: parent.width
        height: Math.max(backHeader.height, backTools.height)
        PanelSectionHeader {
          id: backHeader
          anchors.verticalCenter: parent.verticalCenter
          text: "BACK"
          foreground: root.surface.fg
          fontFamily: root.surface.fontFamily
        }
        Row {
          id: backTools
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.spacing.sm
          Button {
            visible: root.drawBack && !!backPad.item && !!backPad.item.undo && backPad.item.showToolbar !== true
            text: "undo"; foreground: root.surface.muted; fontFamily: root.surface.fontFamily; fontSize: Style.font.bodySmall
            onClicked: backPad.item.undo()
          }
          Button {
            visible: root.drawBack && !!backPad.item && !!backPad.item.clear && backPad.item.showToolbar !== true
            text: "clear"; foreground: root.surface.muted; fontFamily: root.surface.fontFamily; fontSize: Style.font.bodySmall
            onClicked: backPad.item.clear()
          }
          Button {
            text: "draw"; iconText: "󰏫"; selected: root.drawBack; bordered: true
            foreground: root.surface.fg; accent: root.surface.accent; fontFamily: root.surface.fontFamily; fontSize: Style.font.bodySmall
            onClicked: root.drawBack = !root.drawBack
          }
        }
      }

      UiTextArea {
        id: backField
        width: parent.width
        placeholderText: "answer"
        foreground: root.surface.fg
        accent: root.surface.accent
        nextItem: saveButton
        previousItem: frontField
        onSubmit: root.save()
      }

      UiPadSlot {
        id: backPad
        width: parent.width
        active: root.drawBack
        surface: root.surface
      }

      // -------------------------------------------------------- options
      Item {
        width: parent.width
        height: Math.max(reversedRow.height, saveButton.height)

        Row {
          id: reversedRow
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.spacing.md
          ToggleSwitch {
            id: reversedSwitch
            anchors.verticalCenter: parent.verticalCenter
            checked: root.reversed
            foreground: root.surface.fg
            accent: root.surface.accent
            onToggled: root.reversed = !root.reversed
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: "reversed — also ask back → front"
            color: root.surface.fg
            font.family: root.surface.fontFamily
            font.pixelSize: Style.font.body
            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: root.reversed = !root.reversed }
          }
        }

        UiTouchButton {
          id: saveButton
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          width: Style.space(180)
          height: root.surface.touchHeight
          enabled: !root.saving && !(root.plan && root.plan.error)
          title: root.saving ? "saving…" : "add card"
          keyHint: "ctrl+⏎"
          foreground: root.surface.fg
          tone: root.surface.accent
          accent: root.surface.accent
          emphasized: true
          fontFamily: root.surface.fontFamily
          titleSize: Style.font.heading
          activeFocusOnTab: true
          Keys.onReturnPressed: root.save()
          Keys.onEnterPressed: root.save()
          Keys.onSpacePressed: root.save()
          onClicked: root.save()
        }
      }

      Text {
        width: parent.width
        textFormat: Text.PlainText
        wrapMode: Text.Wrap
        visible: root.resultText !== ""
        text: (root.resultOk ? "✓ " : "✗ ") + root.resultText
        color: root.resultOk ? root.surface.accent : root.surface.urgent
        font.family: root.surface.fontFamily
        font.pixelSize: Style.font.body
      }
    }
  }
}
