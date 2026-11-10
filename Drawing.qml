import QtQuick
import "engine/Excalidraw.js" as Excalidraw

// Renders an Obsidian Excalidraw drawing, scaled to fit maxWidth × maxHeight (aspect kept,
// never enlarged beyond maxScale), transparent background. Give it `source` (absolute path)
// or `sceneText` (the file's text; wins over source).
//
// Reading `source`: Quickshell.Io FileView, created at runtime so this file also loads in the
// plain `qml` tool (where it falls back to XMLHttpRequest; needs QML_XHR_ALLOW_FILE_READ=1).
// Decoded scenes and stroke outlines are cached in Excalidraw.js (shared by all instances).
Item {
    id: root

    property string source: ""
    property string sceneText: ""
    property real maxWidth: 600            // <= 0: unconstrained
    property real maxHeight: 400           // <= 0: unconstrained
    property real maxScale: 1              // 1 scene px → 1 logical px at most (Obsidian's size)
    property real padding: 4               // scene units around the content
    property bool dark: false              // Excalidraw dark theme colours (invert 93% + hue 180°)
    property color foreground: "transparent" // when set, replaces the default ink (#1e1e1e)
    property var resolve: null             // function(name) → absolute path, for embedded images
    property bool watchChanges: true       // re-read `source` when the file changes
    property var fonts: ({ hand: "sans-serif", sans: "sans-serif", mono: "monospace" })

    readonly property bool loading: _loading
    readonly property bool ready: _scene !== null && _error === ""
    readonly property string error: _error
    readonly property bool empty: ready && (_bounds.width <= 0 || _bounds.height <= 0)
    readonly property real contentScale: _scale
    readonly property int strokeCount: _strokes
    readonly property real sceneWidth: _bounds.width
    readonly property real sceneHeight: _bounds.height

    signal loaded()

    implicitWidth: Math.ceil(_contentW * _scale)
    implicitHeight: Math.ceil(_contentH * _scale)

    // --- internals ---
    property var _scene: null
    property string _error: ""
    property bool _loading: false
    property var _ops: []
    property var _bounds: ({ x: 0, y: 0, width: 0, height: 0 })
    property int _strokes: 0
    property var _reader: undefined
    property var _images: ({})            // op key → {candidates, i, url, ok}
    property int _loadSerial: 0

    readonly property real _contentW: _bounds.width > 0 ? _bounds.width + 2 * padding : 0
    readonly property real _contentH: _bounds.height > 0 ? _bounds.height + 2 * padding : 0
    readonly property real _scale: {
        if (_contentW <= 0 || _contentH <= 0) return 0
        var s = maxScale > 0 ? maxScale : 1
        if (maxWidth > 0) s = Math.min(s, maxWidth / _contentW)
        if (maxHeight > 0) s = Math.min(s, maxHeight / _contentH)
        return s
    }
    readonly property string _fg: foreground.a > 0
        ? "rgba(" + Math.round(foreground.r * 255) + "," + Math.round(foreground.g * 255) + "," + Math.round(foreground.b * 255) + "," + foreground.a + ")"
        : ""

    onSourceChanged: _load()
    onSceneTextChanged: _load()
    onDarkChanged: _rebuild()
    on_FgChanged: _rebuild()
    on_ScaleChanged: canvas.requestPaint()
    Component.onCompleted: _load()

    function reload() {
        if (_reader && source && !sceneText) _reader.reload()
        else _load()
    }

    function _load() {
        var serial = ++_loadSerial
        if (sceneText.length) {
            _apply(sceneText, "text:" + source)
            return
        }
        if (!source) {
            _scene = null
            _error = ""
            _rebuild()
            return
        }
        _loading = true
        if (_reader === undefined) _reader = _makeReader()
        if (_reader) {
            if (_reader.path === source) _reader.reload()
            else _reader.path = source
        } else {
            _xhrLoad(source, serial)
        }
    }

    // FileView's `loaded` is both a property and a signal, so the handlers live in the
    // created object and call back into plain JS function properties.
    function _makeReader() {
        try {
            var r = Qt.createQmlObject("import Quickshell.Io\nFileView { property var textCb: null; property var failCb: null; "
                + "printErrors: false; blockLoading: false; onLoaded: if (textCb) textCb(text()); "
                + "onLoadFailed: (e) => { if (failCb) failCb(e) }; onFileChanged: reload() }", root, "DrawingFileView")
            r.watchChanges = Qt.binding(function () { return root.watchChanges })
            r.textCb = function (text) {
                if (r.path === root.source && !root.sceneText.length) root._apply(text, root.source)
            }
            r.failCb = function (err) {
                if (r.path !== root.source || root.sceneText.length) return
                root._loading = false
                root._scene = null
                root._error = "cannot read drawing (error " + err + ")"
                root._rebuild()
            }
            return r
        } catch (e) {
            return null
        }
    }

    function _xhrLoad(path, serial) {
        var xhr = new XMLHttpRequest()
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== XMLHttpRequest.DONE || serial !== root._loadSerial) return
            if (xhr.responseText) {
                root._apply(xhr.responseText, path)
            } else {
                root._loading = false
                root._scene = null
                root._error = "cannot read drawing"
                root._rebuild()
            }
        }
        xhr.open("GET", Excalidraw.fileUrl(path))
        xhr.send()
    }

    function _apply(text, key) {
        _loading = false
        var scene = Excalidraw.sceneFromText(text, key)
        if (scene.error) {
            _scene = null
            _error = scene.error
        } else {
            _scene = scene
            _error = ""
        }
        _images = ({})
        _rebuild()
        loaded()
    }

    function _rebuild() {
        if (!_scene) {
            _ops = []
            _bounds = { x: 0, y: 0, width: 0, height: 0 }
            _strokes = 0
        } else {
            var r = Excalidraw.renderList(_scene, { dark: dark, foreground: _fg })
            _ops = r.ops
            _bounds = r.bounds
            _strokes = r.strokes
        }
        canvas.requestPaint()
    }

    function _dir(p) { return p.slice(0, p.lastIndexOf("/")) }

    // Loaded url for an image op, or "" (then a placeholder is drawn). Never loads remote URLs.
    function _imageUrl(op) {
        var key = op.fileId || (op.x + ":" + op.y)
        var st = _images[key]
        if (!st) {
            var c = []
            if (op.dataURL && /^data:image\//.test(op.dataURL)) c.push(op.dataURL)
            if (op.link) {
                var name = op.link.split("#")[0]
                var r = typeof root.resolve === "function" ? root.resolve(name) : ""
                if (r) c.push(Excalidraw.fileUrl(r))
                if (source) {
                    c.push(Excalidraw.fileUrl(_dir(source) + "/" + name))
                    c.push(Excalidraw.fileUrl(_dir(_dir(source)) + "/attachments/" + name))
                }
            }
            st = { candidates: c, i: 0, polls: 0 }
            _images[key] = st
            if (c.length) {
                canvas.loadImage(c[0])
                imagePoll.restart()
            }
        }
        while (st.i < st.candidates.length) {
            var u = st.candidates[st.i]
            if (canvas.isImageLoaded(u)) return u
            if (canvas.isImageError(u)) {
                st.i++
                if (st.i < st.candidates.length) canvas.loadImage(st.candidates[st.i])
                continue
            }
            if (++st.polls < 40) imagePoll.restart()
            return ""
        }
        return ""
    }

    // Canvas only signals successful image loads; poll so a failed candidate moves on.
    Timer {
        id: imagePoll
        interval: 250
        onTriggered: canvas.requestPaint()
    }

    Canvas {
        id: canvas
        anchors.centerIn: parent
        width: root.implicitWidth
        height: root.implicitHeight
        visible: width > 0 && height > 0

        onImageLoaded: requestPaint()
        onPaint: {
            var ctx = getContext("2d")
            ctx.reset()
            if (!root._ops.length || root._scale <= 0) return
            ctx.scale(root._scale, root._scale)
            ctx.translate(root.padding - root._bounds.x, root.padding - root._bounds.y)
            Excalidraw.paintOps(ctx, root._ops, { fonts: root.fonts, imageUrl: root._imageUrl })
        }
    }
}
