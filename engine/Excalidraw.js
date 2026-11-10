.pragma library
// Excalidraw support for recall: lz-string, Obsidian Excalidraw file decode/encode,
// perfect-freehand outlines (freedraw), a render list for Canvas, colours.
//
// ES5-ish on purpose: QML `.pragma library` and node (tests/load.mjs) both load it.
//
// Third-party code ported here (both MIT):
//   - lz-string 1.5, (c) 2013 Pieroxy  https://github.com/pieroxy/lz-string
//   - perfect-freehand 1.2, (c) 2021 Stephen Ruiz  https://github.com/steveruizok/perfect-freehand
// Rendering/format behaviour follows Excalidraw (MIT) as bundled in the Obsidian Excalidraw
// plugin 2.23.0 (getFreedrawOutlinePoints, getSvgPathFromStroke, THEME_FILTER, file layout).

// ---------------------------------------------------------------------------------------------
// lz-string (base64 variant only)
// ---------------------------------------------------------------------------------------------

var LZ_KEY_BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
var _lzRev = null

function _lzReverseTable() {
    if (!_lzRev) {
        _lzRev = []
        for (var i = 0; i < 128; i++) _lzRev.push(0)
        for (var j = 0; j < LZ_KEY_BASE64.length; j++) _lzRev[LZ_KEY_BASE64.charCodeAt(j)] = j
    }
    return _lzRev
}

function compressToBase64(input) {
    if (input === null || input === undefined) return ""
    var res = _lzCompress(String(input), 6, LZ_KEY_BASE64)
    switch (res.length % 4) {
    case 1: return res + "==="
    case 2: return res + "=="
    case 3: return res + "="
    default: return res
    }
}

function decompressFromBase64(input) {
    if (input === null || input === undefined) return ""
    if (input === "") return null
    var rev = _lzReverseTable()
    var n = input.length
    var vals = new Array(n)
    for (var i = 0; i < n; i++) {
        var c = input.charCodeAt(i)
        vals[i] = c < 128 ? rev[c] : 0
    }
    return _lzDecompress(n, 32, vals)
}

// Faithful to lz-string's _compress; the output alphabet is passed as a string and the
// dictionaries are prototype-free objects (so keys like "__proto__" behave).
function _lzCompress(uncompressed, bitsPerChar, alphabet) {
    var i, value
    var dictionary = Object.create(null)
    var dictionaryToCreate = Object.create(null)
    var c = "", wc = "", w = ""
    var enlargeIn = 2, dictSize = 3, numBits = 2
    var data = [], dataVal = 0, dataPos = 0
    var last = bitsPerChar - 1

    function emitW() {
        if (w in dictionaryToCreate) {
            if (w.charCodeAt(0) < 256) {
                for (i = 0; i < numBits; i++) {
                    dataVal = (dataVal << 1)
                    if (dataPos === last) { dataPos = 0; data.push(alphabet.charAt(dataVal)); dataVal = 0 } else dataPos++
                }
                value = w.charCodeAt(0)
                for (i = 0; i < 8; i++) {
                    dataVal = (dataVal << 1) | (value & 1)
                    if (dataPos === last) { dataPos = 0; data.push(alphabet.charAt(dataVal)); dataVal = 0 } else dataPos++
                    value = value >> 1
                }
            } else {
                value = 1
                for (i = 0; i < numBits; i++) {
                    dataVal = (dataVal << 1) | value
                    if (dataPos === last) { dataPos = 0; data.push(alphabet.charAt(dataVal)); dataVal = 0 } else dataPos++
                    value = 0
                }
                value = w.charCodeAt(0)
                for (i = 0; i < 16; i++) {
                    dataVal = (dataVal << 1) | (value & 1)
                    if (dataPos === last) { dataPos = 0; data.push(alphabet.charAt(dataVal)); dataVal = 0 } else dataPos++
                    value = value >> 1
                }
            }
            enlargeIn--
            if (enlargeIn === 0) { enlargeIn = Math.pow(2, numBits); numBits++ }
            delete dictionaryToCreate[w]
        } else {
            value = dictionary[w]
            for (i = 0; i < numBits; i++) {
                dataVal = (dataVal << 1) | (value & 1)
                if (dataPos === last) { dataPos = 0; data.push(alphabet.charAt(dataVal)); dataVal = 0 } else dataPos++
                value = value >> 1
            }
        }
        enlargeIn--
        if (enlargeIn === 0) { enlargeIn = Math.pow(2, numBits); numBits++ }
    }

    for (var ii = 0; ii < uncompressed.length; ii++) {
        c = uncompressed.charAt(ii)
        if (!(c in dictionary)) {
            dictionary[c] = dictSize++
            dictionaryToCreate[c] = true
        }
        wc = w + c
        if (wc in dictionary) {
            w = wc
        } else {
            emitW()
            dictionary[wc] = dictSize++
            w = c
        }
    }
    if (w !== "") emitW()

    // end of stream marker
    value = 2
    for (i = 0; i < numBits; i++) {
        dataVal = (dataVal << 1) | (value & 1)
        if (dataPos === last) { dataPos = 0; data.push(alphabet.charAt(dataVal)); dataVal = 0 } else dataPos++
        value = value >> 1
    }
    // flush the last char
    while (true) {
        dataVal = (dataVal << 1)
        if (dataPos === last) { data.push(alphabet.charAt(dataVal)); break }
        dataPos++
    }
    return data.join("")
}

function _lzDecompress(length, resetValue, vals) {
    var dictionary = [0, 1, 2]
    var enlargeIn = 4, dictSize = 4, numBits = 3
    var entry = "", result = [], w, c
    var dataVal = vals[0], dataPos = resetValue, dataIndex = 1

    function read(n) {
        var b = 0, p = 1
        for (var j = 0; j < n; j++) {
            if (dataVal & dataPos) b |= p
            dataPos >>= 1
            if (dataPos === 0) {
                dataPos = resetValue
                dataVal = dataIndex < length ? vals[dataIndex] : 0
                dataIndex++
            }
            p <<= 1
        }
        return b
    }

    switch (read(2)) {
    case 0: c = String.fromCharCode(read(8)); break
    case 1: c = String.fromCharCode(read(16)); break
    default: return ""
    }
    dictionary[3] = c
    w = c
    result.push(c)
    while (true) {
        if (dataIndex > length) return ""
        c = read(numBits)
        switch (c) {
        case 0:
            dictionary[dictSize++] = String.fromCharCode(read(8))
            c = dictSize - 1
            enlargeIn--
            break
        case 1:
            dictionary[dictSize++] = String.fromCharCode(read(16))
            c = dictSize - 1
            enlargeIn--
            break
        case 2:
            return result.join("")
        }
        if (enlargeIn === 0) { enlargeIn = Math.pow(2, numBits); numBits++ }
        if (dictionary[c]) {
            entry = dictionary[c]
        } else if (c === dictSize) {
            entry = w + w.charAt(0)
        } else {
            return null
        }
        result.push(entry)
        dictionary[dictSize++] = w + entry.charAt(0)
        enlargeIn--
        w = entry
        if (enlargeIn === 0) { enlargeIn = Math.pow(2, numBits); numBits++ }
    }
}

// ---------------------------------------------------------------------------------------------
// Obsidian Excalidraw file format
// ---------------------------------------------------------------------------------------------

var PLUGIN_VERSION = "2.23.0"
var SOURCE_URL = "https://github.com/zsviczian/obsidian-excalidraw-plugin/releases/tag/" + PLUGIN_VERSION
// Byte-for-byte the head of a drawing written by the plugin 2.23.0 (FRONTMATTER + blank line).
var FILE_HEAD = "---\n\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n\n---\n"
    + "==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠== "
    + "You can decompress Drawing data with the command palette: 'Decompress current Excalidraw file'. "
    + "For more info check in plugin settings under 'Saving'\n\n\n"
