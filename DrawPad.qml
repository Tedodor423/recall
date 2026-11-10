import QtQuick
import "engine/Excalidraw.js" as Excalidraw

// Drawing surface for the stylus (pressure), touch and mouse that exports Obsidian Excalidraw
// files. Strokes are rendered with the same perfect-freehand outline as Excalidraw, and stored
// as freedraw elements with the property set of the user's real drawings.
//
// Input: pen tip draws with real pressure; pen eraser end / barrel button / eraser mode / right
// mouse button erase whole strokes (like Excalidraw's eraser). Palm rejection: touch is ignored
// while a pen is near or drawing, and (penOnlyAfterPen) once a pen has been used on this pad.
// Programmatic input for tests: beginStroke/addPoint/endStroke, eraseBegin/eraseMove/eraseEnd.
Item {
    id: pad

    // --- contract ---
    property string strokeColor: Excalidraw.DEFAULT_INK
    property real strokeWidth: 1
    property color foreground: "transparent"   // shows the default ink (#1e1e1e) in this colour
    property color background: "transparent"   // pad fill

    // --- additions ---
    // Show colours as Excalidraw's dark theme does (auto: when `foreground` is a light colour).
    property bool dark: foreground.a > 0 && (0.299 * foreground.r + 0.587 * foreground.g + 0.114 * foreground.b) > 0.5
    property color accent: foreground.a > 0 ? foreground : "#4a9eff"
    property color border: Qt.rgba(_uiFg.r, _uiFg.g, _uiFg.b, 0.28)
    property string fontFamily: "monospace"
    property bool showToolbar: true
    property var colors: ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"]
    property var widths: [0.5, 1, 2]
    property bool eraserMode: false
    property bool touchDraws: true
    property bool penOnlyAfterPen: true
    property real eraserRadius: 8
    property bool logInput: false

    readonly property bool isEmpty: _count === 0
    readonly property int strokeCount: _count
    readonly property bool canUndo: _undoCount > 0
    readonly property bool canRedo: _redoCount > 0
    readonly property bool busy: _cur !== null || _erasing !== null   // a stroke/erase is in progress
    readonly property bool penNear: _penHover || _penActive || _penRecent
    readonly property bool penSeen: _penSeen
    readonly property string lastInput: _lastInput

    signal edited()

    implicitWidth: 640
    implicitHeight: 360

    // --- state ---
    property var _strokes: []      // [{el, d, bounds, pts, r}]
    property var _undo: []
    property var _redo: []
    property int _count: 0
    property int _undoCount: 0
    property int _redoCount: 0
    property var _cur: null        // {kind, points, pressures, simulate, color, width}
    property var _erasing: null    // {last: [x, y], items: [{entry, pos}]}
    property var _queue: []        // entries to draw incrementally
    property bool _full: true
    property bool _penHover: false
    property bool _penActive: false
    property bool _penRecent: false
    property bool _penSeen: false
    property bool _touchBlocked: false
    property string _lastInput: ""
    property int _moveLog: 0
    property point _cursor: Qt.point(-100, -100)
    property bool _cursorEraser: false
    readonly property color _uiFg: foreground.a > 0 ? foreground : "#808080"
    readonly property string _fg: foreground.a > 0
        ? "rgba(" + Math.round(foreground.r * 255) + "," + Math.round(foreground.g * 255) + "," + Math.round(foreground.b * 255) + "," + foreground.a + ")"
        : ""

    onDarkChanged: _repaintAll()
    on_FgChanged: _repaintAll()

    // ------------------------------------------------------------------ public API

    function undo() {
        if (_cur || _erasing || !_undo.length) return
        var a = _undo.pop()
        if (a.type === "add") {
            _removeEntry(a.entry)
        } else if (a.type === "erase") {
            for (var i = a.items.length - 1; i >= 0; i--) _strokes.splice(a.items[i].pos, 0, a.items[i].entry)
        } else if (a.type === "clear") {
            _strokes = a.entries.slice()
        }
        _redo.push(a)
        _changed(true)
    }

    function redo() {
        if (_cur || _erasing || !_redo.length) return
        var a = _redo.pop()
        if (a.type === "add") {
            _strokes.push(a.entry)
        } else if (a.type === "erase") {
            for (var i = 0; i < a.items.length; i++) _removeEntry(a.items[i].entry)
        } else if (a.type === "clear") {
            _strokes = []
        }
        _undo.push(a)
        _changed(true)
    }

    function clear() {
        cancelStroke()
        if (!_strokes.length) return
        _undo.push({ type: "clear", entries: _strokes.slice() })
        _redo = []
        _strokes = []
        _changed(true)
    }

    // Freedraw elements (deep copies) with fresh fractional indices a0, a1, …
    function exportElements() {
        var out = [], idx = "a0"
        for (var i = 0; i < _strokes.length; i++) {
            var el = JSON.parse(JSON.stringify(_strokes[i].el))
            el.index = idx
            idx = Excalidraw.nextIndexKey(idx)
            out.push(el)
        }
        return out
    }

    // Complete Excalidraw `.md` file text. opts: {compress (default true)}
    function exportFile(opts) {
        opts = opts || {}
        var els = exportElements()
        var minX = 0, minY = 0
        if (_strokes.length) {
            minX = Infinity
            minY = Infinity
            for (var i = 0; i < _strokes.length; i++) {
                minX = Math.min(minX, _strokes[i].bounds[0])
                minY = Math.min(minY, _strokes[i].bounds[1])
            }
        }
        return Excalidraw.encodeFile(els, {
            compress: opts.compress !== false,
            appState: {
                currentItemStrokeColor: strokeColor,
                currentItemStrokeWidth: strokeWidth,
                scrollX: Math.round(40 - minX),
                scrollY: Math.round(40 - minY)
            }
        })
    }

    // kind: "pen" (real pressure) | "touch" | "mouse" (simulated pressure)
    function beginStroke(x, y, pressure, kind) {
        kind = kind || "pen"
        var simulate = kind !== "pen"
        _cur = { kind: kind, points: [[x, y]], pressures: simulate ? [] : [_p(pressure)], simulate: simulate,
                 color: strokeColor, width: strokeWidth }
        live.requestPaint()
    }

    function addPoint(x, y, pressure) {
        if (!_cur) return
        var last = _cur.points[_cur.points.length - 1]
        if (Math.abs(x - last[0]) < 0.5 && Math.abs(y - last[1]) < 0.5) return
        _cur.points.push([x, y])
        if (!_cur.simulate) _cur.pressures.push(_p(pressure))
        live.requestPaint()
    }

    // Excalidraw appends the pointer-up position with the up-event pressure (0 for a pen).
    function endStroke(x, y, pressure) {
        if (!_cur) return
        var c = _cur
        var last = c.points[c.points.length - 1]
        if (x === undefined || x === null) { x = last[0]; y = last[1] }
        if (c.points.length === 1 && x === c.points[0][0] && y === c.points[0][1]) { x += 0.01; y += 0.01 }
        c.points.push([x, y])
        if (!c.simulate) c.pressures.push(pressure === undefined || pressure === null ? 0 : _p(pressure))
        _cur = null
        var el = Excalidraw.newFreedrawElement(c.points, c.simulate ? null : c.pressures,
                                               { strokeColor: c.color, strokeWidth: c.width })
        var entry = _entry(el)
        _strokes.push(entry)
        _undo.push({ type: "add", entry: entry })
        _redo = []
        _queue.push(entry)
        committed.requestPaint()
        live.requestPaint()
        _changed(false)
    }

    function cancelStroke() {
        if (!_cur) return
        _cur = null
        live.requestPaint()
    }

    function eraseBegin(x, y) {
        eraseEnd()
        _erasing = { last: [x, y], items: [] }
        eraseMove(x, y)
    }

    function eraseMove(x, y) {
        if (!_erasing) return
        var l = _erasing.last
        var hit = false
        for (var i = _strokes.length - 1; i >= 0; i--) {
            var e = _strokes[i]
            if (_hits(e, l[0], l[1], x, y)) {
                _erasing.items.push({ entry: e, pos: i })
                _strokes.splice(i, 1)
                hit = true
            }
        }
        _erasing.last = [x, y]
        if (hit) {
            _count = _strokes.length
            _repaintAll()
        }
    }

    function eraseEnd() {
        if (!_erasing) return
        var items = _erasing.items
        _erasing = null
        if (!items.length) return
        _undo.push({ type: "erase", items: items })
        _redo = []
        _changed(false)
    }

    // ------------------------------------------------------------------ internals

    function _p(v) { return v === undefined || v === null || isNaN(v) ? 0.5 : Math.max(0, Math.min(1, v)) }

    function _entry(el) {
        var outline = Excalidraw.freedrawOutline(el)
        var b = [Infinity, Infinity, -Infinity, -Infinity]
        for (var i = 0; i < outline.length; i++) {
            var x = outline[i][0] + el.x, y = outline[i][1] + el.y
            if (x < b[0]) b[0] = x
            if (y < b[1]) b[1] = y
            if (x > b[2]) b[2] = x
            if (y > b[3]) b[3] = y
        }
        var pts = el.points.map(function (p) { return [p[0] + el.x, p[1] + el.y] })
        return { el: el, d: Excalidraw.outlineToSvgPath(outline, el.x, el.y), bounds: b, pts: pts,
                 r: el.strokeWidth * 4.25 * 0.5 }
    }

    function _removeEntry(entry) {
        var i = _strokes.indexOf(entry)
        if (i >= 0) _strokes.splice(i, 1)
    }

    function _changed(full) {
        _count = _strokes.length
        _undoCount = _undo.length
        _redoCount = _redo.length
        if (full) _repaintAll()
        edited()
    }

    function _repaintAll() {
        _full = true
        _queue = []
        committed.requestPaint()
        live.requestPaint()
    }

    function _color(c) { return Excalidraw.mapColor(c, { dark: dark, foreground: _fg }) }
    // Same, as a QML color (QML colors do not take CSS rgba() strings).
    function _qcolor(c) {
        var p = Excalidraw.parseColor(_color(c))
        return p ? Qt.rgba(p[0] / 255, p[1] / 255, p[2] / 255, p[3]) : "transparent"
    }

    function _segDist2(px, py, ax, ay, bx, by) {
        var dx = bx - ax, dy = by - ay
        var l = dx * dx + dy * dy
        var t = l > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0
        var qx = ax + t * dx - px, qy = ay + t * dy - py
        return qx * qx + qy * qy
    }

    function _cross(ax, ay, bx, by, cx, cy) { return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) }

    // Does the eraser segment (x0,y0)→(x1,y1) touch the stroke?
    function _hits(e, x0, y0, x1, y1) {
        var r = eraserRadius + e.r
        if (Math.max(x0, x1) < e.bounds[0] - eraserRadius || Math.min(x0, x1) > e.bounds[2] + eraserRadius
            || Math.max(y0, y1) < e.bounds[1] - eraserRadius || Math.min(y0, y1) > e.bounds[3] + eraserRadius) return false
        var r2 = r * r, p = e.pts
        if (p.length === 1) return _segDist2(p[0][0], p[0][1], x0, y0, x1, y1) <= r2
        for (var i = 0; i < p.length - 1; i++) {
            var ax = p[i][0], ay = p[i][1], bx = p[i + 1][0], by = p[i + 1][1]
            if (_segDist2(ax, ay, x0, y0, x1, y1) <= r2 || _segDist2(x0, y0, ax, ay, bx, by) <= r2
                || _segDist2(x1, y1, ax, ay, bx, by) <= r2) return true
            var d1 = _cross(x0, y0, x1, y1, ax, ay), d2 = _cross(x0, y0, x1, y1, bx, by)
            var d3 = _cross(ax, ay, bx, by, x0, y0), d4 = _cross(ax, ay, bx, by, x1, y1)
            if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return true
        }
        return false
    }

    // --- pointer plumbing ---

    function _devName(point) {
        var d = point.device
        if (!d) return "?"
        var t = d.type, pt = d.pointerType
        var tn = t === PointerDevice.Stylus ? "stylus" : t === PointerDevice.Airbrush ? "airbrush" : t === PointerDevice.TouchScreen ? "touchscreen"
               : t === PointerDevice.TouchPad ? "touchpad" : t === PointerDevice.Mouse ? "mouse" : t === PointerDevice.Puck ? "puck" : "type" + t
        var pn = pt === PointerDevice.Pen ? "pen" : pt === PointerDevice.Eraser ? "eraser" : pt === PointerDevice.Finger ? "finger"
               : pt === PointerDevice.Generic ? "generic" : pt === PointerDevice.Cursor ? "cursor" : "ptype" + pt
        return tn + "/" + pn + " \"" + d.name + "\""
    }

    function _log(what, point, kind) {
        _lastInput = what + " " + kind + " " + _devName(point) + " p=" + Number(point.pressure).toFixed(3)
            + " buttons=" + point.pressedButtons + " @" + Math.round(point.position.x) + "," + Math.round(point.position.y)
        if (logInput && (what !== "move" || (_moveLog++ % 10) === 0)) console.log("[DrawPad]", _lastInput)
    }

    function _isEraser(point, kind) {
        if (eraserMode) return true
        if (kind === "pen") {
            return (point.device && point.device.pointerType === PointerDevice.Eraser)
                || (point.pressedButtons & (Qt.RightButton | Qt.MiddleButton)) !== 0
        }
        if (kind === "mouse") return (point.pressedButtons & Qt.RightButton) !== 0
        return false
    }

    function _down(point, kind) {
        _log("down", point, kind)
        var x = point.position.x, y = point.position.y
        if (kind === "pen") {
            _penSeen = true
            _penActive = true
            if (_cur && _cur.kind !== "pen") cancelStroke()     // palm landed first
            if (_erasing) eraseEnd()
        } else if (kind === "touch") {
            _touchBlocked = !touchDraws || penNear || (penOnlyAfterPen && _penSeen) || _cur !== null || _erasing !== null
            if (_touchBlocked) return
        } else {
            // mouse: ignore events synthesized from touch/tablet, and anything while busy or a pen is near
            var dt = point.device ? point.device.type : PointerDevice.Mouse
            if (_cur || _erasing || penNear || (dt !== PointerDevice.Mouse && dt !== PointerDevice.TouchPad)) return
        }
        _cursor = Qt.point(x, y)
        if (_isEraser(point, kind)) {
            _cursorEraser = true
            eraseBegin(x, y)
            _erasing.kind = kind
        } else {
            beginStroke(x, y, point.pressure, kind)
        }
    }

    function _move(point, kind) {
        if (kind === "touch" && _touchBlocked) return
        var x = point.position.x, y = point.position.y
        _log("move", point, kind)
        _cursor = Qt.point(x, y)
        if (_erasing && _erasing.kind === kind) eraseMove(x, y)
        else if (_cur && _cur.kind === kind) addPoint(x, y, point.pressure)
    }

    function _up(point, kind) {
        _log("up", point, kind)
        if (kind === "pen") {
            _penActive = false
            _penRecent = true
            penRecentTimer.restart()
        }
        if (kind === "touch" && _touchBlocked) { _touchBlocked = false; return }
        if (_erasing && _erasing.kind === kind) {
            eraseEnd()
            _cursorEraser = eraserMode || _penHoverEraser
        } else if (_cur && _cur.kind === kind) {
            if (kind === "touch" && (penNear || (penOnlyAfterPen && _penSeen))) cancelStroke()
            else endStroke(point.position.x, point.position.y, kind === "pen" ? 0 : undefined)
        }
    }

    property bool _penHoverEraser: false

    Keys.onPressed: function (event) {
        if (!(event.modifiers & Qt.ControlModifier)) return
        if (event.key === Qt.Key_Z && (event.modifiers & Qt.ShiftModifier) || event.key === Qt.Key_Y) { redo(); event.accepted = true }
        else if (event.key === Qt.Key_Z) { undo(); event.accepted = true }
    }

    Timer {
        id: penRecentTimer
        interval: 600
        onTriggered: pad._penRecent = false
    }

    // ------------------------------------------------------------------ visuals

    component ToolButton: Rectangle {
        id: tb
        property string glyph: ""
        property string tip: ""
        property bool selected: false
        property bool enabledState: true
        signal clicked()
        width: 30
        height: 28
        radius: 0
        color: selected ? Qt.rgba(pad.accent.r, pad.accent.g, pad.accent.b, 0.22)
             : ma.containsMouse ? Qt.rgba(pad._uiFg.r, pad._uiFg.g, pad._uiFg.b, 0.10) : "transparent"
        border.width: selected ? 1 : 0
        border.color: pad.accent
        opacity: enabledState ? 1 : 0.35
        Text {
            anchors.centerIn: parent
            text: tb.glyph
            color: pad._uiFg
            font.family: pad.fontFamily
            font.pixelSize: 16
        }
        MouseArea {
            id: ma
            anchors.fill: parent
            hoverEnabled: true
            enabled: tb.enabledState
            onClicked: tb.clicked()
        }
    }

    Rectangle {
        anchors.fill: parent
        color: pad.background
        border.width: 1
        border.color: pad.border
    }

    Row {
        id: toolbar
        visible: pad.showToolbar
        x: 4
        y: 4
        height: visible ? 28 : 0
        spacing: 2

        ToolButton {
            glyph: "\u{F03EB}"   // nf-md-pencil
            tip: "pen"
            selected: !pad.eraserMode
            onClicked: pad.eraserMode = false
        }
        ToolButton {
            glyph: "\u{F01FE}"   // nf-md-eraser
            tip: "eraser"
            selected: pad.eraserMode
            onClicked: pad.eraserMode = !pad.eraserMode
        }
        Item { width: 8; height: 1 }
        Repeater {
            model: pad.colors
            delegate: Rectangle {
                required property string modelData
                width: 24
                height: 28
                color: pad.strokeColor === modelData && !pad.eraserMode ? Qt.rgba(pad.accent.r, pad.accent.g, pad.accent.b, 0.22) : "transparent"
                border.width: pad.strokeColor === modelData && !pad.eraserMode ? 1 : 0
                border.color: pad.accent
                Rectangle {
                    anchors.centerIn: parent
                    width: 14
                    height: 14
                    radius: 7
                    color: pad._qcolor(modelData)
                    border.width: 1
                    border.color: Qt.rgba(pad._uiFg.r, pad._uiFg.g, pad._uiFg.b, 0.35)
                }
                MouseArea {
                    anchors.fill: parent
                    onClicked: { pad.strokeColor = modelData; pad.eraserMode = false }
                }
            }
        }
        Item { width: 8; height: 1 }
        Repeater {
            model: pad.widths
            delegate: Rectangle {
                required property real modelData
                width: 26
                height: 28
                color: pad.strokeWidth === modelData && !pad.eraserMode ? Qt.rgba(pad.accent.r, pad.accent.g, pad.accent.b, 0.22) : "transparent"
                border.width: pad.strokeWidth === modelData && !pad.eraserMode ? 1 : 0
                border.color: pad.accent
                Rectangle {
                    anchors.centerIn: parent
                    width: Math.max(3, modelData * 4.25 * 1.2)
                    height: width
                    radius: width / 2
                    color: pad._qcolor(pad.strokeColor)
                }
                MouseArea {
                    anchors.fill: parent
                    onClicked: { pad.strokeWidth = modelData; pad.eraserMode = false }
                }
            }
        }
        Item { width: 8; height: 1 }
        ToolButton {
            glyph: "\u{F054C}"   // nf-md-undo
            tip: "undo"
            enabledState: pad.canUndo
            onClicked: pad.undo()
        }
        ToolButton {
            glyph: "\u{F044E}"   // nf-md-redo
            tip: "redo"
            enabledState: pad.canRedo
            onClicked: pad.redo()
        }
        ToolButton {
            glyph: "\u{F0A7A}"   // nf-md-trash_can_outline
            tip: "clear"
            enabledState: !pad.isEmpty
            onClicked: pad.clear()
        }
    }

    Item {
        id: surface
        anchors.fill: parent
        anchors.topMargin: toolbar.visible ? toolbar.height + 8 : 0
        clip: true

        // Keeps a parent Flickable from stealing drags that draw (mouse and touch-synthesized).
        MouseArea {
            anchors.fill: parent
            preventStealing: true
            acceptedButtons: Qt.LeftButton | Qt.RightButton
            onPressed: function (mouse) { pad.forceActiveFocus() }
        }

        Canvas {
            id: committed
            anchors.fill: parent
            onWidthChanged: pad._repaintAll()
            onHeightChanged: pad._repaintAll()
            onPaint: {
                var ctx = getContext("2d")
                var list
                if (pad._full) {
                    ctx.reset()
                    list = pad._strokes
                    pad._full = false
                    pad._queue = []
                } else {
                    list = pad._queue
                    pad._queue = []
                }
                for (var i = 0; i < list.length; i++) {
                    var c = pad._color(list[i].el.strokeColor)
                    if (c === "transparent") continue
                    ctx.fillStyle = c
                    ctx.path = list[i].d
                    ctx.fill()
                }
            }
        }

        Canvas {
            id: live
            anchors.fill: parent
            onPaint: {
                var ctx = getContext("2d")
                ctx.reset()
                var c = pad._cur
                if (!c) return
                var o = Excalidraw.strokeOutline(c.points, c.simulate ? null : c.pressures, { strokeWidth: c.width })
                ctx.fillStyle = pad._color(c.color)
                ctx.path = Excalidraw.outlineToSvgPath(o, 0, 0)
                ctx.fill()
            }
        }

        Rectangle {
            id: eraserCursor
            visible: (pad.eraserMode || pad._cursorEraser || pad._erasing !== null) && pad._cursor.x > -50
            x: pad._cursor.x - width / 2
            y: pad._cursor.y - height / 2
            width: pad.eraserRadius * 2
            height: width
            radius: width / 2
            color: "transparent"
            border.width: 1
            border.color: pad._uiFg
        }

        // Handlers sit on the topmost child so they see every press before the MouseArea.
        Item {
            id: inputLayer
            anchors.fill: parent

        HoverHandler {
            id: penHover
            acceptedDevices: PointerDevice.Stylus | PointerDevice.Airbrush
            onHoveredChanged: {
                pad._penHover = hovered
                if (hovered) pad._penSeen = true
                if (!hovered) {
                    pad._penRecent = true
                    penRecentTimer.restart()
                    if (!pad.eraserMode) pad._cursorEraser = false
                }
            }
            onPointChanged: {
                if (!hovered) return
                pad._cursor = point.position
                pad._penHoverEraser = !!point.device && point.device.pointerType === PointerDevice.Eraser
                pad._cursorEraser = pad.eraserMode || pad._penHoverEraser
            }
        }

        PointHandler {
            id: penHandler
            acceptedDevices: PointerDevice.Stylus | PointerDevice.Airbrush
            acceptedPointerTypes: PointerDevice.Pen | PointerDevice.Eraser
            acceptedButtons: Qt.LeftButton | Qt.MiddleButton | Qt.RightButton
            grabPermissions: PointerHandler.CanTakeOverFromAnything
            onActiveChanged: active ? pad._down(point, "pen") : pad._up(point, "pen")
            onPointChanged: if (active) pad._move(point, "pen")
        }

        PointHandler {
            id: touchHandler
            acceptedDevices: PointerDevice.TouchScreen
            grabPermissions: PointerHandler.CanTakeOverFromAnything
            onActiveChanged: active ? pad._down(point, "touch") : pad._up(point, "touch")
            onPointChanged: if (active) pad._move(point, "touch")
        }

        PointHandler {
            id: mouseHandler
            acceptedDevices: PointerDevice.Mouse | PointerDevice.TouchPad
            acceptedButtons: Qt.LeftButton | Qt.RightButton
            grabPermissions: PointerHandler.CanTakeOverFromAnything
            onActiveChanged: active ? pad._down(point, "mouse") : pad._up(point, "mouse")
            onPointChanged: if (active) pad._move(point, "mouse")
        }
        }
    }
}
