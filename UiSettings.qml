import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "UiModel.js" as UiModel

// Settings mode: every value is read from service.cfg and written with
// service.setConfig(key, value), which persists config.json.
Item {
  id: root

  property var surface: null
  property var service: null
  property bool active: false

  readonly property var cfg: service && service.cfg ? service.cfg : ({})
  readonly property var quiet: cfg.quietHours || { enabled: false, start: "22:00", end: "08:00" }
  // Obsidian's own flashcard tags: srSettings carries them whenever no
  // override is set (the placeholder only shows then).
  readonly property var obsidianTags: !cfg.tags && service && service.srSettings ? service.srSettings.flashcardTags || [] : []
  property int deckDepth: 0
  property var deckCollapsed: ({})
  readonly property var deckRows: active && service ? UiModel.visibleTree(service.decks || [], deckCollapsed, deckDepth) : []

  function set(key, value) { if (root.service) root.service.setConfig(key, value) }

  // Open the tree down to every selected deck so the choice is visible.
  function revealSelected() {
    var c = {}
    ;(root.cfg.decks || []).forEach(function(k) {
      var parts = k.split("/")
      for (var i = 1; i < parts.length; i++) c[parts.slice(0, i).join("/")] = false
    })
    root.deckCollapsed = c
  }
  onActiveChanged: if (active) revealSelected()

  function setQuiet(patch) {
    var q = { enabled: root.quiet.enabled, start: root.quiet.start, end: root.quiet.end }
    for (var k in patch) q[k] = patch[k]
    set("quietHours", q)
  }

  function toggleDeckNode(row) {
    var c = {}
    for (var k in root.deckCollapsed) c[k] = root.deckCollapsed[k]
    c[row.key] = !row.collapsed
    root.deckCollapsed = c
  }

  implicitHeight: Math.min(form.implicitHeight, surface ? surface.maxBodyHeight : form.implicitHeight)
  height: implicitHeight

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

      // ------------------------------------------------------------ pop-ups
      PanelSectionHeader { text: "POP-UPS"; foreground: root.surface.fg; fontFamily: root.surface.fontFamily }

      Grid {
        id: toggles
        width: parent.width
        columns: 2
        columnSpacing: Style.spacing.md
        rowSpacing: Style.spacing.md
        readonly property real cellWidth: (width - columnSpacing) / 2

        Toggle {
          width: toggles.cellWidth
          label: "Pop up cards"
          description: root.cfg.enabled ? "a card every " + root.cfg.intervalMinutes + " min" : "only when opened by hand"
          checked: !!root.cfg.enabled
          foreground: root.surface.fg; accent: root.surface.accent; fontFamily: root.surface.fontFamily
          onClicked: root.set("enabled", !root.cfg.enabled)
        }
        Toggle {
          width: toggles.cellWidth
          label: "Skip over fullscreen"
          description: "wait while a fullscreen window has focus"
          checked: !!root.cfg.skipWhenFullscreen
          foreground: root.surface.fg; accent: root.surface.accent; fontFamily: root.surface.fontFamily
          onClicked: root.set("skipWhenFullscreen", !root.cfg.skipWhenFullscreen)
        }
        Toggle {
          width: toggles.cellWidth
          label: "Strict"
          description: "esc cannot dismiss a pop-up card"
          checked: !!root.cfg.strict
          foreground: root.surface.fg; accent: root.surface.accent; fontFamily: root.surface.fontFamily
          onClicked: root.set("strict", !root.cfg.strict)
        }
        Toggle {
          width: toggles.cellWidth
          label: "Quiet hours"
          description: root.quiet.enabled ? "no pop-ups " + root.quiet.start + "–" + root.quiet.end : "off"
          checked: !!root.quiet.enabled
          foreground: root.surface.fg; accent: root.surface.accent; fontFamily: root.surface.fontFamily
          onClicked: root.setQuiet({ enabled: !root.quiet.enabled })
        }
      }

      // Quiet hours times
      Row {
        visible: !!root.quiet.enabled
        spacing: Style.spacing.md
        Text {
          anchors.verticalCenter: parent.verticalCenter
          textFormat: Text.PlainText
          text: "quiet from"
          color: root.surface.muted; font.family: root.surface.fontFamily; font.pixelSize: Style.font.body
        }
        TextField {
          id: quietStart
          width: Style.space(80)
          text: root.quiet.start
          horizontalAlignment: TextInput.AlignHCenter
          foreground: root.surface.fg; accent: root.surface.accent
          onEditingFinished: {
            var t = UiModel.parseTime(text)
            if (t && t !== root.quiet.start) root.setQuiet({ start: t })
            text = Qt.binding(function() { return root.quiet.start })
          }
        }
        Text {
          anchors.verticalCenter: parent.verticalCenter
          textFormat: Text.PlainText
          text: "to"
          color: root.surface.muted; font.family: root.surface.fontFamily; font.pixelSize: Style.font.body
        }
        TextField {
          width: Style.space(80)
          text: root.quiet.end
          horizontalAlignment: TextInput.AlignHCenter
          foreground: root.surface.fg; accent: root.surface.accent
          onEditingFinished: {
            var t = UiModel.parseTime(text)
            if (t && t !== root.quiet.end) root.setQuiet({ end: t })
            text = Qt.binding(function() { return root.quiet.end })
          }
        }
      }

      // Interval
      Item {
        width: parent.width
        height: intervalLabel.implicitHeight
        Text {
          id: intervalLabel
          textFormat: Text.PlainText
          text: "interval"
          color: root.surface.fg; font.family: root.surface.fontFamily; font.pixelSize: Style.font.subtitle; font.bold: true
        }
        Text {
          anchors.right: parent.right
          textFormat: Text.PlainText
          text: "every " + Math.round(intervalSlider.liveValue) + " min"
          color: root.surface.accent; font.family: root.surface.fontFamily; font.pixelSize: Style.font.subtitle
        }
      }
      ButtonGroup {
        options: ["2", "5", "10", "15", "30", "60", "120"].map(function(v) { return { value: v, label: v + " min" } })
        value: String(root.cfg.intervalMinutes)
        foreground: root.surface.fg; accent: root.surface.accent; fontFamily: root.surface.fontFamily
        fontSize: Style.font.bodySmall
        onChanged: function(v) { root.set("intervalMinutes", parseInt(v)) }
      }
      PanelSlider {
        id: intervalSlider
        width: parent.width
        minimum: 1
        maximum: 120
        step: 1
        integer: true
        value: Math.min(120, root.cfg.intervalMinutes || 5)
        onReleased: function(v) { if (Math.round(v) !== root.cfg.intervalMinutes) root.set("intervalMinutes", Math.round(v)) }
      }

      // Cards per pop-up
      Item {
        width: parent.width
        height: perGroup.height + Style.space(2)
        Text {
          anchors.verticalCenter: parent.verticalCenter
          textFormat: Text.PlainText
          text: "cards per pop-up"
          color: root.surface.fg; font.family: root.surface.fontFamily; font.pixelSize: Style.font.subtitle; font.bold: true
        }
        ButtonGroup {
          id: perGroup
          anchors.right: parent.right
          options: ["1", "2", "3", "5", "10"]
          value: String(root.cfg.cardsPerPopup)
          foreground: root.surface.fg; accent: root.surface.accent; fontFamily: root.surface.fontFamily
          fontSize: Style.font.bodySmall
          onChanged: function(v) { root.set("cardsPerPopup", parseInt(v)) }
        }
      }

      // -------------------------------------------------------- decks
      Item {
        width: parent.width
        height: Math.max(deckHeader.height, deckTools.height)
        PanelSectionHeader {
          id: deckHeader
          anchors.verticalCenter: parent.verticalCenter
          text: "POP-UP DECKS"
          foreground: root.surface.fg; fontFamily: root.surface.fontFamily
        }
        Row {
          id: deckTools
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.spacing.md
          Text {
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: (root.cfg.decks || []).length ? (root.cfg.decks.length + " selected" + (root.service && root.service.stats ? " · " + root.service.stats.total + " cards" : ""))
                                               : "all decks"
            color: root.surface.muted; font.family: root.surface.fontFamily; font.pixelSize: Style.font.bodySmall
          }
          Button {
            visible: (root.cfg.decks || []).length > 0
            text: "use all"
            bordered: true
            foreground: root.surface.fg; accent: root.surface.accent; fontFamily: root.surface.fontFamily; fontSize: Style.font.bodySmall
            onClicked: root.set("decks", [])
          }
        }
      }

      Rectangle {
        width: parent.width
        height: Math.min(deckList.implicitHeight + Style.spacing.xs * 2, Style.space(240))
        radius: Style.cornerRadius
        color: Util.alpha(root.surface.fg, 0.03)
        border.width: 1
        border.color: Util.alpha(root.surface.fg, 0.10)
        Flickable {
          id: deckFlick
          anchors.fill: parent
          anchors.margins: Style.spacing.xs
          contentHeight: deckList.implicitHeight
          clip: true
          boundsBehavior: Flickable.StopAtBounds
          interactive: contentHeight > height
          Column {
            id: deckList
            width: deckFlick.width
            Repeater {
              model: root.deckRows
              delegate: Rectangle {
                id: deckRow
                required property var modelData
                readonly property string state_: UiModel.filterState(root.cfg.decks || [], modelData.key)
                width: deckList.width
                height: Math.max(Style.space(32), rowName.implicitHeight + Style.spacing.md * 2)
                radius: Style.cornerRadius
                color: rowMouse.containsMouse ? Style.hoverFillFor(root.surface.fg, root.surface.accent) : "transparent"

                Text {
                  id: expander
                  x: Style.spacing.md + modelData.depth * Style.font.body * 1.6
                  anchors.verticalCenter: parent.verticalCenter
                  width: Style.font.body * 1.6
                  textFormat: Text.PlainText
                  text: modelData.hasChildren ? (modelData.collapsed ? "▸" : "▾") : ""
                  color: root.surface.muted; font.family: root.surface.fontFamily; font.pixelSize: Style.font.body
                  MouseArea {
                    anchors.fill: parent
                    anchors.margins: -Style.spacing.sm
                    enabled: deckRow.modelData.hasChildren
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.toggleDeckNode(deckRow.modelData)
                  }
                }
                Text {
                  id: check
                  anchors.left: expander.right
                  anchors.verticalCenter: parent.verticalCenter
                  textFormat: Text.PlainText
                  text: deckRow.state_ === "off" ? "☐" : "☒"
                  color: deckRow.state_ === "on" ? root.surface.accent : deckRow.state_ === "implied" ? root.surface.muted : root.surface.faint
                  font.family: root.surface.fontFamily; font.pixelSize: Style.font.subtitle
                }
                Text {
                  id: rowName
                  anchors.left: check.right
                  anchors.leftMargin: Style.spacing.md
                  anchors.right: rowCount.left
                  anchors.verticalCenter: parent.verticalCenter
                  elide: Text.ElideRight
                  textFormat: Text.PlainText
                  text: modelData.depth === 0 ? "#" + modelData.name : modelData.name
                  color: deckRow.state_ === "off" ? root.surface.fg : root.surface.accent
                  font.family: root.surface.fontFamily; font.pixelSize: Style.font.body
                }
                Text {
                  id: rowCount
                  anchors.right: parent.right
                  anchors.rightMargin: Style.spacing.md
                  anchors.verticalCenter: parent.verticalCenter
                  textFormat: Text.PlainText
                  text: modelData.total + " · " + modelData.due + " due"
                  color: root.surface.faint; font.family: root.surface.fontFamily; font.pixelSize: Style.font.caption
                }
                MouseArea {
                  id: rowMouse
                  anchors.fill: parent
                  anchors.leftMargin: check.x
                  hoverEnabled: true
                  cursorShape: deckRow.state_ === "implied" ? Qt.ArrowCursor : Qt.PointingHandCursor
                  onClicked: root.set("decks", UiModel.toggleFilter(root.cfg.decks || [], deckRow.modelData.key))
                }
              }
            }
          }
        }
      }

      // -------------------------------------------------------- vault
      PanelSectionHeader { text: "VAULT"; foreground: root.surface.fg; fontFamily: root.surface.fontFamily }

      Item {
        width: parent.width
        height: Math.max(tagsField.height, resetTags.height)
        Text {
          id: tagsLabel
          anchors.verticalCenter: parent.verticalCenter
          textFormat: Text.PlainText
          text: "flashcard tags"
          color: root.surface.fg; font.family: root.surface.fontFamily; font.pixelSize: Style.font.body
        }
        TextField {
          id: tagsField
          anchors.left: tagsLabel.right
          anchors.leftMargin: Style.spacing.lg
          anchors.right: resetTags.left
          anchors.rightMargin: Style.spacing.md
          text: root.cfg.tags ? root.cfg.tags.join(", ") : ""
          placeholderText: (root.obsidianTags.length ? root.obsidianTags.join(", ") : "#flashcards") + "  (from Obsidian)"
          foreground: root.surface.fg; accent: root.surface.accent
          onEditingFinished: {
            var list = UiModel.parseTags(text)
            if (JSON.stringify(list) !== JSON.stringify(root.cfg.tags || null)) root.set("tags", list)
            text = Qt.binding(function() { return root.cfg.tags ? root.cfg.tags.join(", ") : "" })
          }
        }
        Button {
          id: resetTags
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          text: "use Obsidian's"
          enabled: !!root.cfg.tags
          opacity: enabled ? 1 : 0.4
          bordered: true
          foreground: root.surface.fg; accent: root.surface.accent; fontFamily: root.surface.fontFamily; fontSize: Style.font.bodySmall
          onClicked: root.set("tags", null)
        }
      }

      Column {
        width: parent.width
        spacing: Style.spacing.xs
        Repeater {
          model: [
            { k: "vault", v: root.service && root.service.vaultPath ? root.service.vaultPath : (root.cfg.vault || "") },
            { k: "cards", v: root.service && root.service.allStats ? root.service.allStats.total + " in " + (root.service.notesCount || 0) + " notes" : "" },
            { k: "new notes go to", v: root.cfg.newNoteFolder || "" },
            { k: "status", v: root.service ? (root.service.readOnlyReason ? "read-only: " + root.service.readOnlyReason : (root.service.error || "ok")) : "" }
          ]
          delegate: Row {
            required property var modelData
            width: parent.width
            spacing: Style.spacing.lg
            Text {
              width: Style.font.body * 11
              textFormat: Text.PlainText
              text: modelData.k
              color: root.surface.muted; font.family: root.surface.fontFamily; font.pixelSize: Style.font.bodySmall
            }
            Text {
              width: parent.width - Style.font.body * 11 - parent.spacing
              textFormat: Text.PlainText
              elide: Text.ElideMiddle
              text: modelData.v
              color: root.surface.fg; font.family: root.surface.fontFamily; font.pixelSize: Style.font.bodySmall
            }
          }
        }
      }
    }
  }
}
