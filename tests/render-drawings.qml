import QtQuick
import ".."

// Offscreen render check for Drawing.qml:
//   QML_XHR_ALLOW_FILE_READ=1 QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qml tests/render-drawings.qml -- \
//       <out-dir> <light|dark> <max-width> <max-height> <drawing.md>...
// Writes <out-dir>/<n>-<light|dark>.png per drawing and logs load/paint timings.
Rectangle {
    id: win
    property var args: {
        var a = Qt.application.arguments
        var i = a.indexOf("--")
        return i >= 0 ? a.slice(i + 1) : []
    }
    property string outDir: args[0] || "."
    property bool dark: args[1] === "dark"
    property var files: args.slice(4)
    property int index: -1
    property double t0: 0
    property double tLoaded: 0

    width: 1400
    height: 1000
    color: dark ? "#1e1e2e" : "#ffffff"

    Rectangle {
        id: frame
        color: win.color
        width: drawing.width + 20
        height: drawing.height + 20
        Drawing {
            id: drawing
            x: 10
            y: 10
            width: implicitWidth
            height: implicitHeight
            maxWidth: Number(win.args[2] || 900)
            maxHeight: Number(win.args[3] || 700)
            dark: win.dark
            onLoaded: win.tLoaded = Date.now()
        }
    }

    Connections {
        target: drawing.children[drawing.children.length - 1]
        function onPainted() { if (win.index >= 0 && win.tLoaded > 0) settle.restart() }
    }

    Timer {
        id: settle
        interval: 400
        onTriggered: {
            var n = win.index
            var name = win.files[n].split("/").pop()
            var tPaint = Date.now()
            console.log("[render]", n, name, "elements→strokes", drawing.strokeCount, "scene", Math.round(drawing.sceneWidth) + "x" + Math.round(drawing.sceneHeight),
                "scale", drawing.contentScale.toFixed(3), "load+decode ms", win.tLoaded - win.t0, "error", JSON.stringify(drawing.error))
            frame.grabToImage(function (r) {
                r.saveToFile(win.outDir + "/" + n + "-" + (win.dark ? "dark" : "light") + ".png")
                win.next()
            })
        }
    }

    function next() {
        index++
        if (index >= files.length) { Qt.quit(); return }
        tLoaded = 0
        t0 = Date.now()
        drawing.source = files[index]
    }

    Component.onCompleted: Qt.callLater(next)
}
