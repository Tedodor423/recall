import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "engine/Osr.js" as Osr
import "UiModel.js" as UiModel

// Stats mode: totals, today and streak, a 7-day forecast strip and the deck
// tree with total / due / new per deck, for the pop-up decks or all decks.
Column {
  id: root

  property var surface: null
  property var service: null
  property bool active: false

  property string scope: "popup"          // "popup" (cfg.decks) | "all"
  property int depth: 1                   // default expansion depth, -1 = all
  property var collapsed: ({})

  readonly property var filters: service && service.cfg ? service.cfg.decks || [] : []
  readonly property bool filtered: filters.length > 0
  readonly property bool showAll: scope === "all" || !filtered
  readonly property var entries: active && service ? (service.entries || []) : []
  readonly property var scoped: showAll ? entries : entries.filter(function(e) { return Osr.deckMatches(e.deck, root.filters) })
  readonly property var counts: active ? (showAll ? (service.allStats || Osr.counts(entries)) : Osr.counts(scoped)) : Osr.counts([])
  readonly property var forecast: {
    if (!active || !service) return [0, 0, 0, 0, 0, 0, 0]
    if (!showAll && service.forecast) return service.forecast
    return Osr.upcoming(scoped, [], Date.now(), service.srSettings || {}, 7)
  }
  readonly property var tree: active ? (showAll && service.decks ? service.decks : Osr.deckTree(scoped)) : []
  readonly property var rows: UiModel.visibleTree(tree, collapsed, depth)

  function handleKey(event) {
    var t = event.text ? event.text.toLowerCase() : ""
    if (t === "1" || t === "2" || t === "3") { setDepth(parseInt(t) - 1); return true }
    if (t === "4") { setDepth(-1); return true }
    if (t === "f" && root.filtered) { root.scope = root.scope === "all" ? "popup" : "all"; return true }
    var step = Style.space(60)
    if (event.key === Qt.Key_Down || t === "j") { deckFlick.contentY = Math.min(Math.max(0, deckFlick.contentHeight - deckFlick.height), deckFlick.contentY + step); return true }
    if (event.key === Qt.Key_Up || t === "k") { deckFlick.contentY = Math.max(0, deckFlick.contentY - step); return true }
    return false
  }

  function setDepth(d) { root.depth = d; root.collapsed = ({}) }

  function toggleNode(row) {
    if (!row.hasChildren) return
    var c = {}
    for (var k in root.collapsed) c[k] = root.collapsed[k]
    c[row.key] = !row.collapsed
    root.collapsed = c
  }

  spacing: Style.spacing.panelGap

  // --------------------------------------------------------------- scope
  Item {
    width: parent.width
    height: scopeGroup.height
    visible: root.filtered
    ButtonGroup {
      id: scopeGroup
      options: [
        { value: "popup", label: "pop-up decks (" + root.filters.length + ")" },
        { value: "all", label: "all decks" }
      ]
      value: root.scope
      foreground: root.surface.fg
      accent: root.surface.accent
      fontFamily: root.surface.fontFamily
      onChanged: function(v) { root.scope = v }
    }
    Text {
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      width: Math.min(implicitWidth, parent.width - scopeGroup.width - Style.spacing.lg)
      elide: Text.ElideLeft
      textFormat: Text.PlainText
      text: root.filters.map(function(k) { return "#" + k }).join("  ")
      color: root.surface.muted
      font.family: root.surface.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  // --------------------------------------------------------------- tiles
  Row {
    id: tiles
    width: parent.width
    spacing: Style.spacing.md
    readonly property var items: [
      { label: "CARDS", value: root.counts.total, tone: "fg" },
      { label: "DUE", value: root.counts.due, tone: "accent" },
      { label: "NEW", value: root.counts.fresh, tone: "fg" },
      { label: "YOUNG", value: root.counts.young, tone: "fg" },
      { label: "MATURE", value: root.counts.mature, tone: "fg" },
      { label: "TODAY", value: root.service ? root.service.todayReviewed : 0, tone: "fg" },
      { label: "STREAK", value: root.service ? root.service.streakDays + "d" : "0d", tone: "fg" }
    ]
    Repeater {
      model: tiles.items
      delegate: Rectangle {
        required property var modelData
        width: (tiles.width - tiles.spacing * (tiles.items.length - 1)) / tiles.items.length
        height: tileCol.implicitHeight + Style.spacing.lg * 2
        radius: Style.cornerRadius
        color: Util.alpha(root.surface.fg, 0.04)
        border.width: 1
        border.color: Util.alpha(root.surface.fg, 0.10)
        Column {
          id: tileCol
          anchors.centerIn: parent
          spacing: Style.spacing.xxs
          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            textFormat: Text.PlainText
            text: String(modelData.value)
            color: modelData.tone === "accent" ? root.surface.accent : root.surface.fg
            font.family: root.surface.fontFamily
            font.pixelSize: Style.font.display
            font.bold: true
          }
          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            textFormat: Text.PlainText
            text: modelData.label
            color: root.surface.muted
            font.family: root.surface.fontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ forecast
  PanelSectionHeader {
    text: "DUE IN THE NEXT 7 DAYS"
    foreground: root.surface.fg
    fontFamily: root.surface.fontFamily
  }

  Row {
    id: strip
    width: parent.width
    height: Style.space(96)
    spacing: Style.spacing.md
    readonly property var heights: UiModel.barHeights(root.forecast)
    Repeater {
      model: root.forecast.length
      delegate: Item {
        required property int index
        width: (strip.width - strip.spacing * (root.forecast.length - 1)) / root.forecast.length
        height: strip.height
        Text {
          id: dayText
          anchors.bottom: parent.bottom
          anchors.horizontalCenter: parent.horizontalCenter
          textFormat: Text.PlainText
          text: UiModel.dayLabel(index, Date.now())
          color: root.surface.muted
          font.family: root.surface.fontFamily
          font.pixelSize: Style.font.caption
        }
        Rectangle {
          id: bar
          anchors.bottom: dayText.top
          anchors.bottomMargin: Style.spacing.xs
          anchors.horizontalCenter: parent.horizontalCenter
          width: parent.width * 0.7
          readonly property real room: strip.height - dayText.height - countText.height - Style.spacing.xs * 3
          height: Math.max(Style.space(2), room * (strip.heights[index] || 0))
          radius: Math.min(Style.cornerRadius, width / 4)
          color: index === 0 ? root.surface.accent : Util.alpha(root.surface.accent, 0.45)
          opacity: root.forecast[index] > 0 ? 1 : 0.35
        }
        Text {
          id: countText
          anchors.bottom: bar.top
          anchors.bottomMargin: Style.spacing.xs
          anchors.horizontalCenter: parent.horizontalCenter
          textFormat: Text.PlainText
          text: String(root.forecast[index] || 0)
          color: root.surface.fg
          font.family: root.surface.fontFamily
          font.pixelSize: Style.font.bodySmall
        }
      }
    }
  }

  // --------------------------------------------------------------- decks
  Item {
    width: parent.width
    height: depthGroup.height
    PanelSectionHeader {
      anchors.verticalCenter: parent.verticalCenter
      text: "DECKS"
      foreground: root.surface.fg
      fontFamily: root.surface.fontFamily
    }
    ButtonGroup {
      id: depthGroup
      anchors.right: parent.right
      options: [{ value: "0", label: "1" }, { value: "1", label: "2" }, { value: "2", label: "3" }, { value: "-1", label: "all" }]
      value: String(root.depth)
      foreground: root.surface.fg
      accent: root.surface.accent
      fontFamily: root.surface.fontFamily
      fontSize: Style.font.bodySmall
      onChanged: function(v) { root.setDepth(parseInt(v)) }
    }
  }

  // Column headings
  Item {
    width: parent.width
    height: colHeads.implicitHeight
    Row {
      id: colHeads
      anchors.right: parent.right
      anchors.rightMargin: Style.spacing.controlPaddingX + (deckFlick.interactive ? Style.space(10) : Style.space(2))
      Repeater {
        model: ["total", "due", "new"]
        delegate: Text {
          required property var modelData
          width: root.numWidth
          horizontalAlignment: Text.AlignRight
          textFormat: Text.PlainText
          text: modelData
          color: root.surface.faint
          font.family: root.surface.fontFamily
          font.pixelSize: Style.font.caption
        }
      }
    }
  }

  readonly property real numWidth: Style.font.body * 4.5

  Flickable {
    id: deckFlick
    width: parent.width
    readonly property real avail: root.surface.maxBodyHeight - tiles.height - strip.height - Style.space(160)
    height: Math.max(Style.space(120), Math.min(deckColumn.implicitHeight, avail))
    contentWidth: width
    contentHeight: deckColumn.implicitHeight
    clip: true
    boundsBehavior: Flickable.StopAtBounds
    interactive: contentHeight > height

    Column {
      id: deckColumn
      width: deckFlick.width - (deckFlick.interactive ? Style.space(10) : Style.space(2))
      Repeater {
        model: root.rows
        delegate: Rectangle {
          id: rowItem
          required property var modelData
          required property int index
          width: deckColumn.width
          height: Math.max(Style.space(30), nameText.implicitHeight + Style.spacing.md * 2)
          radius: Style.cornerRadius
          color: rowMouse.containsMouse ? Style.hoverFillFor(root.surface.fg, root.surface.accent)
               : index % 2 ? Util.alpha(root.surface.fg, 0.025) : "transparent"

          Text {
            id: arrow
            x: Style.spacing.controlPaddingX + modelData.depth * Style.font.body * 1.6
            anchors.verticalCenter: parent.verticalCenter
            width: Style.font.body * 1.4
            textFormat: Text.PlainText
            text: modelData.hasChildren ? (modelData.collapsed ? "▸" : "▾") : "·"
            color: root.surface.muted
            font.family: root.surface.fontFamily
            font.pixelSize: Style.font.body
          }
          Text {
            id: nameText
            anchors.left: arrow.right
            anchors.right: nums.left
            anchors.rightMargin: Style.spacing.lg
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            elide: Text.ElideRight
            text: modelData.depth === 0 ? "#" + modelData.name : modelData.name
            color: root.surface.fg
            font.family: root.surface.fontFamily
            font.pixelSize: Style.font.body
            font.bold: modelData.depth === 0
          }
          Row {
            id: nums
            anchors.right: parent.right
            anchors.rightMargin: Style.spacing.controlPaddingX
            anchors.verticalCenter: parent.verticalCenter
            Repeater {
              model: [
                { v: modelData.total, c: root.surface.fg },
                { v: modelData.due, c: modelData.due > 0 ? root.surface.accent : root.surface.faint },
                { v: modelData.fresh, c: modelData.fresh > 0 ? root.surface.fg : root.surface.faint }
              ]
              delegate: Text {
                required property var modelData
                width: root.numWidth
                horizontalAlignment: Text.AlignRight
                textFormat: Text.PlainText
                text: String(modelData.v)
                color: modelData.c
                font.family: root.surface.fontFamily
                font.pixelSize: Style.font.body
              }
            }
          }
          MouseArea {
            id: rowMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: rowItem.modelData.hasChildren ? Qt.PointingHandCursor : Qt.ArrowCursor
            onClicked: root.toggleNode(rowItem.modelData)
          }
        }
      }
    }
  }

  Text {
    width: parent.width
    visible: root.rows.length === 0
    horizontalAlignment: Text.AlignHCenter
    textFormat: Text.PlainText
    text: root.service && root.service.scanning ? "Reading the vault…" : "No decks"
    color: root.surface.muted
    font.family: root.surface.fontFamily
    font.pixelSize: Style.font.body
  }
}
