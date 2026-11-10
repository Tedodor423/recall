import QtQuick
import QtQuick.Window
import ".."

// Manual pen session for DrawPad.qml (a real Wayland window, so a stylus arrives as
// tablet events). Run from the plugin directory:
//
//   QT_FORCE_STDERR_LOGGING=1 QML_XHR_ALLOW_FILE_READ=1 QML_XHR_ALLOW_FILE_WRITE=1 \
//     /usr/lib/qt6/bin/qml tests/drawpad-manual.qml [-- <excalidraw folder>]
//
// Every press/release (and every 10th move) is logged to stderr as
//   [DrawPad] down pen stylus/pen "<tablet>-stylus" p=0.412 buttons=1 @120,88
// What to try: draw with varying pressure; flip the pen / hold its button (eraser); rest the
// palm on the screen while drawing; touch with a finger before and after using the pen; mouse.
// "export" writes "<folder>/DrawPad test YYYYMMDDHHmm.md" (default: /tmp; never point this at a
// real vault) and shows the file re-rendered by Drawing.qml on the right. Open it in a throwaway
// Obsidian vault to check that the Excalidraw plugin opens and edits it.
Window {
    id: win
    width: 1500
    height: 860
    visible: true
    color: "#1e1e2e"
    title: "recall DrawPad manual test"

    property var args: {
        var a = Qt.application.arguments
        var i = a.indexOf("--")
        return i >= 0 ? a.slice(i + 1) : []
    }
    property string folder: args[0] || "/tmp"
    property string status: "draw with the pen; export writes into " + folder
    property var logLines: []
    property var used: []
    readonly property color fg: "#cdd6f4"

    function fileUrl(p) { return "file://" + encodeURI(p).replace(/#/g, "%23").replace(/\?/g, "%3F") }
    function pad2(n) { return n < 10 ? "0" + n : "" + n }

    function exists(path) {
        var xhr = new XMLHttpRequest()
        xhr.open("GET", fileUrl(path), false)
        xhr.send()
        return !!xhr.responseText
    }

    function exportNow() {
        if (/\/obsidian\//.test(folder) || /\/mnt\/windows\//.test(folder)) { status = "refusing to write into the real vault"; return }
        if (pad.isEmpty) { status = "nothing to export"; return }
        var d = new Date()
        var stamp = d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + pad2(d.getHours()) + pad2(d.getMinutes())
        var path = folder + "/DrawPad test " + stamp + ".md"
        for (var n = 1; exists(path) || used.indexOf(path) >= 0; n++) path = folder + "/DrawPad test " + stamp + "_" + n + ".md"
        used.push(path)
        var text = pad.exportFile()
        var xhr = new XMLHttpRequest()
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== XMLHttpRequest.DONE) return
            var back = exists(path)
            win.status = (back ? "wrote " : "FAILED to write ") + path + " (" + text.length + " chars, " + pad.strokeCount + " strokes)"
            console.log("[manual]", win.status)
            preview.sceneText = ""
            preview.sceneText = text
        }
        xhr.open("PUT", fileUrl(path))
        xhr.send(text)
    }

    Row {
        x: 12
        y: 12
        spacing: 12

        Column {
            spacing: 8
            DrawPad {
                id: pad
                width: 900
                height: 640
                foreground: win.fg
                background: Qt.rgba(0.8, 0.84, 0.96, 0.04)
                accent: "#89b4fa"
                fontFamily: "JetBrainsMono Nerd Font"
                logInput: true
                onLastInputChanged: {
                    var l = win.logLines.slice(-11)
                    l.push(lastInput)
                    win.logLines = l
                }
            }
            Row {
                spacing: 8
                Repeater {
                    model: [
                        { label: "export", act: function () { win.exportNow() } },
                        { label: "clear", act: function () { pad.clear() } },
                        { label: "dark colours", act: function () { pad.dark = !pad.dark } },
                        { label: "touch draws", act: function () { pad.touchDraws = !pad.touchDraws } },
                        { label: "reset pen-seen", act: function () { pad._penSeen = false } }
                    ]
                    delegate: Rectangle {
                        required property var modelData
                        width: lbl.implicitWidth + 24
                        height: 30
                        color: ma.pressed ? "#45475a" : "#313244"
                        border.color: "#585b70"
                        Text { id: lbl; anchors.centerIn: parent; text: modelData.label; color: win.fg; font.family: "monospace"; font.pixelSize: 14 }
                        MouseArea { id: ma; anchors.fill: parent; onClicked: modelData.act() }
                    }
                }
            }
            Text {
                width: 900
                wrapMode: Text.Wrap
                color: win.fg
                font.family: "monospace"
                font.pixelSize: 13
                text: win.status + "\npenNear=" + pad.penNear + " penSeen=" + pad.penSeen + " touchDraws=" + pad.touchDraws
                      + " dark=" + pad.dark + " strokes=" + pad.strokeCount + " busy=" + pad.busy
            }
        }

        Column {
            spacing: 8
            Text { text: "exported file, re-rendered by Drawing.qml"; color: win.fg; font.family: "monospace"; font.pixelSize: 13 }
            Rectangle {
                width: 540
                height: 360
                color: "transparent"
                border.color: "#585b70"
                Drawing {
                    id: preview
                    anchors.centerIn: parent
                    width: implicitWidth
                    height: implicitHeight
                    maxWidth: 520
                    maxHeight: 340
                    dark: pad.dark
                    foreground: win.fg
                }
            }
            Text { text: "pointer log (also on stderr)"; color: win.fg; font.family: "monospace"; font.pixelSize: 13 }
            Text {
                width: 540
                wrapMode: Text.WrapAnywhere
                color: "#a6adc8"
                font.family: "monospace"
                font.pixelSize: 12
                text: win.logLines.join("\n")
            }
        }
    }
}