var DEFAULT_INK = "#1e1e1e"

// appState written into new files: copied from the user's newest drawings (plugin 2.23.0).
function defaultAppState() {
    return {
        theme: "dark",
        viewBackgroundColor: "#ffffff",
        currentItemStrokeColor: DEFAULT_INK,
        currentItemBackgroundColor: "transparent",
        currentItemFillStyle: "solid",
        currentItemStrokeWidth: 1,
        currentItemStrokeStyle: "solid",
        currentItemRoughness: 1,
        currentItemOpacity: 100,
        currentItemFontFamily: 5,
        currentItemFontSize: 20,
        currentItemTextAlign: "left",
        currentItemStartArrowhead: null,
        currentItemEndArrowhead: "arrow",
        currentItemArrowType: "round",
        currentItemFrameRole: null,
        scrollX: 0,
        scrollY: 0,
        zoom: { value: 1 },
        currentItemRoundness: "round",
        gridSize: 20,
        gridStep: 5,
        gridModeEnabled: false,
        gridColor: { Bold: "rgba(217, 217, 217, 0.5)", Regular: "rgba(230, 230, 230, 0.5)" },
        currentStrokeOptions: null,
        frameRendering: { enabled: true, clip: true, name: true, outline: true, markerName: true, markerEnabled: true },
        objectsSnapModeEnabled: false,
        activeTool: { type: "freedraw", customType: null, locked: false, fromSelection: false, lastActiveTool: null },
        disableContextMenu: false
    }
}

function _frontmatter(text) {
    if (text.slice(0, 3) !== "---") return ""
    var end = text.indexOf("\n---", 3)
    return end < 0 ? "" : text.slice(3, end)
}

// True for an Obsidian Excalidraw markdown drawing or a plain .excalidraw JSON file.
function isDrawingFile(text) {
    if (typeof text !== "string" || !text.length) return false
    if (/^excalidraw-plugin\s*:/m.test(_frontmatter(text))) return true
    if (/\n##? Drawing\n[^`]*```(compressed-json|json)\n/.test(text)) return true
    var t = text.replace(/^\s+/, "")
    return t.charAt(0) === "{" && /"type"\s*:\s*"excalidraw"/.test(t.slice(0, 200))
}

// Finds the scene JSON text in a drawing file. → {json, compressed} or null.
function _extractSceneJson(text) {
    var m = /\n##? Drawing\n[^`]*```compressed-json\n([\s\S]*?)```/.exec(text)
        || /```compressed-json\n([\s\S]*?)```/.exec(text)
    if (m) {
        var packed = m[1].replace(/[\n\r\s]/g, "")
        var json = decompressFromBase64(packed)
        if (json === null || json === "") return { json: "", compressed: true }
        return { json: json.slice(0, json.lastIndexOf("}") + 1), compressed: true }
    }
    m = /\n##? Drawing\n[^`]*```json\n([\s\S]*?)```/.exec(text) || /```json\n([\s\S]*?)```/.exec(text)
    if (m) return { json: m[1].slice(0, m[1].lastIndexOf("}") + 1), compressed: false }
    var t = text.replace(/^\s+/, "")
    if (t.charAt(0) === "{") return { json: t, compressed: false }
    return null
}

// "## Embedded Files" section → {fileId: {link: "name.png"} | {url: "https://..."} | {latex}}
function _parseEmbedded(text) {
    var out = {}
    var i = text.indexOf("## Embedded Files\n")
    var skip = 18
    if (i < 0) { i = text.indexOf("# Embedded files\n"); skip = 17 }
    if (i < 0) return out
    var end = text.indexOf("\n%%", i)
    var sec = text.slice(i + skip, end < 0 ? undefined : end + 1)
    var re = /^([\w\d]*):\s*!?\[\[([^\]]*)]]\s*(\{[^}]*})?\s*$/gm
    var m
    while ((m = re.exec(sec)) !== null) {
        var link = m[2]
        var bar = link.indexOf("|")
        out[m[1]] = { link: bar >= 0 ? link.slice(0, bar) : link }
    }
    re = /^([\w\d]*):\s*((?:https?|file|ftps?):\/\/\S*)\s*$/gm
    while ((m = re.exec(sec)) !== null) out[m[1]] = { url: m[2] }
    re = /^([\w\d]*):\s*\$\$([\s\S]*?)\$\$\s*$/gm
    while ((m = re.exec(sec)) !== null) out[m[1]] = { latex: m[2] }
    return out
}

// Decodes a drawing file. Never throws: on failure `error` is set and `elements` is empty.
// → {type, version, source, elements (all, incl. isDeleted), appState, files, embedded, compressed, error}
function decodeFile(text) {
    var res = { type: "excalidraw", version: 2, source: "", elements: [], appState: {}, files: {}, embedded: {}, compressed: false, error: "" }
    if (typeof text !== "string" || !text.length) { res.error = "empty file"; return res }
    var ex = _extractSceneJson(text)
    if (!ex) { res.error = "no drawing section"; return res }
    res.compressed = ex.compressed
    if (!ex.json) { res.error = "could not decompress drawing"; return res }
    var scene
    try {
        scene = JSON.parse(ex.json)
    } catch (e) {
        res.error = "bad drawing JSON: " + e.message
        return res
    }
    if (!scene || typeof scene !== "object") { res.error = "bad drawing JSON"; return res }
    if (scene.type) res.type = scene.type
    if (scene.version !== undefined) res.version = scene.version
    res.source = scene.source || ""
    res.elements = Array.isArray(scene.elements) ? scene.elements : []
    res.appState = scene.appState || {}
    res.files = scene.files || {}
    res.embedded = _parseEmbedded(text)
    return res
}

function _chunk(s, n) {
    var parts = []
    for (var i = 0; i < s.length; i += n) parts.push(s.slice(i, i + n))
    return parts.join("\n\n")
}

// Writes a complete drawing `.md` in the layout of the Obsidian Excalidraw plugin 2.23.0.
// opts: {compress (default true), appState (merged over defaultAppState() unless
//        mergeAppState === false), files, source, embedded: {fileId: "name.png" | {link} | {url}}}
function encodeFile(elements, opts) {
    opts = opts || {}
    var compress = opts.compress !== false
    var appState
    if (opts.appState && opts.mergeAppState === false) {
        appState = opts.appState
    } else {
        appState = defaultAppState()
        if (opts.appState) for (var k in opts.appState) appState[k] = opts.appState[k]
    }
    var scene = {
        type: "excalidraw",
        version: 2,
        source: opts.source || SOURCE_URL,
        elements: elements || [],
        appState: appState,
        files: opts.files || {}
    }
    var json = JSON.stringify(scene, null, "\t")
    var out = FILE_HEAD + "# Excalidraw Data\n\n## Text Elements\n"
    for (var i = 0; i < scene.elements.length; i++) {
        var el = scene.elements[i]
        if (!el || el.type !== "text" || el.isDeleted) continue
        var raw = el.rawText !== undefined ? el.rawText : (el.originalText !== undefined ? el.originalText : el.text)
        out += raw + " ^" + el.id + "\n\n"
    }
    var emb = opts.embedded || {}
    var ids = Object.keys(emb)
    if (ids.length) {
        out += "## Embedded Files\n"
        for (var j = 0; j < ids.length; j++) {
            var e = emb[ids[j]]
            if (typeof e === "string") e = /^[a-z]+:\/\//.test(e) ? { url: e } : { link: e }
            if (e.url) out += ids[j] + ": " + e.url + "\n\n"
            else if (e.latex !== undefined) out += ids[j] + ": $$" + e.latex + "$$\n\n"
            else out += ids[j] + ": [[" + e.link + "]]\n\n"
        }
    }
    out += "%%\n"
    if (compress) out += "## Drawing\n```compressed-json\n" + _chunk(compressToBase64(json), 256) + "\n```\n%%"
    else out += "## Drawing\n```json\n" + json + "\n```\n%%"
    return out
}

