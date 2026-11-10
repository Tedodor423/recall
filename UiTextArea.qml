import QtQuick
import QtQuick.Controls as QQC
import qs.Commons
import qs.Commons as Commons
import qs.Ui

// Multi-line text input styled like qs.Ui TextField. Tab / Shift+Tab move
// focus instead of inserting a tab; Ctrl+Enter emits submit().
QQC.TextArea {
  id: root

  property color foreground: Commons.Color.foreground
  property color accent: Commons.Color.accent
  property int minLines: 3
  property Item nextItem: null
  property Item previousItem: null

  signal submit()

  readonly property bool _hot: hovered
  readonly property var _borderSpec: Border.controlSpec(activeFocus ? "focus" : (_hot ? "hover-cursor" : "normal"), foreground, accent)

  wrapMode: TextEdit.Wrap
  font.family: Style.font.family
  font.pixelSize: Style.font.subtitle
  color: foreground
  selectionColor: Style.selectionFillFor(foreground, accent)
  selectedTextColor: foreground
  placeholderTextColor: Qt.darker(foreground, 1.6)
  persistentSelection: false
  selectByMouse: true

  leftPadding: Style.spacing.controlPaddingX + Border.left(_borderSpec)
  rightPadding: Style.spacing.controlPaddingX + Border.right(_borderSpec)
  topPadding: Style.spacing.inputPaddingY + Border.top(_borderSpec)
  bottomPadding: Style.spacing.inputPaddingY + Border.bottom(_borderSpec)
  implicitHeight: Math.max(contentHeight, metrics.height * minLines) + topPadding + bottomPadding

  FontMetrics { id: metrics; font: root.font }

  Keys.onPressed: function(event) {
    var ctrl = (event.modifiers & Qt.ControlModifier) !== 0
    if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && ctrl) {
      root.submit()
      event.accepted = true
    } else if (event.key === Qt.Key_Tab && !ctrl && !(event.modifiers & Qt.ShiftModifier)) {
      if (root.nextItem) root.nextItem.forceActiveFocus()
      event.accepted = true
    } else if (event.key === Qt.Key_Backtab || (event.key === Qt.Key_Tab && (event.modifiers & Qt.ShiftModifier))) {
      if (root.previousItem) root.previousItem.forceActiveFocus()
      event.accepted = true
    }
  }

  background: BorderSurface {
    color: Style.controlFill(root.activeFocus, root._hot, root.foreground, root.accent)
    borderSpec: root._borderSpec
    radius: Style.cornerRadius
  }
}
