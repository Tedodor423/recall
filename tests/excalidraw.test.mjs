// node --test tests/excalidraw.test.mjs
// Runs on the committed synthetic drawings in tests/fixtures/vault. With
// RECALL_TEST_VAULT=<vault> it also runs on that vault's drawings (read-only).
// Writes only to a temp dir under os.tmpdir(). RECALL_FREEHAND_SKIP="Prefix,..."
// leaves drawings with those name prefixes out of the perfect-freehand comparison.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadQmlJs, FIXTURE_VAULT, REAL_VAULT } from "./load.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const X = loadQmlJs("engine/Excalidraw.js", [
  "compressToBase64", "decompressFromBase64", "isDrawingFile", "decodeFile", "encodeFile", "FILE_HEAD",
  "defaultAppState", "SOURCE_URL", "getStroke", "getStrokePoints", "getStrokeOutlinePoints", "freedrawOutline",
  "freedrawStrokeOptions", "strokeOutline", "outlineToSvgPath", "renderList", "sceneBounds", "elementBounds",
  "darkColor", "mapColor", "parseColor", "newFreedrawElement", "nextIndexKey", "randomId", "sceneFromText",
])

const FIXTURE_DRAWINGS = join(FIXTURE_VAULT, "Files", "excalidraw")
const FIXTURE_NOTE = join(FIXTURE_VAULT, "Notes", "Biology flashnotes.md")
// In the fixtures: a drawing with text and embedded images, and its embed ids.
const RICH_DRAWING = "Biology flashnotes 202601151030.md"
const LINKED_ID = "aaaa1111bbbb2222cccc3333dddd4444eeee5555", WEB_ID = "ffff6666aaaa7777bbbb8888cccc9999dddd0000"
const LINKED_IMAGE = "Pasted image 20260101120000.png"
// The properties of a freedraw element written by the Obsidian Excalidraw plugin 2.23.0.
const FREEDRAW_KEYS = ["angle", "backgroundColor", "boundElements", "fillStyle", "frameId", "groupIds", "height", "id", "index",
  "isDeleted", "link", "locked", "opacity", "points", "pressures", "roughness", "roundness", "seed", "simulatePressure",
  "strokeColor", "strokeStyle", "strokeWidth", "type", "updated", "version", "versionNonce", "width", "x", "y"]

function realDrawingFolder() {
  if (!REAL_VAULT) return ""
  const p = join(REAL_VAULT, ".obsidian", "plugins", "obsidian-excalidraw-plugin", "data.json")
  const folder = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")).folder : ""
  return join(REAL_VAULT, folder || "Excalidraw")
}
const REAL = realDrawingFolder()
const PLUGIN_MAIN = REAL_VAULT ? join(REAL_VAULT, ".obsidian", "plugins", "obsidian-excalidraw-plugin", "main.js") : ""
const REF = join(here, "excalidraw_ref.py")
const haveReal = !!REAL && existsSync(REAL)
if (!REAL_VAULT) console.log("# RECALL_TEST_VAULT not set: testing the committed fixture drawings only")

function drawingFiles(dir) {
  return readdirSync(dir).filter((n) => n.endsWith(".md")).sort().map((n) => ({ name: n, path: join(dir, n) }))
}
const textsOf = (dir) => new Map(drawingFiles(dir).map((f) => [f.name, readFileSync(f.path, "utf8")]))
const fixtureTexts = textsOf(FIXTURE_DRAWINGS)
const realTexts = haveReal ? textsOf(REAL) : new Map()
const allTexts = new Map([...fixtureTexts, ...realTexts])
const live = (els) => els.filter((e) => !e.isDeleted)

function pyDecode(path) {
  const buf = execFileSync("python3", ["-I", REF, "decode", path], { maxBuffer: 1 << 30 })
  return buf.toString("utf16le")
}

