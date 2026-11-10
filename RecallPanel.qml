import QtQuick
import qs.Commons
import qs.Ui
import "ServiceModel.js" as Model

// Quick controls under the bar glyph: counts, next pop-up, interval presets,
// pause/resume and the four overlay views.
//
// Keys: j/k or arrows move between rows, h/l within a row, Enter activates;
// r review · a add · s stats · , settings · p pause/resume · Esc closes.
Panel {
  id: root
  moduleName: "theo.recall"
  ipcTarget: "theo.recall.panel"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  property var service: null
  readonly property var barIdentity: hostWidget || root

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color dim: Qt.darker(foreground, 1.5)
  readonly property var cfg: service ? service.cfg : Model.normalizeConfig({}, "", null)
  readonly property bool paused: !!service && service.paused

  readonly property var intervalOptions: [5, 10, 15, 30, 60]
  readonly property var pauseOptions: paused
    ? [{ label: "Resume", minutes: -1 }]
    : [{ label: "30 min", minutes: 30 }, { label: "1 hour", minutes: 60 }, { label: "Until resumed", minutes: 0 }]
  readonly property var actions: [
    { label: "Review now", mode: "review", key: "r" },
    { label: "Add card", mode: "add", key: "a" },
    { label: "Stats", mode: "stats", key: "s" },
    { label: "Settings", mode: "settings", key: "," }
  ]

  // Keyboard cursor: row 0 the on/off switch, 1 intervals, 2 pause, 3 actions.
  property bool cursorActive: false
  property int cursorRow: 3
  property int cursorCol: 0

  readonly property string countdownText: {
    if (!service) return "—"
    switch (service.timerState) {
    case "off": return "off"
    case "paused": return "paused"
    case "quiet": return "quiet"
    case "open": return "now"
    case "scheduled": return Model.formatCountdown(service.nextPopupIn)
    }
    return "…"
  }
  readonly property string countdownDetail: {
    if (!service) return ""
    switch (service.timerState) {
    case "off": return "Pop-ups are switched off"
    case "paused": return service.pausedForever ? "Until you resume" : "Until " + Model.clockTime(service.pausedUntil)
    case "quiet": return "Quiet hours " + cfg.quietHours.start + "–" + cfg.quietHours.end
    case "open": return "A card is on screen"
    case "scheduled": return "Next card at " + Model.clockTime(service.nextPopupAt)
    }
    return "Waiting for the vault"
  }
  readonly property string heroMeta: {
    if (!service) return "Service not loaded"
    if (!service.ready) return service.scanning ? "Loading the vault…" : (service.error || "Not loaded")
    if (!service.vaultOk) return service.error || "Vault unavailable"
    return service.stats.due + " due · " + service.stats.fresh + " new" +
      (service.todayReviewed ? " · " + service.todayReviewed + " today" : "")
  }
  readonly property string footerText: {
    if (service && service.readOnlyReason) return "Read-only: " + service.readOnlyReason
    if (service && service.error) return service.error
    if (service && service.configError) return service.configError
    if (service && service.lastMessage) return service.lastMessage
    if (service && service.settingsWarning) return service.settingsWarning
    return "r review · a add · s stats · p pause"
  }

  function rowLength(row) {
    if (row === 0) return 1
    if (row === 1) return intervalOptions.length
    if (row === 2) return pauseOptions.length
    return actions.length
  }

  function open() {
    root.controller.show()
    root.cursorActive = false
    root.cursorRow = 3
    root.cursorCol = 0
    Qt.callLater(function() {
      if (root.opened) setCenterHoverRevealSuppressed(true)
      keyCatcher.forceActiveFocus()
    })
  }

  function close() {
    setCenterHoverRevealSuppressed(false)
    root.controller.hide()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.open()
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  function setCenterHoverRevealSuppressed(value) {
    if (root.bar && typeof root.bar.setCenterHoverRevealSuppressed === "function")
      root.bar.setCenterHoverRevealSuppressed(!!value)
  }

  function moveCursor(dx, dy) {
    if (!root.cursorActive) { root.cursorActive = true; return }
    if (dy !== 0) {
      root.cursorRow = Math.max(0, Math.min(3, root.cursorRow + dy))
      root.cursorCol = Math.min(root.cursorCol, rowLength(root.cursorRow) - 1)
    }
    if (dx !== 0) root.cursorCol = Math.max(0, Math.min(rowLength(root.cursorRow) - 1, root.cursorCol + dx))
  }

  function activateCursor() {
    if (!root.cursorActive) { root.runAction("review"); return }
    if (root.cursorRow === 0) root.toggleEnabled()
    else if (root.cursorRow === 1) root.setInterval(root.intervalOptions[root.cursorCol])
    else if (root.cursorRow === 2) root.pauseFor(root.pauseOptions[root.cursorCol].minutes)
    else root.runAction(root.actions[root.cursorCol].mode)
  }

  function toggleEnabled() {
    if (root.service) root.service.setConfig("enabled", !root.cfg.enabled)
  }

  function setInterval(minutes) {
    if (root.service) root.service.setConfig("intervalMinutes", minutes)
  }

  function pauseFor(minutes) {
    if (!root.service) return
    if (minutes < 0) root.service.resume()
    else root.service.pause(minutes)
    root.cursorCol = 0
  }

  function runAction(mode) {
    if (!root.service) return
    root.close()
    root.service.open(mode)
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(340))
    contentHeight: panel.fittedContentHeight(form.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onMoveRequested: function(dx, dy) { root.moveCursor(dx, dy) }
      onActivateRequested: root.activateCursor()
      onTextKey: function(t) {
        if (t === "r") root.runAction("review")
        else if (t === "a") root.runAction("add")
        else if (t === "s") root.runAction("stats")
        else if (t === ",") root.runAction("settings")
        else if (t === "p") root.pauseFor(root.paused ? -1 : 60)
      }

      Flickable {
        anchors.fill: parent
        contentWidth: width
        contentHeight: form.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height

        Column {
          id: form
          width: parent.width
          spacing: Style.space(12)

          PanelHero {
            title: "Recall"
            meta: root.heroMeta
            foreground: root.foreground
            fontFamily: root.fontFamily
            iconComponent: Component {
              Text {
                textFormat: Text.PlainText
                text: "󰧑"
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.display
              }
            }
            trailingControl: Component {
              ToggleSwitch {
                checked: root.cfg.enabled
                hasCursor: root.cursorActive && root.cursorRow === 0
                onToggled: root.toggleEnabled()
              }
            }
          }

          PanelSeparator { foreground: root.foreground }

          Row {
            width: parent.width
            spacing: Style.space(12)

            Column {
              width: (parent.width - parent.spacing) / 2
              spacing: Style.spacing.labelGap

              PanelSectionHeader {
                text: "NEXT CARD"
                foreground: root.foreground
                fontFamily: root.fontFamily
              }

              Text {
                textFormat: Text.PlainText
                text: root.countdownText
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.displayLarge
                font.bold: true
              }

              Text {
                width: parent.width
                textFormat: Text.PlainText
                text: root.countdownDetail
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                elide: Text.ElideRight
              }
            }

            Column {
              width: (parent.width - parent.spacing) / 2
              spacing: Style.spacing.labelGap

              PanelSectionHeader {
                text: "TODAY"
                foreground: root.foreground
                fontFamily: root.fontFamily
              }

              Repeater {
                model: [
                  { label: "Due", value: root.service ? root.service.stats.due : 0 },
                  { label: "New", value: root.service ? root.service.stats.fresh : 0 },
                  { label: "Reviewed", value: root.service ? root.service.todayReviewed : 0 },
                  { label: "Streak", value: root.service ? root.service.streakDays + (root.service.streakDays === 1 ? " day" : " days") : "0 days" }
                ]

                Row {
                  required property var modelData
                  width: parent.width

                  Text {
                    textFormat: Text.PlainText
                    text: modelData.label
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.bodySmall
                    width: parent.width - valueText.implicitWidth
                  }

                  Text {
                    id: valueText
                    textFormat: Text.PlainText
                    text: String(modelData.value)
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.bodySmall
                    font.bold: true
                  }
                }
              }
            }
          }

          PanelSeparator { foreground: root.foreground }

          PanelSectionHeader {
            text: "POP UP EVERY"
            foreground: root.foreground
            fontFamily: root.fontFamily
          }

          Row {
            id: intervalRow
            width: parent.width
            spacing: Style.space(6)
            readonly property real cellWidth: (width - spacing * (root.intervalOptions.length - 1)) / root.intervalOptions.length

            Repeater {
              model: root.intervalOptions

              Button {
                required property var modelData
                required property int index
                width: intervalRow.cellWidth
                text: modelData + "m"
                fontSize: Style.font.bodySmall
                foreground: root.foreground
                fontFamily: root.fontFamily
                bordered: true
                selected: root.cfg.intervalMinutes === modelData
                hasCursor: root.cursorActive && root.cursorRow === 1 && root.cursorCol === index
                onClicked: root.setInterval(modelData)
                onHovered: function(h) { if (h) { root.cursorActive = true; root.cursorRow = 1; root.cursorCol = index } }
              }
            }
          }

          PanelSectionHeader {
            text: "PAUSE"
            foreground: root.foreground
            fontFamily: root.fontFamily
          }

          Row {
            id: pauseRow
            width: parent.width
            spacing: Style.space(6)
            readonly property real cellWidth: (width - spacing * (root.pauseOptions.length - 1)) / root.pauseOptions.length

            Repeater {
              model: root.pauseOptions

              Button {
                required property var modelData
                required property int index
                width: pauseRow.cellWidth
                text: modelData.label
                fontSize: Style.font.bodySmall
                foreground: root.foreground
                fontFamily: root.fontFamily
                bordered: true
                active: modelData.minutes < 0
                hasCursor: root.cursorActive && root.cursorRow === 2 && root.cursorCol === index
                onClicked: root.pauseFor(modelData.minutes)
                onHovered: function(h) { if (h) { root.cursorActive = true; root.cursorRow = 2; root.cursorCol = index } }
              }
            }
          }

          PanelSeparator { foreground: root.foreground }

          Grid {
            id: actionGrid
            width: parent.width
            columns: 2
            rowSpacing: Style.space(6)
            columnSpacing: Style.space(6)
            readonly property real cellWidth: (width - columnSpacing) / 2

            Repeater {
              model: root.actions

              Button {
                required property var modelData
                required property int index
                width: actionGrid.cellWidth
                text: modelData.label
                fontSize: Style.font.body
                foreground: root.foreground
                fontFamily: root.fontFamily
                bordered: true
                verticalPadding: Style.spacing.controlPaddingY + Style.space(2)
                hasCursor: root.cursorActive && root.cursorRow === 3 && root.cursorCol === index
                tooltipText: "Shortcut: " + modelData.key
                onClicked: root.runAction(modelData.mode)
                onHovered: function(h) { if (h) { root.cursorActive = true; root.cursorRow = 3; root.cursorCol = index } }
              }
            }
          }

          Text {
            width: parent.width
            wrapMode: Text.WordWrap
            textFormat: Text.PlainText
            text: root.footerText
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            maximumLineCount: 3
            elide: Text.ElideRight
          }
        }
      }
    }
  }
}