// ---------------------------------------------------------------------------------------------
// New elements (property set copied from the user's freedraw elements, plugin 2.23.0)
// ---------------------------------------------------------------------------------------------

var _ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
var _INDEX_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

function randomId() {
    var s = ""
    for (var i = 0; i < 21; i++) s += _ID_CHARS.charAt(Math.floor(Math.random() * 64))
    return s
}

function randomInteger() {
    return Math.floor(Math.random() * 2147483648)
}

// Next fractional index after `key` (fractional-indexing's generateKeyBetween(key, null) for
// integer keys): a0 … a9 aA … aZ aa … az b00 b01 …
function nextIndexKey(key) {
    if (!key) return "a0"
    var head = key.charAt(0)
    var len = head >= "a" ? head.charCodeAt(0) - 95 : 92 - head.charCodeAt(0)
    var digs = key.slice(1, len).split("")
    for (var i = digs.length - 1; i >= 0; i--) {
        var d = _INDEX_DIGITS.indexOf(digs[i]) + 1
        if (d < _INDEX_DIGITS.length) {
            digs[i] = _INDEX_DIGITS.charAt(d)
            return head + digs.join("")
        }
        digs[i] = "0"
    }
    if (head === "Z") return "a0"
    var h = String.fromCharCode(head.charCodeAt(0) + 1)
    if (h > "a") digs.push("0")
    else digs.pop()
    return h + digs.join("")
}

function _round(v, digits) {
    var f = Math.pow(10, digits)
    return Math.round(v * f) / f
}

// A freedraw element exactly like Excalidraw writes one.
// absPoints: [[x, y], ...] in scene coordinates (first point becomes the element origin).
// pressures: [p, ...] (0..1) or null/[] for simulated pressure.
// opts: {strokeColor, strokeWidth, index, opacity, now}
function newFreedrawElement(absPoints, pressures, opts) {
    opts = opts || {}
    var x0 = absPoints.length ? absPoints[0][0] : 0
    var y0 = absPoints.length ? absPoints[0][1] : 0
    var pts = [], minX = 0, minY = 0, maxX = 0, maxY = 0
    for (var i = 0; i < absPoints.length; i++) {
        var px = _round(absPoints[i][0] - x0, 2), py = _round(absPoints[i][1] - y0, 2)
        pts.push([px, py])
        if (px < minX) minX = px
        if (py < minY) minY = py
        if (px > maxX) maxX = px
        if (py > maxY) maxY = py
    }
    var simulate = !pressures || !pressures.length
    var pr = []
    if (!simulate) for (var j = 0; j < pressures.length; j++) pr.push(_round(pressures[j], 4))
    return {
        id: randomId(),
        type: "freedraw",
        x: _round(x0, 2),
        y: _round(y0, 2),
        width: _round(maxX - minX, 2),
        height: _round(maxY - minY, 2),
        angle: 0,
        strokeColor: opts.strokeColor || DEFAULT_INK,
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: opts.strokeWidth || 1,
        strokeStyle: "solid",
        roughness: 1,
        opacity: opts.opacity === undefined ? 100 : opts.opacity,
        groupIds: [],
        frameId: null,
        index: opts.index || "a0",
        roundness: null,
        seed: randomInteger(),
        version: pts.length + 2,
        versionNonce: randomInteger(),
        isDeleted: false,
        boundElements: null,
        updated: opts.now || Date.now(),
        link: null,
        locked: false,
        points: pts,
        pressures: pr,
        simulatePressure: simulate
    }
}

// ---------------------------------------------------------------------------------------------
// perfect-freehand 1.2 (faithful port: same arithmetic, same float loops)
// ---------------------------------------------------------------------------------------------

var PF_RATE_OF_PRESSURE_CHANGE = 0.275
var PF_FIXED_PI = Math.PI + 0.0001

function _vadd(A, B) { return [A[0] + B[0], A[1] + B[1]] }
function _vsub(A, B) { return [A[0] - B[0], A[1] - B[1]] }
function _vmul(A, n) { return [A[0] * n, A[1] * n] }
function _vper(A) { return [A[1], -A[0]] }
function _vdpr(A, B) { return A[0] * B[0] + A[1] * B[1] }
function _veq(A, B) { return A[0] === B[0] && A[1] === B[1] }
function _vdist2(A, B) { var d = _vsub(A, B); return d[0] * d[0] + d[1] * d[1] }
function _vuni(A) { var l = Math.hypot(A[0], A[1]); return [A[0] / l, A[1] / l] }
function _vdist(A, B) { return Math.hypot(A[1] - B[1], A[0] - B[0]) }
function _vlrp(A, B, t) { return _vadd(A, _vmul(_vsub(B, A), t)) }
function _vprj(A, B, c) { return _vadd(A, _vmul(B, c)) }
function _vrotAround(A, C, r) {
    var s = Math.sin(r), c = Math.cos(r)
    var px = A[0] - C[0], py = A[1] - C[1]
    var ny = px * s + py * c
    return [px * c - py * s + C[0], ny + C[1]]
}

function _pfStrokeRadius(size, thinning, pressure, easing) {
    return size * easing(0.5 - thinning * (0.5 - pressure))
}

function getStrokePoints(points, options) {
    options = options || {}
    var streamline = options.streamline === undefined ? 0.5 : options.streamline
    var size = options.size === undefined ? 16 : options.size
    var isComplete = options.last === undefined ? false : options.last
    if (points.length === 0) return []
    var t = 0.15 + (1 - streamline) * 0.85
    var pts = Array.isArray(points[0]) ? points : points.map(function (p) {
        return [p.x, p.y, p.pressure === undefined ? 0.5 : p.pressure]
    })
    if (pts.length === 2) {
        var lastPt = pts[1]
        pts = pts.slice(0, -1)
        for (var k = 1; k < 5; k++) pts.push(_vlrp(pts[0], lastPt, k / 4))
    }
    if (pts.length === 1) pts = [pts[0], _vadd(pts[0], [1, 1]).concat(pts[0].slice(2))]
    var strokePoints = [{
        point: [pts[0][0], pts[0][1]],
        pressure: pts[0][2] >= 0 ? pts[0][2] : 0.25,
        vector: [1, 1],
        distance: 0,
        runningLength: 0
    }]
    var hasReachedMinimumLength = false
    var runningLength = 0
    var prev = strokePoints[0]
    var max = pts.length - 1
    for (var i = 1; i < pts.length; i++) {
        var point = isComplete && i === max ? pts[i].slice(0, 2) : _vlrp(prev.point, pts[i], t)
        if (_veq(prev.point, point)) continue
        var distance = _vdist(point, prev.point)
        runningLength += distance
        if (i < max && !hasReachedMinimumLength) {
            if (runningLength < size) continue
            hasReachedMinimumLength = true
        }
        prev = {
            point: point,
            pressure: pts[i][2] >= 0 ? pts[i][2] : 0.5,
            vector: _vuni(_vsub(prev.point, point)),
            distance: distance,
            runningLength: runningLength
        }
        strokePoints.push(prev)
    }
    strokePoints[0].vector = (strokePoints[1] && strokePoints[1].vector) || [0, 0]
    return strokePoints
}

