import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui

// A large two-line button for the touchscreen: title, a smaller caption under
// it (the interval a grade would schedule) and the keyboard key in the corner.
// Paints the same state tokens as qs.Ui Button (normal border, hover-cursor,
// pressed), so it follows the theme's [controls] settings.
BorderSurface {
  id: root

  property string title: ""
  property string caption: ""
  property string keyHint: ""
  property color foreground: Commons.Color.foreground
  property color tone: foreground          // title colour (urgent for Again, accent for Good)
  property color accent: Commons.Color.accent
  property string fontFamily: Style.font.family
  property real titleSize: Style.font.title
  property real captionSize: Style.font.bodySmall
  property bool emphasized: false           // filled like a selected control

  signal clicked()

  readonly property bool _hot: mouse.containsMouse
  readonly property var _spec: Border.controlSpec(_hot ? "hover-cursor" : "normal", foreground, accent)

  implicitWidth: Math.max(Style.space(90), col.implicitWidth + Style.spacing.controlPaddingX * 2)
  implicitHeight: Math.max(Style.space(44), col.implicitHeight + Style.spacing.controlPaddingY * 2)
  radius: Style.cornerRadius
  opacity: enabled ? 1 : 0.45
  color: mouse.pressed ? Style.pressedFillFor(foreground, accent)
       : _hot ? Style.hoverFillFor(foreground, accent)
       : emphasized ? Style.selectedFillFor(foreground, accent)
       : Style.normalFillFor(foreground, accent)
  borderSpec: Border.canUseNative(_spec) && Border.uniformWidth(_spec) === 0 ? Border.flat(Util.alpha(foreground, 0.4), 1) : _spec

  Behavior on color { ColorAnimation { duration: 100 } }

  Column {
    id: col
    anchors.centerIn: parent
    spacing: Style.spacing.xxs
    Text {
      anchors.horizontalCenter: parent.horizontalCenter
      textFormat: Text.PlainText
      text: root.title
      color: root.tone
      font.family: root.fontFamily
      font.pixelSize: root.titleSize
      font.bold: true
    }
    Text {
      anchors.horizontalCenter: parent.horizontalCenter
      textFormat: Text.PlainText
      visible: root.caption !== ""
      text: root.caption
      color: Util.alpha(root.foreground, 0.6)
      font.family: root.fontFamily
      font.pixelSize: root.captionSize
    }
  }

  Text {
    anchors.right: parent.right
    anchors.top: parent.top
    anchors.margins: Style.spacing.sm
    textFormat: Text.PlainText
    visible: root.keyHint !== ""
    text: root.keyHint
    color: Util.alpha(root.foreground, 0.35)
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    hoverEnabled: true

    cursorShape: Qt.PointingHandCursor
    onClicked: root.clicked()
  }
}
