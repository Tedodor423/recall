import QtQuick
import "../" as Recall

// Offscreen visual check for CardFace.qml (driven by tests/cardface-render.mjs):
//   QT_QPA_PLATFORM=offscreen QML_XHR_ALLOW_FILE_READ=1 /usr/lib/qt6/bin/qml \
//     tests/CardFaceHarness.qml -- <data.json> <out.png> [columnWidth]
// Renders every {title, text} in data.cards with a mock theme palette, waits
// for async images and drawings, saves one PNG and quits.
Rectangle {
  id: root

  readonly property var args: Qt.application.arguments
  readonly property string dataPath: args[args.length - 3] || ""
  readonly property string outPath: args[args.length - 2] || "cardface.png"
  readonly property int colWidth: parseInt(args[args.length - 1]) || 560
  property var cardData: ({ cards: [], assets: {}, dark: true })
  readonly property bool dark: cardData.dark !== false

  readonly property var pal: dark ? {
    text: "#cdd6f4", muted: "#7f849c", accent: "#89b4fa", cloze: "#f9e2af", clozeAnswer: "#a6e3a1",
    highlight: "#59f9e2af", code: "#94e2d5", codeBg: "#313244", link: "#89b4fa", border: "#585b70"
  } : {
    text: "#4c4f69", muted: "#8c8fa1", accent: "#1e66f5", cloze: "#df8e1d", clozeAnswer: "#40a02b",
    highlight: "#59df8e1d", code: "#179299", codeBg: "#e6e9ef", link: "#1e66f5", border: "#bcc0cc"
  }

  function resolve(name) {
    var a = root.cardData.assets || {}
    return a[name] || a[name + ".md"] || ""
  }

  width: 400
  height: 300
  color: "black"

  Component.onCompleted: {
    var xhr = new XMLHttpRequest()
    xhr.open("GET", "file://" + dataPath, false)
    xhr.send()
    root.cardData = JSON.parse(xhr.responseText)
    shot.start()
  }

  // The view sizes the root to the window; render into a page sized to content.
  Rectangle {
   id: page
   width: root.colWidth * 2 + 60
   height: grid.height + 40
   color: root.dark ? "#1e1e2e" : "#eff1f5"
   Grid {
    id: grid
    x: 20; y: 20
    columns: 2
    columnSpacing: 20
    rowSpacing: 20

    Repeater {
      id: rep
      model: root.cardData.cards
      Rectangle {
        required property var modelData
        width: root.colWidth
        height: col.height + 24
        color: root.dark ? "#181825" : "#ffffff"
        border.color: root.pal.border
        radius: 6
        Column {
          id: col
          x: 12; y: 12
          width: root.colWidth - 24
          spacing: 8
          Text {
            text: modelData.title
            color: root.pal.muted
            font.family: "monospace"
            font.pixelSize: 11
            width: parent.width
            elide: Text.ElideRight
          }
          Recall.CardFace {
            text: modelData.text
            resolve: root.resolve
            palette: root.pal
            fontFamily: "monospace"
            fontSize: 15
            maxWidth: parent.width
            maxImageHeight: 260
            dark: root.dark
          }
        }
      }
    }
   }
  }

  Timer {
    id: shot
    interval: 2500
    onTriggered: page.grabToImage(function(r) {
      r.saveToFile(root.outPath)
      console.log("saved " + root.outPath + " " + page.width + "x" + page.height)
      Qt.quit()
    })
  }
}
