import QtQuick
import qs.Commons
import qs.Commons as Commons

// Holds a DrawPad.qml (agent C) under a text field in the add form. Loaded on
// first use and kept while the form lives, so toggling "draw" off and on does
// not lose strokes. A missing or broken DrawPad degrades to a note.
Item {
  id: root

  property bool active: false
  property var surface: null
  property real padHeight: Math.max(Style.space(220), (surface ? surface.availableHeight : 800) * 0.32)
  property bool everActive: false
  readonly property var item: loader.status === Loader.Ready ? loader.item : null

  onActiveChanged: if (active) everActive = true

  visible: active
  width: parent ? parent.width : 0
  height: active ? (item ? padHeight : fallback.implicitHeight) : 0

  Loader {
    id: loader
    width: parent.width
    height: root.padHeight
    active: root.everActive
    visible: root.item !== null
    source: Qt.resolvedUrl("DrawPad.qml")
    onLoaded: {
      var it = loader.item
      if (!it || !root.surface) return
      if ("foreground" in it) it.foreground = Qt.binding(function() { return root.surface.fg })
      if ("background" in it) it.background = Qt.binding(function() { return Util.alpha(root.surface.fg, 0.04) })
      if ("fontFamily" in it) it.fontFamily = Style.font.family
    }
  }

  Text {
    id: fallback
    width: parent.width
    visible: root.active && !root.item
    textFormat: Text.PlainText
    wrapMode: Text.Wrap
    text: loader.status === Loader.Loading ? "loading the drawing pad…" : "The drawing pad (DrawPad.qml) is not available."
    color: root.surface ? root.surface.muted : "gray"
    font.family: Style.font.family
    font.pixelSize: Style.font.bodySmall
  }
}