test("lz-string round trip", () => {
  const samples = ["", "a", "aaaaaaaaaaaaaaaaaaaaaaa", "hello world ".repeat(50), "příliš žluťoučký kůň úpěl ďábelské ódy",
    "emoji 😀🎉 and \u{1F9EC} DNA", "__proto__ constructor toString hasOwnProperty __proto__",
    JSON.stringify({ a: [1, 2, 3], b: "x".repeat(1000) }, null, "\t")]
  let rnd = 12345
  let s = ""
  for (let i = 0; i < 20000; i++) { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; s += String.fromCharCode(rnd % 300 + 10) }
  samples.push(s)
  for (const x of samples) {
    const c = X.compressToBase64(x)
    assert.match(c, /^[A-Za-z0-9+/=]*$/)
    assert.equal(c.length % 4, 0)
    assert.equal(X.decompressFromBase64(c), x)
  }
})

test("re-compressing compressed drawings reproduces the exact bytes", () => {
  let n = 0
  for (const [name, text] of allTexts) {
    const m = /```compressed-json\n([\s\S]*?)\n```/.exec(text)
    if (!m) continue
    const json = X.decompressFromBase64(m[1].replace(/\s/g, ""))
    assert.ok(json && json.startsWith("{"), name)
    const packed = X.compressToBase64(json)
    const chunks = []
    for (let i = 0; i < packed.length; i += 256) chunks.push(packed.slice(i, i + 256))
    assert.equal(chunks.join("\n\n"), m[1], name)
    n++
  }
  assert.ok(n >= 1, `only ${n} compressed files`)
})

test("decodes every drawing; element counts match the Python census", () => {
  let files = 0, freedraw = 0
  const totals = {}
  for (const dir of haveReal ? [FIXTURE_DRAWINGS, REAL] : [FIXTURE_DRAWINGS]) {
    const census = JSON.parse(execFileSync("python3", ["-I", REF, "census", dir], { maxBuffer: 1 << 28 }).toString())
    const texts = textsOf(dir)
    assert.equal(texts.size, Object.keys(census).length)
    for (const [name, text] of texts) {
      assert.ok(X.isDrawingFile(text), `isDrawingFile ${name}`)
      const s = X.decodeFile(text)
      assert.equal(s.error, "", `${name}: ${s.error}`)
      const counts = {}
      for (const el of live(s.elements)) counts[el.type] = (counts[el.type] || 0) + 1
      assert.deepEqual(counts, census[name], name)
      for (const [k, v] of Object.entries(counts)) totals[k] = (totals[k] || 0) + v
      freedraw += counts.freedraw || 0
      files++
    }
  }
  assert.ok(freedraw > 0, `freedraw ${freedraw}`)
  console.log(`  ${files} drawings, live element types:`, JSON.stringify(totals))
})