function getStrokeOutlinePoints(points, options) {
    options = options || {}
    var size = options.size === undefined ? 16 : options.size
    var smoothing = options.smoothing === undefined ? 0.5 : options.smoothing
    var thinning = options.thinning === undefined ? 0.5 : options.thinning
    var simulatePressure = options.simulatePressure === undefined ? true : options.simulatePressure
    var easing = options.easing === undefined ? function (t) { return t } : options.easing
    var start = options.start === undefined ? {} : options.start
    var end = options.end === undefined ? {} : options.end
    var isComplete = options.last === undefined ? false : options.last
    var capStart = start.cap === undefined ? true : start.cap
    var taperStartEase = start.easing === undefined ? function (t) { return t * (2 - t) } : start.easing
    var capEnd = end.cap === undefined ? true : end.cap
    var taperEndEase = end.easing === undefined ? function (t) { return --t * t * t + 1 } : end.easing

    if (points.length === 0 || size <= 0) return []

    var totalLength = points[points.length - 1].runningLength
    var taperStart = start.taper === false ? 0 : start.taper === true ? Math.max(size, totalLength) : start.taper
    var taperEnd = end.taper === false ? 0 : end.taper === true ? Math.max(size, totalLength) : end.taper
    var minDistance = Math.pow(size * smoothing, 2)
    var leftPts = [], rightPts = []

    var prevPressure = points.slice(0, 10).reduce(function (acc, curr) {
        var pressure = curr.pressure
        if (simulatePressure) {
            var sp = Math.min(1, curr.distance / size)
            var rp = Math.min(1, 1 - sp)
            pressure = Math.min(1, acc + sp * PF_RATE_OF_PRESSURE_CHANGE * (rp - acc))
        }
        return (acc + pressure) / 2
    }, points[0].pressure)

    var radius = _pfStrokeRadius(size, thinning, points[points.length - 1].pressure, easing)
    var firstRadius
    var prevVector = points[0].vector
    var pl = points[0].point, pr = pl, tl = pl, tr = pl
    var isPrevPointSharpCorner = false
    var off, step, t

    for (var i = 0; i < points.length; i++) {
        var pressure = points[i].pressure
        var point = points[i].point, vector = points[i].vector
        var distance = points[i].distance, runningLength = points[i].runningLength
        if (i < points.length - 1 && totalLength - runningLength < 3) continue

        if (thinning) {
            if (simulatePressure) {
                var sp2 = Math.min(1, distance / size)
                var rp2 = Math.min(1, 1 - sp2)
                pressure = Math.min(1, prevPressure + sp2 * PF_RATE_OF_PRESSURE_CHANGE * (rp2 - prevPressure))
            }
            radius = _pfStrokeRadius(size, thinning, pressure, easing)
        } else {
            radius = size / 2
        }
        if (firstRadius === undefined) firstRadius = radius

        var ts = runningLength < taperStart ? taperStartEase(runningLength / taperStart) : 1
        var te = totalLength - runningLength < taperEnd ? taperEndEase((totalLength - runningLength) / taperEnd) : 1
        radius = Math.max(0.01, radius * Math.min(ts, te))

        var nextVector = (i < points.length - 1 ? points[i + 1] : points[i]).vector
        var nextDpr = i < points.length - 1 ? _vdpr(vector, nextVector) : 1.0
        var prevDpr = _vdpr(vector, prevVector)
        var isPointSharpCorner = prevDpr < 0 && !isPrevPointSharpCorner
        var isNextPointSharpCorner = nextDpr !== null && nextDpr < 0

        if (isPointSharpCorner || isNextPointSharpCorner) {
            off = _vmul(_vper(prevVector), radius)
            for (step = 1 / 13, t = 0; t <= 1; t += step) {
                tl = _vrotAround(_vsub(point, off), point, PF_FIXED_PI * t)
                leftPts.push(tl)
                tr = _vrotAround(_vadd(point, off), point, PF_FIXED_PI * -t)
                rightPts.push(tr)
            }
            pl = tl
            pr = tr
            if (isNextPointSharpCorner) isPrevPointSharpCorner = true
            continue
        }
        isPrevPointSharpCorner = false

        if (i === points.length - 1) {
            off = _vmul(_vper(vector), radius)
            leftPts.push(_vsub(point, off))
            rightPts.push(_vadd(point, off))
            continue
        }

        off = _vmul(_vper(_vlrp(nextVector, vector, nextDpr)), radius)
        tl = _vsub(point, off)
        if (i <= 1 || _vdist2(pl, tl) > minDistance) {
            leftPts.push(tl)
            pl = tl
        }
        tr = _vadd(point, off)
        if (i <= 1 || _vdist2(pr, tr) > minDistance) {
            rightPts.push(tr)
            pr = tr
        }
        prevPressure = pressure
        prevVector = vector
    }

    var firstPoint = points[0].point.slice(0, 2)
    var lastPoint = points.length > 1 ? points[points.length - 1].point.slice(0, 2) : _vadd(points[0].point, [1, 1])
    var startCap = [], endCap = []

    if (points.length === 1) {
        if (!(taperStart || taperEnd) || isComplete) {
            var st = _vprj(firstPoint, _vuni(_vper(_vsub(firstPoint, lastPoint))), -(firstRadius || radius))
            var dotPts = []
            for (step = 1 / 13, t = step; t <= 1; t += step) dotPts.push(_vrotAround(st, firstPoint, PF_FIXED_PI * 2 * t))
            return dotPts
        }
    } else {
        if (taperStart || (taperEnd && points.length === 1)) {
            // tapered start: no cap
        } else if (capStart) {
            for (step = 1 / 13, t = step; t <= 1; t += step) startCap.push(_vrotAround(rightPts[0], firstPoint, PF_FIXED_PI * t))
        } else {
            var cornersVector = _vsub(leftPts[0], rightPts[0])
            var offsetA = _vmul(cornersVector, 0.5)
            var offsetB = _vmul(cornersVector, 0.51)
            startCap.push(_vsub(firstPoint, offsetA), _vsub(firstPoint, offsetB), _vadd(firstPoint, offsetB), _vadd(firstPoint, offsetA))
        }
        var lv = points[points.length - 1].vector
        var direction = _vper([-lv[0], -lv[1]])
        if (taperEnd || (taperStart && points.length === 1)) {
            endCap.push(lastPoint)
        } else if (capEnd) {
            var se = _vprj(lastPoint, direction, radius)
            for (step = 1 / 29, t = step; t < 1; t += step) endCap.push(_vrotAround(se, lastPoint, PF_FIXED_PI * 3 * t))
        } else {
            endCap.push(_vadd(lastPoint, _vmul(direction, radius)), _vadd(lastPoint, _vmul(direction, radius * 0.99)),
                _vsub(lastPoint, _vmul(direction, radius * 0.99)), _vsub(lastPoint, _vmul(direction, radius)))
        }
    }
    return leftPts.concat(endCap, rightPts.reverse(), startCap)
}

function getStroke(points, options) {
    return getStrokeOutlinePoints(getStrokePoints(points, options), options)
}

// Excalidraw's named easings (used by the Obsidian plugin's custom pens, customData.strokeOptions).
var EASINGS = {
    linear: function (t) { return t },
    easeInQuad: function (t) { return t * t },
    easeOutQuad: function (t) { return 1 - (1 - t) * (1 - t) },
    easeInOutQuad: function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2 },
    easeInCubic: function (t) { return t * t * t },
    easeOutCubic: function (t) { return 1 - Math.pow(1 - t, 3) },
    easeInOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2 },
    easeInSine: function (t) { return 1 - Math.cos(t * Math.PI / 2) },
    easeOutSine: function (t) { return Math.sin(t * Math.PI / 2) },
    easeInOutSine: function (t) { return -(Math.cos(Math.PI * t) - 1) / 2 },
    easeInQuart: function (t) { return t * t * t * t },
    easeOutQuart: function (t) { return 1 - Math.pow(1 - t, 4) },
    easeInOutQuart: function (t) { return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2 },
    easeInExpo: function (t) { return t === 0 ? 0 : Math.pow(2, 10 * t - 10) },
    easeOutExpo: function (t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t) },
    easeInCirc: function (t) { return 1 - Math.sqrt(1 - Math.pow(t, 2)) },
    easeOutCirc: function (t) { return Math.sqrt(1 - Math.pow(t - 1, 2)) }
}

