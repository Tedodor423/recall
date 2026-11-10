import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "UiModel.js" as UiModel

// Deck field for the add form: type to fuzzy-search the vault's decks
// (service.deckList), or type a new tag and pick "create #new/tag". The list
// is inline under the field (no popup), so it works the same with touch.
Column {
  id: root

  property var surface: null
  property var service: null
  property string value: ""                // "#deck/tag"
  property Item nextItem: null

  signal picked(string tag)

  readonly property bool listOpen: field.activeFocus
  property alias fieldItem: field
  readonly property var flashcardTags: service && service.srSettings ? service.srSettings.flashcardTags : []
  property int highlighted: 0
  property bool navigated: false
  property string query: ""
  readonly property var rows: UiModel.deckSuggestions(service ? service.deckList : [], query, flashcardTags, 7)

  function pick(row) {
    if (!row) return
    root.value = row.tag
    field.text = row.tag
    root.query = ""
    root.picked(row.tag)
    if (root.nextItem) root.nextItem.forceActiveFocus()
  }

  function focusField() { field.forceActiveFocus() }

  onValueChanged: if (!field.activeFocus) field.text = value
  onRowsChanged: if (highlighted >= rows.length) highlighted = Math.max(0, rows.length - 1)

  spacing: Style.spacing.xs

  TextField {
    id: field
    width: parent.width
    text: root.value
    placeholderText: "deck — type to search or create (#flashnotes/…)"
    foreground: root.surface.fg
    accent: root.surface.accent
    font.family: root.surface.fontFamily
    font.pixelSize: Style.font.subtitle

    onActiveFocusChanged: {
      if (activeFocus) { root.query = ""; root.highlighted = 0; root.navigated = false; selectAll() }
      else text = root.value
    }
    onTextEdited: { root.query = text; root.highlighted = 0 }

    Keys.onPressed: function(event) {
      if (event.key === Qt.Key_Down) {
        root.highlighted = Math.min(root.rows.length - 1, root.highlighted + 1); root.navigated = true; event.accepted = true
      } else if (event.key === Qt.Key_Up) {
        root.highlighted = Math.max(0, root.highlighted - 1); root.navigated = true; event.accepted = true
      } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter || event.key === Qt.Key_Tab) {
        if (event.modifiers & (Qt.ControlModifier | Qt.ShiftModifier)) return
        if ((root.query !== "" || root.navigated) && root.rows.length) root.pick(root.rows[root.highlighted])
        else if (root.nextItem) root.nextItem.forceActiveFocus()
        event.accepted = true
      } else if (event.key === Qt.Key_Escape && root.query !== "") {
        root.query = ""; text = root.value; selectAll(); event.accepted = true
      }
    }
  }

  // Suggestions
  Rectangle {
    width: parent.width
    visible: root.listOpen && root.rows.length > 0
    height: visible ? list.height + Style.spacing.xs * 2 : 0
    radius: Style.cornerRadius
    color: Util.alpha(root.surface.fg, 0.04)
    border.width: 1
    border.color: Util.alpha(root.surface.fg, 0.12)

    Column {
      id: list
      x: Style.spacing.xs
      y: Style.spacing.xs
      width: parent.width - Style.spacing.xs * 2
      Repeater {
        model: root.rows
        delegate: Rectangle {
          required property var modelData
          required property int index
          width: list.width
          height: Math.max(Style.space(32), rowText.implicitHeight + Style.spacing.md * 2)
          radius: Style.cornerRadius
          color: index === root.highlighted ? Style.hoverFillFor(root.surface.fg, root.surface.accent) : "transparent"

          Text {
            id: rowText
            anchors.left: parent.left
            anchors.leftMargin: Style.spacing.controlPaddingX
            anchors.right: countText.left
            anchors.rightMargin: Style.spacing.lg
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            elide: Text.ElideMiddle
            text: (modelData.create ? "create  " : "") + modelData.tag
            color: modelData.create ? root.surface.accent : root.surface.fg
            font.family: root.surface.fontFamily
            font.pixelSize: Style.font.body
            font.bold: modelData.create
          }
          Text {
            id: countText
            anchors.right: parent.right
            anchors.rightMargin: Style.spacing.controlPaddingX
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: modelData.create ? "new deck" : modelData.total + " cards · " + modelData.due + " due · " + modelData.fresh + " new"
            color: root.surface.muted
            font.family: root.surface.fontFamily
            font.pixelSize: Style.font.caption
          }
          MouseArea {
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onEntered: root.highlighted = index
            // Pressing would take focus from the field and close the list
            // before the click lands, so pick on press.
            onPressed: root.pick(modelData)
          }
        }
      }
    }
  }
}
