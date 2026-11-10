import QtQuick
import ".."

// Offscreen check of DrawPad.qml with synthesized strokes (same entry points the pointer
// handlers use). Writes PNGs and the exported file into <out-dir>:
//   QML_XHR_ALLOW_FILE_WRITE=1 QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qml tests/drawpad-render.qml -- <out-dir>
Rectangle {
    id: win
    property var args: {
        var a = Qt.application.arguments
        var i = a.indexOf("--")
        return i >= 0 ? a.slice(i + 1) : []
    }
    property string outDir: args[0] || "."
    property int step: 0
    width: 720
    height: 460
    color: "#1e1e2e"

    DrawPad {
        id: pad
        anchors.fill: parent
        anchors.margins: 10
        foreground: "#cdd6f4"
        background: Qt.rgba(0.8, 0.84, 0.96, 0.04)
        accent: "#89b4fa"
        fontFamily: "JetBrainsMono Nerd Font"
        onEdited: console.log("[pad] edited: strokes", strokeCount, "undo", canUndo, "redo", canRedo)
    }

    // A pen stroke along f(t) with pressure g(t), like a real pointer stream.
    function penStroke(n, f, g, kind) {
        var p0 = f(0)
        pad.beginStroke(p0[0], p0[1], g(0), kind)
        for (var i = 1; i <= n; i++) {
            var p = f(i / n)
            pad.addPoint(p[0], p[1], g(i / n))
        }
        var pe = f(1)
        pad.endStroke(pe[0], pe[1], kind === "pen" ? 0 : undefined)
    }

    function drawScene() {
        // handwriting-like loops, pressure rising then falling
        pad.strokeColor = "#1e1e1e"; pad.strokeWidth = 1
        penStroke(80, function (t) { return [40 + t * 260, 120 + Math.sin(t * Math.PI * 6) * 30 - t * 10] },
                  function (t) { return 0.15 + 0.75 * Math.sin(t * Math.PI) })
        pad.strokeColor = "#e03131"; pad.strokeWidth = 2
        penStroke(60, function (t) { return [360 + Math.cos(t * Math.PI * 2) * 70, 140 + Math.sin(t * Math.PI * 2) * 50] },
                  function (t) { return 0.3 + 0.6 * t })
        pad.strokeColor = "#1971c2"; pad.strokeWidth = 1
        penStroke(40, function (t) { return [480 + t * 180, 80 + t * 200] }, function (t) { return 0.6 })
        pad.strokeColor = "#2f9e44"; pad.strokeWidth = 0.5
        penStroke(50, function (t) { return [60 + t * 400, 300 + Math.sin(t * 9) * 12] }, function (t) { return 0.9 - 0.8 * t })
        pad.strokeColor = "#f08c00"; pad.strokeWidth = 2
        penStroke(30, function (t) { return [80 + t * 120, 360 - t * t * 60] }, function () { return 0.5 }, "mouse")   // simulated pressure
        pad.strokeColor = "#1e1e1e"; pad.strokeWidth = 1
        pad.beginStroke(600, 330, 0.7, "pen"); pad.endStroke(600, 330, 0)   // a dot
    }

    function grab(name, then) {
        Qt.callLater(function () {
            settle.cb = function () {
                win.grabToImage(function (r) {
                    r.saveToFile(win.outDir + "/drawpad-" + name + ".png")
                    console.log("[pad] saved", name)
                    then()
                })
            }
            settle.restart()
        })
    }

    Timer { id: settle; property var cb; interval: 300; onTriggered: cb() }

    property int pendingWrites: 0
    function writeFile(path, text) {
        pendingWrites++
        var xhr = new XMLHttpRequest()
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== XMLHttpRequest.DONE) return
            console.log("[pad] wrote", path, "status", xhr.status)
            if (--pendingWrites === 0) Qt.quit()
        }
        xhr.open("PUT", "file://" + path)
        xhr.send(text)
    }

    Component.onCompleted: Qt.callLater(function () {
        drawScene()
        grab("drawn", function () {
            // live (in-progress) stroke
            pad.strokeColor = "#9c36b5"
            pad.beginStroke(300, 250, 0.2, "pen")
            for (var i = 1; i < 40; i++) pad.addPoint(300 + i * 5, 250 + Math.sin(i / 4) * 20, 0.2 + i / 60)
            grab("live", function () {
                pad.endStroke()
                // erase gesture crossing the blue diagonal and the green wave
                pad.eraseBegin(560, 120)
                for (var i = 1; i <= 20; i++) pad.eraseMove(560 + i * 3, 120 + i * 10)
                pad.eraseEnd()
                pad.eraseBegin(250, 280); pad.eraseMove(260, 320); pad.eraseEnd()
                console.log("[pad] after erase", pad.strokeCount)
                grab("erased", function () {
                    pad.undo()
                    console.log("[pad] after undo", pad.strokeCount)
                    pad.dark = false
                    grab("undo-lightcolours", function () {
                        pad.dark = true
                        var t0 = Date.now()
                        var text = pad.exportFile()
                        console.log("[pad] exportFile ms", Date.now() - t0, "chars", text.length, "elements", pad.exportElements().length)
                        writeFile(win.outDir + "/drawpad-export.md", text)
                        writeFile(win.outDir + "/drawpad-export-plain.md", pad.exportFile({ compress: false }))
                        pad.clear()
                        console.log("[pad] cleared, empty", pad.isEmpty)
                        pad.undo()
                        console.log("[pad] undo clear", pad.strokeCount)
                    })
                })
            })
        })
    })
}