function _easing(name) { return EASINGS[name] || EASINGS.linear }

// Options Excalidraw passes to getStroke for a freedraw element (getFreedrawOutlinePoints),
// including the Obsidian plugin's custom pen presets.
function freedrawStrokeOptions(el) {
    var custom = el.customData && el.customData.strokeOptions && el.customData.strokeOptions.options
    if (!custom) {
        return {
            simulatePressure: !!el.simulatePressure,
            size: (el.strokeWidth || 1) * 4.25,
            thinning: 0.6,
            smoothing: 0.5,
            streamline: 0.5,
            easing: EASINGS.easeOutSine,
            last: true
        }
    }
    var o = {}, k
    for (k in custom) o[k] = custom[k]
    o.simulatePressure = custom.simulatePressure !== undefined && custom.simulatePressure !== null ? custom.simulatePressure : !!el.simulatePressure
    o.size = (el.strokeWidth || 1) * 4.25
    o.last = true
    o.easing = _easing(custom.easing)
    if (custom.start) {
        o.start = {}
        for (k in custom.start) o.start[k] = custom.start[k]
        if (custom.start.easing) o.start.easing = _easing(custom.start.easing)
    }
    if (custom.end) {
        o.end = {}
        for (k in custom.end) o.end[k] = custom.end[k]
        if (custom.end.easing) o.end.easing = _easing(custom.end.easing)
    }
    return o
}

// Outline polygon of a freedraw element in element-local coordinates (relative to x/y).
function freedrawOutline(el) {
    var pts = el.points || []
    var input
    if (el.simulatePressure) input = pts
    else if (pts.length) {
        var pr = el.pressures || []
        input = pts.map(function (p, i) { return [p[0], p[1], pr[i]] })
    } else input = [[0, 0, 0.5]]
    return getStroke(input, freedrawStrokeOptions(el))
}

// Outline for a live/pad stroke. points: [[x, y], ...]; pressures: [p...] or null (simulated).
// opts: {strokeWidth (1), simulatePressure, last (true)}
function strokeOutline(points, pressures, opts) {
    opts = opts || {}
    var simulate = opts.simulatePressure !== undefined ? opts.simulatePressure : !(pressures && pressures.length)
    var input = simulate ? points : points.map(function (p, i) { return [p[0], p[1], pressures[i]] })
    if (!input.length) input = [[0, 0, 0.5]]
    var o = freedrawStrokeOptions({ strokeWidth: opts.strokeWidth || 1, simulatePressure: simulate })
    if (opts.last !== undefined) o.last = opts.last
    return getStroke(input, o)
}

function _n(v) { return String(Math.round(v * 100) / 100) }
function _r2(v) { return Math.round(v * 100) / 100 }

// Excalidraw's getSvgPathFromStroke: quadratic curves through the outline midpoints.
// dx/dy translate the points (element origin); numbers rounded to 2 decimals. Numbers are
// joined natively (Array.join) because number→string in QML's JS engine is slow.
function outlineToSvgPath(pts, dx, dy) {
    if (!pts.length) return ""
    dx = dx || 0
    dy = dy || 0
    var n = pts.length - 1
    var x0 = _r2(pts[0][0] + dx), y0 = _r2(pts[0][1] + dy)
    var parts = new Array(6 + 4 * (n + 1) + 4)
    var k = 0
    parts[k++] = "M"; parts[k++] = x0; parts[k++] = y0; parts[k++] = "Q"
    for (var i = 0; i <= n; i++) {
        var a = pts[i], b = i === n ? pts[0] : pts[i + 1]
        parts[k++] = _r2(a[0] + dx)
        parts[k++] = _r2(a[1] + dy)
        parts[k++] = _r2((a[0] + b[0]) / 2 + dx)
        parts[k++] = _r2((a[1] + b[1]) / 2 + dy)
    }
    parts[k++] = "L"; parts[k++] = x0; parts[k++] = y0; parts[k++] = "Z"
    parts.length = k
    return parts.join(" ")
}

// ---------------------------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------------------------

var NAMED_COLORS = {
    black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff",
    yellow: "#ffff00", orange: "#ffa500", gray: "#808080", grey: "#808080", purple: "#800080"
}

// → [r, g, b, a] with r,g,b 0..255 and a 0..1, or null if unparseable.
function parseColor(c) {
    if (typeof c !== "string") return null
    var s = c.replace(/\s+/g, "").toLowerCase()
    if (s === "transparent" || s === "") return [0, 0, 0, 0]
    if (NAMED_COLORS[s]) s = NAMED_COLORS[s]
    if (s.charAt(0) === "#") {
        var h = s.slice(1)
        if (!/^[0-9a-f]+$/.test(h)) return null
        if (h.length === 3 || h.length === 4) {
            var x = ""
            for (var i = 0; i < h.length; i++) x += h.charAt(i) + h.charAt(i)
            h = x
        }
        if (h.length !== 6 && h.length !== 8) return null
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16),
            h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1]
    }
    var m = /^rgba?\(([\d.]+),([\d.]+),([\d.]+)(?:,([\d.]+))?\)$/.exec(s)
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]
    return null
}

function _hex2(v) {
    var s = Math.round(Math.max(0, Math.min(255, v))).toString(16)
    return s.length < 2 ? "0" + s : s
}

function formatColor(rgba) {
    if (rgba[3] >= 1) return "#" + _hex2(rgba[0]) + _hex2(rgba[1]) + _hex2(rgba[2])
    return "rgba(" + Math.round(rgba[0]) + "," + Math.round(rgba[1]) + "," + Math.round(rgba[2]) + "," + _round(rgba[3], 3) + ")"
}

// Excalidraw's dark theme is the CSS filter `invert(93%) hue-rotate(180deg)` over the canvas.
// Same maths per colour (filter functions operate on sRGB values).
function darkColor(c) {
    var p = parseColor(c)
    if (!p) return c
    if (p[3] === 0) return "transparent"
    var r = p[0] / 255, g = p[1] / 255, b = p[2] / 255
    r = 0.93 - 0.86 * r
    g = 0.93 - 0.86 * g
    b = 0.93 - 0.86 * b
    // hue-rotate(180deg): cos = -1, sin = 0
    var r2 = -0.574 * r + 1.43 * g + 0.144 * b
    var g2 = 0.426 * r + 0.43 * g + 0.144 * b
    var b2 = 0.426 * r + 1.43 * g - 0.856 * b
    return formatColor([Math.max(0, Math.min(1, r2)) * 255, Math.max(0, Math.min(1, g2)) * 255, Math.max(0, Math.min(1, b2)) * 255, p[3]])
}

function isDefaultInk(c) {
    var s = String(c).toLowerCase()
    return s === "#1e1e1e" || s === "#000000" || s === "#000" || s === "black"
}

// opts: {dark, foreground}. `foreground` (when non-empty) replaces the default ink colours.
function mapColor(c, opts) {
    if (!c || c === "transparent") return "transparent"
    if (opts && opts.foreground && isDefaultInk(c)) return opts.foreground
    return opts && opts.dark ? darkColor(c) : c
}

// ---------------------------------------------------------------------------------------------
// Geometry and render list
// ---------------------------------------------------------------------------------------------

function _rot(x, y, cx, cy, a) {
    if (!a) return [x, y]
    var c = Math.cos(a), s = Math.sin(a), dx = x - cx, dy = y - cy
    return [cx + dx * c - dy * s, cy + dx * s + dy * c]
}

