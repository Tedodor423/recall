import QtQuick
import "engine/Markdown.js" as Markdown

// One side of a card: the markdown is turned into blocks by engine/Markdown.js
// and laid out top to bottom -- rich text, images, Excalidraw drawings (through
// Drawing.qml, loaded lazily so a missing or broken renderer only costs a chip)
// and chips for everything else.
//
// Pure QtQuick on purpose: no qs.* imports, every colour and size comes in
// through properties, so the face renders the same in the shell and in an
// offscreen harness (tests/CardFaceHarness.qml).
Column {
  id: root

  // ------------------------------------------------------------- contract
  property string text: ""
  property var resolve: null              // function(name) -> absolute path or ""
  override property var palette: ({})     // {text, muted, accent, cloze, clozeAnswer, highlight, code, codeBg, link, border}
  property string fontFamily: "monospace"
  property int fontSize: 16
  property real maxWidth: 600
  property real maxImageHeight: 360
  property bool dark: true

  // ------------------------------------------------------------- additions
  property var isDrawing: null            // optional function(path, name) -> bool (see Markdown.js)
  property string drawingComponent: Qt.resolvedUrl("Drawing.qml")
  signal fileActivated(string path)       // a file chip with a resolved path was clicked/tapped

  readonly property color textColor: pick("text", dark ? "#cdd6f4" : "#1e1e2e")
  readonly property color mutedColor: pick("muted", dark ? "#7f849c" : "#6c6f85")
  readonly property color borderColor: pick("border", dark ? "#45475a" : "#bcc0cc")
  readonly property color linkColor: pick("link", dark ? "#89b4fa" : "#1e66f5")
  readonly property var blocks: Markdown.blocks(root.text, {
    resolve: root.resolve,
    isDrawing: root.isDrawing,
    palette: root.palette,
    fontSize: root.fontSize,
    charWidth: metrics.averageCharacterWidth,
    fontFamily: root.fontFamily
  })
  readonly property bool empty: blocks.length === 0

  function pick(key, fallback) {
    var p = root.palette
    return (p && p[key] !== undefined && p[key] !== null && p[key] !== "") ? p[key] : fallback
  }

  function fileUrl(path) {
    if (!path) return ""
    return "file://" + String(path).split("/").map(encodeURIComponent).join("/")
  }

  function glyph(kind, name) {
    var ext = String(name || "").split(".").pop().toLowerCase()
    if (kind === "drawing") return String.fromCodePoint(0xF0D89)       // nf-md-draw
    if (kind === "image") return String.fromCodePoint(0xF02E9)         // nf-md-image
    if (ext === "pdf") return String.fromCodePoint(0xF0226)            // nf-md-file_pdf_box
    if (ext === "md" || ext === name) return String.fromCodePoint(0xF0219) // nf-md-file_document
    return String.fromCodePoint(0xF0214)                               // nf-md-file
  }

  width: maxWidth
  spacing: Math.round(fontSize * 0.6)

  FontMetrics {
    id: metrics
    font.family: root.fontFamily
    font.pixelSize: root.fontSize
  }

  Repeater {
    model: root.blocks

    delegate: Loader {
      id: slot
      required property var modelData
      readonly property var block: modelData
      width: root.width
      sourceComponent: block.kind === "html" ? htmlBlock
                     : block.kind === "image" ? imageBlock
                     : block.kind === "drawing" ? drawingBlock
                     : fileBlock
    }
  }

  // -------------------------------------------------------------- html
  Component {
    id: htmlBlock
    Text {
      readonly property var block: parent ? parent.block : null
      width: root.width
      text: block ? block.html : ""
      textFormat: Text.RichText
      wrapMode: Text.Wrap
      color: root.textColor
      linkColor: root.linkColor
      font.family: root.fontFamily
      font.pixelSize: root.fontSize
    }
  }

  // -------------------------------------------------------------- image
  Component {
    id: imageBlock
    Item {
      id: imageSlot
      readonly property var block: parent ? parent.block : null
      readonly property real natW: img.sourceSize.width
      readonly property real natH: img.sourceSize.height
      // Obsidian's |300 is a display width; otherwise natural size, never
      // wider than the face nor taller than maxImageHeight.
      readonly property real wantW: Math.min(root.width, block && block.width > 0 ? block.width : (natW > 0 ? natW : root.width))
      readonly property real fitH: natW > 0 ? wantW * natH / natW : 0
      readonly property real shownH: Math.min(root.maxImageHeight, fitH)
      readonly property real shownW: fitH > 0 ? shownH * natW / natH : 0
      readonly property bool failed: img.status === Image.Error

      width: root.width
      height: failed ? brokenChip.height : (img.status === Image.Ready ? shownH : Math.min(root.maxImageHeight, root.fontSize * 6))

      Image {
        id: img
        source: imageSlot.block ? root.fileUrl(imageSlot.block.path) : ""
        asynchronous: true
        cache: true
        smooth: true
        mipmap: true
        fillMode: Image.PreserveAspectFit
        width: imageSlot.shownW
        height: imageSlot.shownH
        visible: status === Image.Ready
      }

      Loader {
        id: brokenChip
        active: imageSlot.failed
        sourceComponent: chip
        onLoaded: {
          item.kind = "image"
          item.name = imageSlot.block ? imageSlot.block.path.split("/").pop() : ""
          item.path = ""
          item.note = "cannot load"
        }
      }
    }
  }

  // ------------------------------------------------------------ drawing
  Component {
    id: drawingBlock
    Item {
      id: drawSlot
      readonly property var block: parent ? parent.block : null
      readonly property bool ok: loader.status === Loader.Ready && !!loader.item
                                 && !(loader.item.error !== undefined && loader.item.error)
                                 && !(loader.item.ok !== undefined && loader.item.ok === false)
      width: root.width
      height: ok ? Math.max(loader.item.height, loader.item.implicitHeight) : fallback.height

      Loader {
        id: loader
        asynchronous: false
        Component.onCompleted: {
          if (!drawSlot.block) return
          setSource(root.drawingComponent, {
            source: drawSlot.block.path,
            maxWidth: root.width,
            maxHeight: root.maxImageHeight,
            dark: root.dark,
            foreground: root.textColor
          })
        }
        onLoaded: {
          item.maxWidth = Qt.binding(function() { return root.width })
          item.maxHeight = Qt.binding(function() { return root.maxImageHeight })
          item.dark = Qt.binding(function() { return root.dark })
          item.foreground = Qt.binding(function() { return root.textColor })
        }
      }

      Loader {
        id: fallback
        active: !drawSlot.ok
        sourceComponent: chip
        onLoaded: {
          item.kind = "drawing"
          item.name = drawSlot.block ? drawSlot.block.path.split("/").pop().replace(/\.md$/, "") : ""
          item.path = drawSlot.block ? drawSlot.block.path : ""
          item.note = loader.status === Loader.Loading ? "loading" : "drawing not shown"
        }
      }
    }
  }

  // --------------------------------------------------------------- file
  Component {
    id: fileBlock
    Item {
      readonly property var block: parent ? parent.block : null
      width: root.width
      height: fchip.height
      Loader {
        id: fchip
        sourceComponent: chip
        onLoaded: {
          var b = parent.block
          item.kind = "file"
          item.name = b ? b.name : ""
          item.path = b ? b.path : ""
          item.note = b && !b.path ? "not found" : ""
        }
      }
    }
  }

  Component {
    id: chip
    Rectangle {
      id: chipRect
      property string kind: "file"
      property string name: ""
      property string path: ""
      property string note: ""
      readonly property real pad: Math.round(root.fontSize * 0.5)

      width: Math.min(root.width, chipRow.implicitWidth + pad * 2)
      height: chipRow.implicitHeight + pad * 1.2
      radius: Math.round(root.fontSize * 0.25)
      color: "transparent"
      border.width: 1
      border.color: root.borderColor

      Row {
        id: chipRow
        x: chipRect.pad
        anchors.verticalCenter: parent.verticalCenter
        spacing: Math.round(root.fontSize * 0.5)
        width: Math.min(implicitWidth, root.width - chipRect.pad * 2)

        Text {
          text: root.glyph(chipRect.kind, chipRect.name)
          color: root.mutedColor
          font.family: root.fontFamily
          font.pixelSize: root.fontSize
          textFormat: Text.PlainText
        }
        Text {
          text: chipRect.name
          color: chipRect.path || chipRect.kind !== "file" ? root.textColor : root.mutedColor
          font.family: root.fontFamily
          font.pixelSize: root.fontSize * 0.9
          textFormat: Text.PlainText
          elide: Text.ElideMiddle
          width: Math.min(implicitWidth, root.width - chipRect.pad * 4 - root.fontSize * 2 - noteText.implicitWidth)
          anchors.verticalCenter: parent.verticalCenter
        }
        Text {
          id: noteText
          visible: chipRect.note !== ""
          text: chipRect.note
          color: root.mutedColor
          font.family: root.fontFamily
          font.pixelSize: root.fontSize * 0.75
          font.italic: true
          textFormat: Text.PlainText
          anchors.verticalCenter: parent.verticalCenter
        }
      }

      MouseArea {
        anchors.fill: parent
        enabled: chipRect.path !== "" && chipRect.kind === "file"
        cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
        onClicked: root.fileActivated(chipRect.path)
      }
    }
  }
}