test("decodes the embedded-file section", () => {
  const s = X.decodeFile(fixtureTexts.get(RICH_DRAWING))
  assert.equal(s.error, "")
  assert.deepEqual(s.embedded[LINKED_ID], { link: LINKED_IMAGE })
  assert.match(s.embedded[WEB_ID].url, /^https:\/\/example\.com\//)
})

test("not a drawing: a flashcard note, garbage", () => {
  assert.equal(X.isDrawingFile(readFileSync(FIXTURE_NOTE, "utf8")), false)
  assert.equal(X.isDrawingFile(""), false)
  assert.notEqual(X.decodeFile("hello").error, "")
  assert.notEqual(X.decodeFile("## Drawing\n```compressed-json\n!!!!\n```\n%%").error, "")
})

test("encode → decode round trip on every drawing (compressed and json)", () => {
  for (const [name, text] of allTexts) {
    const s = X.decodeFile(text)
    const embedded = s.embedded
    for (const compress of [true, false]) {
      const out = X.encodeFile(s.elements, { compress, appState: s.appState, mergeAppState: false, files: s.files, source: s.source, embedded })
      const back = X.decodeFile(out)
      assert.equal(back.error, "", name)
      assert.equal(back.compressed, compress)
      assert.equal(JSON.stringify(back.elements), JSON.stringify(s.elements), name)
      assert.equal(JSON.stringify(back.appState), JSON.stringify(s.appState), name)
      assert.deepEqual(back.embedded, embedded, name)
    }
  }
})

test("files in the plugin 2.23.0 format re-encode byte-identically", () => {
  let n = 0
  for (const [name, text] of allTexts) {
    if (!text.startsWith(X.FILE_HEAD) || !/```compressed-json/.test(text)) continue
    const s = X.decodeFile(text)
    if (!s.source.endsWith("/2.23.0") || Object.keys(s.embedded).length) continue
    const out = X.encodeFile(s.elements, { appState: s.appState, mergeAppState: false, files: s.files, source: s.source })
    assert.equal(out, text, name)
    n++
  }
  assert.ok(n >= 1, `only ${n} files checked`)
  console.log(`  ${n} files byte-identical`)
})

test("our compressed output decodes with the independent Python decompressor", () => {
  const dir = mkdtempSync(join(tmpdir(), "recall-excalidraw-"))
  try {
    const scenes = []
    let idx = "a0"
    const els = []
    for (let k = 0; k < 40; k++) {
      const pts = [], pr = []
      for (let i = 0; i < 60; i++) { pts.push([100 + k * 7 + i * 1.37, 200 + Math.sin(i / 5 + k) * 30]); pr.push(0.3 + 0.5 * Math.sin(i / 20)) }
      pr[pr.length - 1] = 0
      els.push(X.newFreedrawElement(pts, pr, { strokeColor: k % 2 ? "#1971c2" : "#1e1e1e", strokeWidth: k % 3 ? 1 : 2, index: idx }))
      idx = X.nextIndexKey(idx)
    }
    scenes.push({ name: "synthetic", elements: els, opts: {} })
    for (const [name, text] of [...fixtureTexts, ...[...realTexts].slice(0, 4)]) {
      const s = X.decodeFile(text)
      scenes.push({ name, elements: s.elements, opts: { appState: s.appState, mergeAppState: false, embedded: s.embedded } })
    }
    for (const sc of scenes) {
      const file = join(dir, "x.md")
      const text = X.encodeFile(sc.elements, sc.opts)
      writeFileSync(file, text)
      const py = pyDecode(file)
      const m = /```compressed-json\n([\s\S]*?)\n```/.exec(text)
      assert.equal(py, X.decompressFromBase64(m[1].replace(/\s/g, "")), sc.name)
      assert.equal(JSON.stringify(JSON.parse(py).elements), JSON.stringify(sc.elements), sc.name)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Loads perfect-freehand's getStroke exactly as bundled by the vault's Excalidraw plugin.
function bundledGetStroke() {
  if (!PLUGIN_MAIN || !existsSync(PLUGIN_MAIN)) return null
  const src = readFileSync(PLUGIN_MAIN, "utf8")
  const a = src.indexOf("var LZString=function(){")
  const lz = new Function(src.slice(a, src.indexOf("}();", a) + 4) + ";return LZString")()
  const key = 'const unpackExcalidraw = () => LZString.decompressFromBase64("'
  const i = src.indexOf(key)
  if (i < 0) return null
  const pkg = lz.decompressFromBase64(src.slice(i + key.length, src.indexOf('"', i + key.length)))
  const anchor = pkg.indexOf("function U(A,e,t,i=A=>A){return A*i(.5-e*(.5-t))}")
  if (anchor < 0) return null
  const start = pkg.lastIndexOf("=>{", anchor) + 3
  const tail = "return w.concat(g,f.reverse(),s)}}"
  const end = pkg.indexOf(tail, anchor) + tail.length
  const body = pkg.slice(start, end)
  const exportsObj = {}
  const req = { d: (ex, defs) => { for (const k in defs) Object.defineProperty(ex, k, { get: defs[k], enumerable: true }) } }
  new Function("A", "e", "t", body)(undefined, exportsObj, req)
  return exportsObj.$4
}

test("perfect-freehand port is identical to the getStroke bundled in the Excalidraw plugin", { skip: !haveReal || !existsSync(PLUGIN_MAIN) }, () => {
  const skipPrefixes = (process.env.RECALL_FREEHAND_SKIP || "").split(",").filter(Boolean)
  const ref = bundledGetStroke()
  assert.ok(ref, "could not extract bundled getStroke")
  // Excalidraw's getFreedrawOutlinePoints, verbatim semantics
  const exOutline = (el) => {
    const input = el.simulatePressure ? el.points : el.points.length ? el.points.map(([x, y], i) => [x, y, el.pressures[i]]) : [[0, 0, 0.5]]
    return ref(input, { simulatePressure: el.simulatePressure, size: el.strokeWidth * 4.25, thinning: 0.6, smoothing: 0.5,
      streamline: 0.5, easing: (t) => Math.sin(t * Math.PI / 2), last: true })
  }
  let n = 0, sim = 0
  for (const [name, text] of realTexts) {
    if (skipPrefixes.some((p) => name.startsWith(p))) continue
    for (const el of live(X.decodeFile(text).elements)) {
      if (el.type !== "freedraw") continue
      assert.deepEqual(X.freedrawOutline(el), exOutline(el), `${name} ${el.id}`)
      n++
      if (el.simulatePressure) sim++
    }
  }
  // edge cases: 1 point, 2 points, duplicates, sharp corners, taper/cap options
  const cases = [[[0, 0]], [[0, 0], [10, 0]], [[5, 5], [5, 5], [5, 5]], [[0, 0], [50, 0], [0, 1], [50, 2], [0, 3]],
    Array.from({ length: 30 }, (_, i) => [i * 3, (i % 7) * 5, (i % 4) / 4])]
  const variants = [{}, { last: true }, { start: { taper: 20 }, end: { taper: true } }, { start: { cap: false }, end: { cap: false } },
    { thinning: 0 }, { simulatePressure: false, size: 8 }]
  for (const pts of cases) for (const o of variants) assert.deepEqual(X.getStroke(pts, o), ref(pts, o))
  assert.ok(n > 0, `compared ${n} strokes (${sim} simulated)`)
  console.log(`  ${n} real strokes identical (${sim} with simulated pressure)`)
})

test("strokeOutline and SVG path", () => {
  const pts = [[0, 0], [10, 2], [20, 8], [30, 20]]
  const o = X.strokeOutline(pts, [0.2, 0.5, 0.7, 0], { strokeWidth: 2 })
  const el = { points: pts, pressures: [0.2, 0.5, 0.7, 0], simulatePressure: false, strokeWidth: 2 }
  assert.deepEqual(o, X.freedrawOutline(el))
  assert.ok(o.length > 20)
  const d = X.outlineToSvgPath(o, 5, 5)
  assert.match(d, /^M [-\d.]+ [-\d.]+ Q /)
  assert.match(d, / L [-\d.]+ [-\d.]+ Z$/)
  // a single point still gives a closed dot outline around it
  const dot = X.strokeOutline([[3, 3]], null, {})
  assert.ok(dot.length > 10 && dot.every((p) => Math.hypot(p[0] - 3.5, p[1] - 3.5) < 5))
})

test("new freedraw elements carry exactly the property set of the plugin's elements", () => {
  const el = X.newFreedrawElement([[10, 20], [12, 25], [8, 30], [8, 30]], [0.3, 0.5, 0.6, 0], { strokeColor: "#e03131", strokeWidth: 1, index: "a5" })
  assert.deepEqual(Object.keys(el).sort(), FREEDRAW_KEYS)
  // With a real vault: also against a stroke the plugin itself wrote.
  const newest = [...realTexts.values()].map((t) => X.decodeFile(t)).find((s) => s.source.endsWith("/2.23.0") && live(s.elements).some((e) => e.type === "freedraw"))
  if (newest) {
    const real = live(newest.elements).find((e) => e.type === "freedraw")
    assert.deepEqual(Object.keys(real).sort(), FREEDRAW_KEYS)
    for (const k of Object.keys(real)) assert.equal(typeof el[k], typeof real[k], k)
  }
  assert.deepEqual(el.points[0], [0, 0])
  assert.deepEqual(el.points[2], [-2, 10])
  assert.equal(el.x, 10)
  assert.equal(el.width, 4)
  assert.equal(el.height, 10)
  assert.equal(el.simulatePressure, false)
  assert.equal(el.pressures.length, el.points.length)
  assert.equal(el.id.length, 21)
  assert.equal(el.index, "a5")
  const m = X.newFreedrawElement([[0, 0], [5, 5]], null, {})
  assert.equal(m.simulatePressure, true)
  assert.deepEqual(m.pressures, [])
  assert.equal(m.strokeColor, "#1e1e1e")
})

test("fractional index keys", () => {
  const seq = ["a0"]
  for (let i = 0; i < 70; i++) seq.push(X.nextIndexKey(seq[seq.length - 1]))
  assert.equal(seq[10], "aA")
  assert.equal(seq[36], "aa")
  assert.equal(seq[61], "az")
  assert.equal(seq[62], "b00")
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i - 1] < seq[i], `${seq[i - 1]} < ${seq[i]}`)
  assert.equal(X.nextIndexKey("b0z"), "b10")
  assert.equal(X.nextIndexKey("bzz"), "c000")
  assert.equal(X.nextIndexKey("b0W"), "b0X")
  assert.equal(X.nextIndexKey("a1V"), "a2")
  assert.equal(X.nextIndexKey(""), "a0")
})

test("dark theme colour transform = invert(93%) hue-rotate(180deg)", () => {
  assert.equal(X.darkColor("#1e1e1e"), "#d3d3d3")
  assert.equal(X.darkColor("#ffffff"), "#121212")
  assert.equal(X.darkColor("#000"), "#ededed")
  assert.equal(X.darkColor("transparent"), "transparent")
  const blue = X.parseColor(X.darkColor("#1971c2"))
  assert.ok(blue[2] > blue[0] && blue[2] > 150, X.darkColor("#1971c2"))
  const red = X.parseColor(X.darkColor("#e03131"))
  assert.ok(red[0] > red[1] && red[0] > red[2], X.darkColor("#e03131"))
  assert.equal(X.mapColor("#1e1e1e", { dark: true, foreground: "#cdd6f4" }), "#cdd6f4")
  assert.equal(X.mapColor("#e03131", { dark: false, foreground: "#cdd6f4" }), "#e03131")
  assert.equal(X.darkColor("#e0313180").startsWith("rgba("), true)
})

test("renderList: ops, bounds, colours", () => {
  for (const [name, text] of [...fixtureTexts, ...[...realTexts].slice(0, 10)]) {
    const s = X.decodeFile(text)
    if (!live(s.elements).length) continue
    const r = X.renderList(s, {})
    const b = r.bounds
    assert.ok(b.width > 0 && b.height > 0 && Number.isFinite(b.x), name)
    for (const el of live(s.elements)) {
      if (el.opacity === 0) continue
      const eb = X.elementBounds(el)
      // A pen outline can lie slightly inside its raw points (tapered tips), so strokes get their width as slack.
      const tol = el.type === "freedraw" ? (el.strokeWidth || 1) : 0.01
      assert.ok(eb[0] >= b.x - tol && eb[1] >= b.y - tol && eb[2] <= b.x + b.width + tol && eb[3] <= b.y + b.height + tol, `${name} ${el.type} ${el.id}`)
    }
    const kinds = new Set(r.ops.map((o) => o.kind))
    assert.ok(kinds.size >= 1)
    const dark = X.renderList(s, { dark: true })
    assert.equal(dark.ops.length, r.ops.length)
    assert.equal(dark.bounds, r.bounds) // geometry memoised
    const fd = r.ops.findIndex((o) => o.kind === "fill" && o.color === "#1e1e1e")
    if (fd >= 0) assert.equal(dark.ops[fd].color, "#d3d3d3")
  }
  const ops = X.renderList(X.decodeFile(fixtureTexts.get(RICH_DRAWING)), {}).ops
  assert.ok(ops.filter((o) => o.kind === "text").some((t) => t.lines[0] === "Mitochondrion"))
  assert.ok(ops.filter((o) => o.kind === "image").some((o) => o.link === LINKED_IMAGE))
})

test("elementBounds includes rotation", () => {
  const el = { type: "rectangle", x: 0, y: 0, width: 100, height: 20, angle: Math.PI / 2 }
  const b = X.elementBounds(el)
  assert.ok(Math.abs(b[0] - 40) < 1e-9 && Math.abs(b[1] + 40) < 1e-9 && Math.abs(b[2] - 60) < 1e-9 && Math.abs(b[3] - 60) < 1e-9)
  const fd = { type: "freedraw", x: 10, y: 10, points: [[0, 0], [100, 0]], angle: Math.PI / 2 }
  const fb = X.elementBounds(fd)
  assert.ok(Math.abs(fb[0] - 60) < 1e-9 && Math.abs(fb[1] + 40) < 1e-9 && Math.abs(fb[3] - 60) < 1e-9)
})

test("sceneFromText caches by key and content", () => {
  const text = X.encodeFile([X.newFreedrawElement([[0, 0], [10, 10]], [0.5, 0], {})], {})
  const a = X.sceneFromText(text, "k")
  assert.equal(X.sceneFromText(text, "k"), a)
  assert.notEqual(X.sceneFromText(text + " ", "k"), a)
  assert.equal(a.elements.length, 1)
})

const QML = "/usr/lib/qt6/bin/qml"
test("DrawPad export (offscreen tests/drawpad-render.qml) decodes in JS and Python with real-element properties", { skip: !existsSync(QML) }, () => {
  const dir = mkdtempSync(join(tmpdir(), "recall-drawpad-"))
  try {
    const run = spawnSync(QML, [join(here, "drawpad-render.qml"), "--", dir], {
      env: { ...process.env, QT_QPA_PLATFORM: "offscreen", QML_XHR_ALLOW_FILE_WRITE: "1", QT_FORCE_STDERR_LOGGING: "1" },
      timeout: 60000, encoding: "utf8",
    })
    const log = run.stdout + run.stderr
    for (const [file, compressed] of [["drawpad-export.md", true], ["drawpad-export-plain.md", false]]) {
      const text = readFileSync(join(dir, file), "utf8")
      assert.ok(text.startsWith(X.FILE_HEAD), file)
      const s = X.decodeFile(text)
      assert.equal(s.error, "", file)
      assert.equal(s.compressed, compressed)
      assert.equal(s.elements.length, 6, file)
      assert.deepEqual(s.elements.map((e) => e.index), ["a0", "a1", "a2", "a3", "a4", "a5"])
      const pens = s.elements.filter((e) => !e.simulatePressure)
      const mice = s.elements.filter((e) => e.simulatePressure)
      assert.equal(mice.length, 1)
      for (const e of pens) {
        assert.equal(e.pressures.length, e.points.length)
        assert.equal(e.pressures[e.pressures.length - 1], 0) // pen-up pressure, like Excalidraw
        assert.deepEqual(e.points[0], [0, 0])
      }
      assert.deepEqual(mice[0].pressures, [])
      assert.equal(s.appState.theme, "dark")
      assert.equal(s.source, X.SOURCE_URL)
      for (const e of s.elements) assert.deepEqual(Object.keys(e).sort(), FREEDRAW_KEYS)
      const py = JSON.parse(pyDecode(join(dir, file)))
      assert.equal(JSON.stringify(py.elements), JSON.stringify(s.elements), `python ${file}`)
      const r = X.renderList(s, { dark: true })
      assert.equal(r.strokes, 6)
    }
    assert.match(log, /after erase 5/)
    assert.match(log, /undo clear 6/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