function _pointsBounds(pts) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (var i = 0; i < pts.length; i++) {
        var p = pts[i]
        if (p[0] < minX) minX = p[0]
        if (p[1] < minY) minY = p[1]
        if (p[0] > maxX) maxX = p[0]
        if (p[1] > maxY) maxY = p[1]
    }
    if (minX === Infinity) return [0, 0, 0, 0]
    return [minX, minY, maxX, maxY]
}

// Excalidraw-style element bounds [x1, y1, x2, y2] in scene coordinates, rotation included
// (rotated points for freedraw/linear elements, rotated corners for boxes). No stroke padding.
function elementBounds(el) {
    var a = el.angle || 0
    if (el.points && el.points.length && (el.type === "freedraw" || el.type === "line" || el.type === "arrow")) {
        var b = _pointsBounds(el.points)
        var cx = el.x + (b[0] + b[2]) / 2, cy = el.y + (b[1] + b[3]) / 2
        if (!a) return [el.x + b[0], el.y + b[1], el.x + b[2], el.y + b[3]]
        var rp = el.points.map(function (p) { return _rot(el.x + p[0], el.y + p[1], cx, cy, a) })
        return _pointsBounds(rp)
    }
    var w = el.width || 0, h = el.height || 0
    var c2x = el.x + w / 2, c2y = el.y + h / 2
    var corners = [[el.x, el.y], [el.x + w, el.y], [el.x + w, el.y + h], [el.x, el.y + h]]
    if (el.type === "diamond" || el.type === "ellipse") corners = [[c2x, el.y], [el.x + w, c2y], [c2x, el.y + h], [el.x, c2y]]
    if (el.type === "ellipse" && a) {
        // exact extent of a rotated ellipse
        var rx = w / 2, ry = h / 2, c = Math.cos(a), s = Math.sin(a)
        var hw = Math.sqrt(rx * rx * c * c + ry * ry * s * s), hh = Math.sqrt(rx * rx * s * s + ry * ry * c * c)
        return [c2x - hw, c2y - hh, c2x + hw, c2y + hh]
    }
    if (el.type === "ellipse") return [el.x, el.y, el.x + w, el.y + h]
    return _pointsBounds(corners.map(function (p) { return _rot(p[0], p[1], c2x, c2y, a) }))
}

function _polyPath(pts, close) {
    if (!pts.length) return ""
    var s = "M " + _n(pts[0][0]) + "," + _n(pts[0][1])
    for (var i = 1; i < pts.length; i++) s += " L " + _n(pts[i][0]) + "," + _n(pts[i][1])
    return close ? s + " Z" : s
}

// Catmull-Rom spline through the points as cubic Béziers (rough.js `curve` without roughness).
function _curvePath(pts) {
    if (pts.length < 3) return _polyPath(pts, false)
    var s = "M " + _n(pts[0][0]) + "," + _n(pts[0][1])
    for (var i = 0; i < pts.length - 1; i++) {
        var p0 = pts[i > 0 ? i - 1 : 0], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2 < pts.length ? i + 2 : i + 1]
        var b1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
        var b2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
        s += " C " + _n(b1[0]) + "," + _n(b1[1]) + " " + _n(b2[0]) + "," + _n(b2[1]) + " " + _n(p2[0]) + "," + _n(p2[1])
    }
    return s
}

function _cornerRadius(x, el) {
    var r = el.roundness
    if (!r) return 0
    if (r.type === 1 || r.type === 2) return x * 0.25
    var fixed = r.value !== undefined && r.value !== null ? r.value : 32
    var cutoff = fixed / 0.25
    return x <= cutoff ? x * 0.25 : fixed
}

function _boxPath(el, a, cx, cy) {
    var x = el.x, y = el.y, w = el.width || 0, h = el.height || 0
    function P(px, py) { var q = _rot(px, py, cx, cy, a); return _n(q[0]) + "," + _n(q[1]) }
    if (el.type === "ellipse") {
        // 4 cubic arcs
        var k = 0.5522847498, rx = w / 2, ry = h / 2, ex = x + rx, ey = y + ry
        return "M " + P(ex + rx, ey)
            + " C " + P(ex + rx, ey + ry * k) + " " + P(ex + rx * k, ey + ry) + " " + P(ex, ey + ry)
            + " C " + P(ex - rx * k, ey + ry) + " " + P(ex - rx, ey + ry * k) + " " + P(ex - rx, ey)
            + " C " + P(ex - rx, ey - ry * k) + " " + P(ex - rx * k, ey - ry) + " " + P(ex, ey - ry)
            + " C " + P(ex + rx * k, ey - ry) + " " + P(ex + rx, ey - ry * k) + " " + P(ex + rx, ey) + " Z"
    }
    if (el.type === "diamond") {
        return "M " + P(x + w / 2, y) + " L " + P(x + w, y + h / 2) + " L " + P(x + w / 2, y + h) + " L " + P(x, y + h / 2) + " Z"
    }
    var r = Math.min(_cornerRadius(Math.min(w, h), el), w / 2, h / 2)
    if (r <= 0) return "M " + P(x, y) + " L " + P(x + w, y) + " L " + P(x + w, y + h) + " L " + P(x, y + h) + " Z"
    return "M " + P(x + r, y) + " L " + P(x + w - r, y) + " Q " + P(x + w, y) + " " + P(x + w, y + r)
        + " L " + P(x + w, y + h - r) + " Q " + P(x + w, y + h) + " " + P(x + w - r, y + h)
        + " L " + P(x + r, y + h) + " Q " + P(x, y + h) + " " + P(x, y + h - r)
        + " L " + P(x, y + r) + " Q " + P(x, y) + " " + P(x + r, y) + " Z"
}

function _arrowheadOps(head, tip, from, strokeWidth, color, opacity, ops) {
    if (!head) return
    var dx = tip[0] - from[0], dy = tip[1] - from[1]
    var len = Math.hypot(dx, dy)
    if (!len) return
    var ux = dx / len, uy = dy / len
    var size = head === "bar" ? 15 : (head === "dot" || head === "circle" || head === "circle_outline") ? 15 : 25
    var mult = head === "diamond" || head === "diamond_outline" ? 0.25 : 0.5
    size = Math.min(size, len * mult)
    var ang = (head === "bar" ? 90 : head === "arrow" ? 20 : 25) * Math.PI / 180
    function side(sign) {
        var c = Math.cos(sign * ang), s = Math.sin(sign * ang)
        var bx = -ux * c + uy * s, by = -ux * s - uy * c
        return [tip[0] + bx * size, tip[1] + by * size]
    }
    if (head === "bar") {
        var p1 = [tip[0] - uy * size / 2, tip[1] + ux * size / 2], p2 = [tip[0] + uy * size / 2, tip[1] - ux * size / 2]
        ops.push({ kind: "stroke", d: _polyPath([p1, p2], false), color: color, width: strokeWidth, opacity: opacity })
    } else if (head === "dot" || head === "circle" || head === "circle_outline") {
        var r = size / 2, cx = tip[0] - ux * r, cy = tip[1] - uy * r
        var circ = _boxPath({ type: "ellipse", x: cx - r, y: cy - r, width: 2 * r, height: 2 * r }, 0, 0, 0)
        if (head !== "circle_outline") ops.push({ kind: "fill", d: circ, color: color, opacity: opacity })
        ops.push({ kind: "stroke", d: circ, color: color, width: strokeWidth, opacity: opacity })
    } else if (head === "triangle" || head === "triangle_outline" || head === "diamond" || head === "diamond_outline") {
        var tri = _polyPath([tip, side(1), side(-1)], true)
        if (head === "triangle" || head === "diamond") ops.push({ kind: "fill", d: tri, color: color, opacity: opacity })
        ops.push({ kind: "stroke", d: tri, color: color, width: strokeWidth, opacity: opacity })
    } else {
        ops.push({ kind: "stroke", d: _polyPath([side(1), tip, side(-1)], false), color: color, width: strokeWidth, opacity: opacity })
    }
}

function _fillOps(d, el, ops, box) {
    if (!el.backgroundColor || el.backgroundColor === "transparent") return
    var op = el.opacity === undefined ? 1 : el.opacity / 100
    if (el.fillStyle === "hachure" || el.fillStyle === "cross-hatch" || el.fillStyle === "zigzag") {
        var sw = el.strokeWidth || 1
        ops.push({ kind: "hachure", d: d, color: el.backgroundColor, opacity: op, width: sw / 2, gap: sw * 4,
            angles: el.fillStyle === "cross-hatch" ? [-41, 49] : [-41], box: box })
    } else {
        ops.push({ kind: "fill", d: d, color: el.backgroundColor, opacity: op })
    }
}

var HAND_FONTS = { 1: true, 5: true, 8: true }

// Scene geometry (colour-independent), memoised on the scene object (non-enumerable).
function _geometry(scene) {
    if (scene.__recallGeometry) return scene.__recallGeometry
    var ops = []
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    function grow(b, pad) {
        pad = pad || 0
        if (b[0] - pad < minX) minX = b[0] - pad
        if (b[1] - pad < minY) minY = b[1] - pad
        if (b[2] + pad > maxX) maxX = b[2] + pad
        if (b[3] + pad > maxY) maxY = b[3] + pad
    }
    var els = scene.elements || []
    var strokes = 0
    for (var i = 0; i < els.length; i++) {
        var el = els[i]
        if (!el || el.isDeleted || el.opacity === 0) continue
        var a = el.angle || 0
        var opacity = el.opacity === undefined ? 1 : el.opacity / 100
        var sw = el.strokeWidth || 1
        if (el.type === "freedraw") {
            var pts = el.points || []
            var pb = _pointsBounds(pts.length ? pts : [[0, 0]])
            var cx = el.x + (pb[0] + pb[2]) / 2, cy = el.y + (pb[1] + pb[3]) / 2
            var outline = freedrawOutline(el)
            var odx = el.x, ody = el.y
            if (a) {
                for (var q = 0; q < outline.length; q++) outline[q] = _rot(el.x + outline[q][0], el.y + outline[q][1], cx, cy, a)
                odx = 0
                ody = 0
            }
            var ob = [Infinity, Infinity, -Infinity, -Infinity]
            for (var q2 = 0; q2 < outline.length; q2++) {
                var ox = outline[q2][0] + odx, oy = outline[q2][1] + ody
                if (ox < ob[0]) ob[0] = ox
                if (oy < ob[1]) ob[1] = oy
                if (ox > ob[2]) ob[2] = ox
                if (oy > ob[3]) ob[3] = oy
            }
            if (!outline.length) ob = [el.x, el.y, el.x, el.y]
            if (pts.length >= 3 && el.backgroundColor && el.backgroundColor !== "transparent") {
                var f = pts[0], l = pts[pts.length - 1]
                if (Math.hypot(f[0] - l[0], f[1] - l[1]) <= 8) {
                    var poly = pts.map(function (p) { return _rot(el.x + p[0], el.y + p[1], cx, cy, a) })
                    _fillOps(_curvePath(poly) + " Z", el, ops, _pointsBounds(poly))
                }
            }
            ops.push({ kind: "fill", d: outlineToSvgPath(outline, odx, ody), color: el.strokeColor, opacity: opacity, bounds: ob, ink: true })
            grow(ob)
            strokes++
        } else if (el.type === "line" || el.type === "arrow") {
            var lp = el.points || []
            if (!lp.length) continue
            var lb = _pointsBounds(lp)
            var lcx = el.x + (lb[0] + lb[2]) / 2, lcy = el.y + (lb[1] + lb[3]) / 2
            var absl = lp.map(function (p) { return _rot(el.x + p[0], el.y + p[1], lcx, lcy, a) })
            var curved = !!el.roundness && el.elbowed !== true
            var d = curved ? _curvePath(absl) : _polyPath(absl, false)
            if (el.type === "line" && el.polygon) _fillOps(d + " Z", el, ops, _pointsBounds(absl))
            ops.push({ kind: "stroke", d: d, color: el.strokeColor, width: sw, opacity: opacity, dash: el.strokeStyle, ink: true })
            if (absl.length >= 2) {
                _arrowheadOps(el.endArrowhead, absl[absl.length - 1], absl[absl.length - 2], sw, el.strokeColor, opacity, ops)
                _arrowheadOps(el.startArrowhead, absl[0], absl[1], sw, el.strokeColor, opacity, ops)
            }
            grow(_pointsBounds(absl), sw + (el.endArrowhead || el.startArrowhead ? 12 : 0))
        } else if (el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond" || el.type === "frame" || el.type === "magicframe") {
            var bcx = el.x + (el.width || 0) / 2, bcy = el.y + (el.height || 0) / 2
            var bd = _boxPath(el.type === "frame" || el.type === "magicframe" ? { type: "rectangle", x: el.x, y: el.y, width: el.width, height: el.height } : el, a, bcx, bcy)
            var ebx = elementBounds(el)
            _fillOps(bd, el, ops, ebx)
            ops.push({ kind: "stroke", d: bd, color: el.strokeColor, width: sw, opacity: opacity, dash: el.strokeStyle, ink: true })
            grow(ebx, sw / 2)
        } else if (el.type === "text") {
            var txt = String(el.text !== undefined ? el.text : (el.originalText || ""))
            var fs = el.fontSize || 20
            var lh = (el.lineHeight || 1.25) * fs
            ops.push({ kind: "text", lines: txt.split("\n"), x: el.x, y: el.y, width: el.width || 0, height: el.height || 0,
                fontSize: fs, lineHeight: lh, fontFamily: el.fontFamily || 1,
                font: HAND_FONTS[el.fontFamily] ? "hand" : (el.fontFamily === 3 ? "mono" : "sans"),
                align: el.textAlign || "left", angle: a, cx: el.x + (el.width || 0) / 2, cy: el.y + (el.height || 0) / 2,
                color: el.strokeColor, opacity: opacity, ink: true })
            grow(elementBounds(el))
        } else if (el.type === "image") {
            var emb = (scene.embedded || {})[el.fileId] || {}
            var file = (scene.files || {})[el.fileId] || {}
            ops.push({ kind: "image", x: el.x, y: el.y, width: el.width || 0, height: el.height || 0, angle: a,
                cx: el.x + (el.width || 0) / 2, cy: el.y + (el.height || 0) / 2, fileId: el.fileId || "",
                link: emb.link || "", url: emb.url || "", dataURL: file.dataURL || "", scale: el.scale || [1, 1],
                crop: el.crop || null, opacity: opacity })
            grow(elementBounds(el))
        } else if (el.type === "embeddable" || el.type === "iframe") {
            var ecx = el.x + (el.width || 0) / 2, ecy = el.y + (el.height || 0) / 2
            var ed = _boxPath({ type: "rectangle", x: el.x, y: el.y, width: el.width, height: el.height, roundness: el.roundness }, a, ecx, ecy)
            ops.push({ kind: "stroke", d: ed, color: "#868e96", width: 2, opacity: opacity, dash: "dashed" })
            ops.push({ kind: "text", lines: [String(el.link || "embedded content")], x: el.x + 10, y: el.y + 10,
                width: (el.width || 0) - 20, height: 25, fontSize: 20, lineHeight: 25, fontFamily: 2, font: "sans",
                align: "left", angle: a, cx: ecx, cy: ecy, color: "#868e96", opacity: opacity })
            grow(elementBounds(el))
        }
    }
    var g = {
        ops: ops,
        strokes: strokes,
        bounds: minX === Infinity ? { x: 0, y: 0, width: 0, height: 0 } : { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    }
    try {
        Object.defineProperty(scene, "__recallGeometry", { value: g, enumerable: false, configurable: true, writable: true })
    } catch (e) {
        // frozen scene: no memo
    }
    return g
}

// Draw ops for a scene ({elements, files?, embedded?}) in scene coordinates, back to front.
// opts: {dark, foreground}. → {ops, bounds: {x, y, width, height}, strokes}
// Op kinds: fill {d, color, opacity}; stroke {d, color, width, opacity, dash};
// hachure {d (clip), color, opacity, width, gap, angles, box}; text {lines, x, y, width, fontSize,
// lineHeight, font: hand|sans|mono, align, angle, cx, cy, color, opacity};
// image {x, y, width, height, angle, cx, cy, fileId, link, url, dataURL, opacity}.
function renderList(scene, opts) {
    opts = opts || {}
    var g = _geometry(scene)
    var out = new Array(g.ops.length)
    for (var i = 0; i < g.ops.length; i++) {
        var op = g.ops[i]
        if (op.color === undefined) { out[i] = op; continue }
        var c = {}
        for (var k in op) c[k] = op[k]
        c.color = op.ink ? mapColor(op.color, opts) : (opts.dark ? darkColor(op.color) : op.color)
        out[i] = c
    }
    return { ops: out, bounds: g.bounds, strokes: g.strokes }
}

function sceneBounds(scene) {
    return _geometry(scene).bounds
}

// ---------------------------------------------------------------------------------------------
// Decoded-scene cache shared by every Drawing (one library instance per QML engine)
// ---------------------------------------------------------------------------------------------

var _cache = []
var CACHE_SIZE = 32

function _hash(s) {
    var h = 2166136261
    for (var i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = (h * 16777619) >>> 0
    }
    return h
}

// decodeFile with an LRU cache keyed by `key` (e.g. the file path) and the text's hash.
function sceneFromText(text, key) {
    var h = _hash(text) + ":" + text.length
    for (var i = 0; i < _cache.length; i++) {
        if (_cache[i].key === key && _cache[i].hash === h) {
            var hit = _cache.splice(i, 1)[0]
            _cache.unshift(hit)
            return hit.scene
        }
    }
    var scene = decodeFile(text)
    _cache.unshift({ key: key, hash: h, scene: scene })
    if (_cache.length > CACHE_SIZE) _cache.pop()
    return scene
}

// ---------------------------------------------------------------------------------------------
// Painting (Qt Quick Canvas Context2D; uses Qt's `ctx.path = "<svg path>"`)
// ---------------------------------------------------------------------------------------------

function _hachurePath(box, angleDeg, gap) {
    var a = angleDeg * Math.PI / 180
    var dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx
    var corners = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]]
    var nmin = Infinity, nmax = -Infinity, dmin = Infinity, dmax = -Infinity
    for (var i = 0; i < 4; i++) {
        var pn = corners[i][0] * nx + corners[i][1] * ny, pd = corners[i][0] * dx + corners[i][1] * dy
        if (pn < nmin) nmin = pn
        if (pn > nmax) nmax = pn
        if (pd < dmin) dmin = pd
        if (pd > dmax) dmax = pd
    }
    var parts = []
    for (var t = nmin + gap / 2; t < nmax; t += gap) {
        parts.push("M " + _n(nx * t + dx * dmin) + "," + _n(ny * t + dy * dmin) + " L " + _n(nx * t + dx * dmax) + "," + _n(ny * t + dy * dmax))
    }
    return parts.join(" ")
}

// Draws render-list ops onto a Canvas 2D context (transform set by the caller).
// opts: {fonts: {hand, sans, mono}, imageUrl: function(op) → loaded image url or ""}
function paintOps(ctx, ops, opts) {
    opts = opts || {}
    var fonts = opts.fonts || {}
    for (var i = 0; i < ops.length; i++) {
        var op = ops[i]
        ctx.globalAlpha = op.opacity === undefined ? 1 : op.opacity
        if (op.kind === "fill") {
            if (op.color === "transparent") continue
            ctx.fillStyle = op.color
            ctx.path = op.d
            ctx.fill()
        } else if (op.kind === "stroke") {
            if (op.color === "transparent") continue
            ctx.strokeStyle = op.color
            ctx.lineWidth = op.width
            ctx.lineCap = "round"
            ctx.lineJoin = "round"
            if (op.dash === "dashed") ctx.setLineDash([8 / op.width, (8 + op.width) / op.width])
            else if (op.dash === "dotted") ctx.setLineDash([1.5 / op.width, (6 + op.width) / op.width])
            ctx.path = op.d
            ctx.stroke()
            if (op.dash === "dashed" || op.dash === "dotted") ctx.setLineDash([])
        } else if (op.kind === "hachure") {
            if (op.color === "transparent" || !op.box) continue
            ctx.save()
            ctx.path = op.d
            ctx.clip()
            ctx.strokeStyle = op.color
            ctx.lineWidth = op.width
            ctx.lineCap = "round"
            for (var h = 0; h < op.angles.length; h++) {
                ctx.path = _hachurePath(op.box, op.angles[h], op.gap)
                ctx.stroke()
            }
            ctx.restore()
        } else if (op.kind === "text") {
            if (op.color === "transparent") continue
            ctx.save()
            if (op.angle) {
                ctx.translate(op.cx, op.cy)
                ctx.rotate(op.angle)
                ctx.translate(-op.cx, -op.cy)
            }
            var fam = fonts[op.font] || (op.font === "mono" ? "monospace" : "sans-serif")
            ctx.font = _n(op.fontSize) + "px \"" + fam + "\""
            ctx.fillStyle = op.color
            ctx.textAlign = op.align === "center" ? "center" : op.align === "right" ? "right" : "left"
            ctx.textBaseline = "middle"
            var tx = op.align === "center" ? op.x + op.width / 2 : op.align === "right" ? op.x + op.width : op.x
            for (var l = 0; l < op.lines.length; l++) ctx.fillText(op.lines[l], tx, op.y + l * op.lineHeight + op.lineHeight / 2)
            ctx.restore()
        } else if (op.kind === "image") {
            var url = opts.imageUrl ? opts.imageUrl(op) : ""
            ctx.save()
            if (op.angle) {
                ctx.translate(op.cx, op.cy)
                ctx.rotate(op.angle)
                ctx.translate(-op.cx, -op.cy)
            }
            if (url) {
                var sx = op.scale && op.scale[0] < 0 ? -1 : 1, sy = op.scale && op.scale[1] < 0 ? -1 : 1
                if (sx < 0 || sy < 0) {
                    ctx.translate(op.cx, op.cy)
                    ctx.scale(sx, sy)
                    ctx.translate(-op.cx, -op.cy)
                }
                ctx.drawImage(url, op.x, op.y, op.width, op.height)
            } else {
                ctx.globalAlpha = 0.5
                ctx.strokeStyle = "#868e96"
                ctx.lineWidth = 2
                ctx.setLineDash([4, 4])
                ctx.strokeRect(op.x, op.y, op.width, op.height)
                ctx.setLineDash([])
            }
            ctx.restore()
        }
    }
    ctx.globalAlpha = 1
}

// file:// URL for an absolute path (spaces, diacritics, # and ? safe).
function fileUrl(path) {
    if (!path) return ""
    if (/^[a-z]+:\/\//i.test(path)) return path
    return "file://" + encodeURI(path).replace(/#/g, "%23").replace(/\?/g, "%3F")
}
