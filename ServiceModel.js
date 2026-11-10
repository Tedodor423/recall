.pragma library

// Pure helpers for Service.qml: config normalisation, popup timing rules,
// target-note planning for new cards, Excalidraw file naming and embed
// resolution. No QML types, so tests/service-model.test.mjs runs them under
// node. Functions that need the engine take it as their first argument.

var DAY_MS = 24 * 3600 * 1000
// "Paused until resumed": the largest valid Date, still plain JSON.
var PAUSE_FOREVER = 8640000000000000
var MODES = ["review", "add", "stats", "settings"]

// ------------------------------------------------------------------ values

function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v) }
function str(v, d) { return typeof v === "string" ? v : d }
function bool(v, d) {
  if (v === true || v === false) return v
  if (v === "true" || v === 1 || v === "1") return true
  if (v === "false" || v === 0 || v === "0") return false
  return d
}
function num(v, d) {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return d
  var n = Number(v)
  return isFinite(n) ? n : d
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)) }
function pad2(n) { return (n < 10 ? "0" : "") + n }

function expandHome(p, home) {
  if (p === "~") return home
  if (p.indexOf("~/") === 0) return home + p.slice(1)
  return p
}

// "#a/b", "a/b", "#a/b/" -> "a/b"
function deckKey(x) { return String(x === undefined || x === null ? "" : x).trim().replace(/^#+/, "").replace(/\/+$/, "").replace(/^\/+/, "") }
function deckTag(x) { var k = deckKey(x); return k ? "#" + k : "" }

// Vault-relative folder: no leading/trailing slashes, no "." / ".." parts.
function cleanFolder(f) {
  var parts = String(f || "").split("/").filter(function(p) { return p !== "" && p !== "." })
  if (parts.some(function(p) { return p === ".." || p[0] === "." })) return ""
  return parts.join("/")
}

function validHHMM(s, d) {
  var m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(s || ""))
  if (!m || +m[1] > 23 || +m[2] > 59) return d
  return pad2(+m[1]) + ":" + m[2]
}

function minutesOf(hhmm) { var p = hhmm.split(":"); return (+p[0]) * 60 + (+p[1]) }

// UTF-8 byte length of a JS string (what the helper receives on stdin; a lone
// surrogate becomes U+FFFD, 3 bytes, the same as Qt's toUtf8()).
function utf8Length(s) {
  s = String(s)
  var n = 0
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xFC00) === 0xDC00) { n += 4; i++ }
    else n += 3
  }
  return n
}

// Change budget for a review write: the edit stays inside the question.
function reviewBudget(original) {
  return clamp(utf8Length(original || "") + 2048, 4096, 65536)
}

// ------------------------------------------------------------------ config

// raw: config.json contents. app: Obsidian app.json (for newNoteFolder).
function normalizeConfig(raw, home, app) {
  raw = isObj(raw) ? raw : {}
  var qh = isObj(raw.quietHours) ? raw.quietHours : {}
  var decks = Array.isArray(raw.decks) ? raw.decks.map(deckKey).filter(function(x) { return x }) : []
  var tags = null
  if (Array.isArray(raw.tags)) {
    tags = raw.tags.map(deckTag).filter(function(x) { return x })
    if (!tags.length) tags = null
  }
  var lnbd = {}
  if (isObj(raw.lastNoteByDeck)) {
    for (var k in raw.lastNoteByDeck) {
      if (typeof raw.lastNoteByDeck[k] === "string" && deckKey(k)) lnbd[deckKey(k)] = raw.lastNoteByDeck[k]
    }
  }
  var appFolder = isObj(app) && typeof app.newFileFolderPath === "string" ? cleanFolder(app.newFileFolderPath) : ""
  var folder = cleanFolder(str(raw.newNoteFolder, ""))
  return {
    vault: expandHome(str(raw.vault, "").trim() || "~/obsidian", home || ""),
    enabled: bool(raw.enabled, true),
    intervalMinutes: clamp(Math.round(num(raw.intervalMinutes, 5)), 1, 1440),
    cardsPerPopup: clamp(Math.round(num(raw.cardsPerPopup, 1)), 1, 100),
    decks: decks,
    tags: tags,
    quietHours: {
      enabled: bool(qh.enabled, false),
      start: validHHMM(qh.start, "22:00"),
      end: validHHMM(qh.end, "08:00")
    },
    skipWhenFullscreen: bool(raw.skipWhenFullscreen, true),
    strict: bool(raw.strict, false),
    lastDeck: deckTag(str(raw.lastDeck, "")),
    lastNoteByDeck: lnbd,
    newNoteFolder: folder || appFolder || "01 - Main",
    pausedUntil: Math.max(0, num(raw.pausedUntil, 0))
  }
}

function validMode(m) { return MODES.indexOf(String(m)) !== -1 ? String(m) : "review" }

// ------------------------------------------------------------------- timer

function inQuietHours(qh, date) {
  if (!qh || !qh.enabled) return false
  var s = minutesOf(qh.start), e = minutesOf(qh.end)
  if (s === e) return false
  var t = date.getHours() * 60 + date.getMinutes()
  return s < e ? (t >= s && t < e) : (t >= s || t < e)
}

// hyprctl activewindow -j: fullscreen is 0 none, 1 maximised, 2 fullscreen,
// 3 both (older versions: a bool). Maximised windows do not count.
function isFullscreenWindow(json) {
  if (!isObj(json)) return false
  var f = json.fullscreen
  if (f === true) return true
  return typeof f === "number" && (f & 2) === 2
}

function formatCountdown(ms) {
  var s = Math.max(0, Math.ceil(ms / 1000))
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  if (h > 0) return h + ":" + pad2(m) + ":" + pad2(r)
  return pad2(m) + ":" + pad2(r)
}

// Compact form for the bar: "4m", "45s", "2h".
function shortCountdown(ms) {
  var s = Math.max(0, Math.ceil(ms / 1000))
  if (s < 60) return s + "s"
  var m = Math.ceil(s / 60)
  if (m < 60) return m + "m"
  return Math.floor(m / 60) + "h" + (m % 60 ? pad2(m % 60) : "")
}

function clockTime(ms) { var d = new Date(ms); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) }

// ----------------------------------------------------------------- reviews

function dayKey(ms) { var d = new Date(ms); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) }

// reviews.jsonl text -> {days: {YYYY-MM-DD: count}}
function reviewDays(text) {
  var days = {}
  String(text || "").split("\n").forEach(function(line) {
    if (!line.trim()) return
    try {
      var o = JSON.parse(line)
      if (o && typeof o.ts === "number") { var k = dayKey(o.ts); days[k] = (days[k] || 0) + 1 }
    } catch (e) {}
  })
  return days
}

// Consecutive days with at least one review, ending today (or yesterday
// when nothing was reviewed yet today, so the streak survives the morning).
function streak(days, nowMs) {
  var d = new Date(nowMs)
  var cur = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  if (!days[dayKey(cur.getTime())]) cur.setDate(cur.getDate() - 1)
  var n = 0
  while (days[dayKey(cur.getTime())]) { n++; cur.setDate(cur.getDate() - 1) }
  return n
}

// --------------------------------------------------------------- planning

function basename(p) { var s = String(p); return s.slice(s.lastIndexOf("/") + 1) }
function dirname(p) { var s = String(p); var i = s.lastIndexOf("/"); return i === -1 ? "" : s.slice(0, i) }
function noteTitle(p) { return basename(p).replace(/\.md$/i, "") }

// What construct the end of the note is still inside, if any: an unclosed
// ``` / ~~~ fence ("code"), %% comment ("comment"), $$ block ("math") or
// <!-- comment ("html"). A card appended there would be swallowed by it.
function openBlockAtEnd(text) {
  var lines = String(text || "").split(/\r\n|\n|\r/)
  var fence = null, pct = false, math = false, html = false
  for (var li = 0; li < lines.length; li++) {
    var line = lines[li]
    if (fence) {
      var close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)
      if (close && close[1][0] === fence.ch && close[1].length >= fence.len) fence = null
      continue
    }
    if (!pct && !math && !html) {
      var open = /^\s*(`{3,}|~{3,})/.exec(line)
      if (open) { fence = { ch: open[1][0], len: open[1].length }; continue }
    }
    var str = (pct || math || html) ? line : line.replace(/`[^`\n]*`/g, "")
    var i = 0
    while (i < str.length) {
      var j
      if (html) { j = str.indexOf("-->", i); if (j < 0) break; html = false; i = j + 3; continue }
      if (pct) { j = str.indexOf("%%", i); if (j < 0) break; pct = false; i = j + 2; continue }
      if (math) { j = str.indexOf("$$", i); if (j < 0) break; math = false; i = j + 2; continue }
      var h = str.indexOf("<!--", i), p = str.indexOf("%%", i), m = str.indexOf("$$", i)
      var best = -1, kind = ""
      if (h >= 0) { best = h; kind = "html" }
      if (p >= 0 && (best < 0 || p < best)) { best = p; kind = "pct" }
      if (m >= 0 && (best < 0 || m < best)) { best = m; kind = "math" }
      if (best < 0) break
      if (kind === "html") { html = true; i = best + 4 }
      else if (kind === "pct") { pct = true; i = best + 2 }
      else { math = true; i = best + 2 }
    }
  }
  return fence ? "code" : pct ? "comment" : math ? "math" : html ? "html" : ""
}

// The deck a card appended at the end of the note would land in without a
// tag of its own, or "" when an appended card would not parse as its own
// card (unclosed code fence or comment at the end of the note).
function tailDeck(Osr, path, text, settings) {
  if (openBlockAtEnd(text)) return ""
  var probeQ = "recall-probe-question", probeA = "recall-probe-answer"
  var probe = Osr.appendCard(text, Osr.formatNewCard(probeQ, probeA, settings, {}))
  var n = Osr.parseNote(path, probe, settings)
  if (!n || !n.questions.length) return ""
  var q = n.questions[n.questions.length - 1]
  if (q.actual !== probeQ + settings.singleLineCardSeparator + probeA || !q.decks || !q.decks.length) return ""
  return q.decks[0].join("/")
}

// The parser's firstLine can point at the previous single-line card (an
// upstream quirk); record where each question's own text starts instead.
function annotateStartLines(Osr, note, text) {
  if (!note || !note.questions.length) return
  var lines = String(text).split(/\r\n|\n/)
  note.questions.forEach(function(q) {
    var span = Osr.questionSpan(lines, q)
    q.startLine = span ? span.start : q.firstLine
  })
}

function cardCount(n) {
  var c = 0
  n.questions.forEach(function(q) { c += q.cards.length })
  return c
}

function bestNote(notes) {
  var best = null, bestCount = -1
  notes.forEach(function(n) {
    var c = cardCount(n)
    if (c > bestCount || (c === bestCount && best && n.path < best.path)) { best = n; bestCount = c }
  })
  return best
}

// Characters Windows (the vault is shared over NTFS) and Obsidian links
// cannot carry in a file name.
function safeName(s) {
  return String(s || "").replace(/[<>:"\/\\|?*#^\[\]\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "")
}

// First free "<folder>/<base><suffix><ext>" with suffix "", " 1", " 2", ...
// `taken` maps lower-cased vault paths (NTFS is case-insensitive) to true.
function uniquePath(folder, base, ext, taken, start) {
  for (var i = start || 0; i < 1000; i++) {
    var p = (folder ? folder + "/" : "") + base + (i ? " " + i : "") + ext
    if (!taken || !taken[p.toLowerCase()]) return p
  }
  return ""
}

// Picks the note a new card for deck `key` goes into.
//   notes: index notes, each with .tailDeck (see tailDeck())
// Returns {notePath, noteTitle, cardTag, createsNote, error}.
function planAdd(notes, key, lastNoteByDeck, newNoteFolder, taken) {
  key = deckKey(key)
  if (!key) return { notePath: "", noteTitle: "", cardTag: "", createsNote: false, error: "Pick a deck" }
  var tag = "#" + key
  function plan(n, exact) {
    return { notePath: n.path, noteTitle: noteTitle(n.path), cardTag: exact ? "" : tag, createsNote: false, error: "" }
  }
  var last = lastNoteByDeck ? lastNoteByDeck[key] : ""
  if (last) {
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].path === last && notes[i].tailDeck) return plan(notes[i], notes[i].tailDeck === key)
    }
  }
  var exact = bestNote(notes.filter(function(n) { return n.tailDeck === key }))
  if (exact) return plan(exact, true)
  var parts = key.split("/")
  for (var d = parts.length - 1; d >= 1; d--) {
    var anc = parts.slice(0, d).join("/")
    var near = bestNote(notes.filter(function(n) { return n.tailDeck === anc }))
    if (near) return plan(near, false)
  }
  var leaf = safeName(parts[parts.length - 1]) || "Flashcards"
  var path = uniquePath(cleanFolder(newNoteFolder), leaf, ".md", taken)
  return { notePath: path, noteTitle: noteTitle(path), cardTag: "", createsNote: true, error: path ? "" : "No free note name" }
}

// Card side text with a drawing embed appended on its own line.
function withEmbed(text, embed) {
  var t = String(text || "").replace(/\r\n/g, "\n").replace(/\s+$/, "")
  if (!embed) return t
  return (t ? t + "\n" : "") + "![[" + embed + "]]"
}

// ------------------------------------------------------------- excalidraw

// Subset of moment.js formatting: YYYY YY MM M DD D HH H hh h mm m ss s, [literal].
function formatMoment(fmt, date) {
  return String(fmt).replace(/\[([^\]]*)\]|YYYY|YY|MM|M|DD|D|HH|H|hh|h|mm|m|ss|s/g, function(t, lit) {
    if (lit !== undefined) return lit
    switch (t) {
    case "YYYY": return String(date.getFullYear())
    case "YY": return String(date.getFullYear()).slice(-2)
    case "MM": return pad2(date.getMonth() + 1)
    case "M": return String(date.getMonth() + 1)
    case "DD": return pad2(date.getDate())
    case "D": return String(date.getDate())
    case "HH": return pad2(date.getHours())
    case "H": return String(date.getHours())
    case "hh": return pad2(date.getHours() % 12 || 12)
    case "h": return String(date.getHours() % 12 || 12)
    case "mm": return pad2(date.getMinutes())
    case "m": return String(date.getMinutes())
    case "ss": return pad2(date.getSeconds())
    case "s": return String(date.getSeconds())
    }
    return t
  })
}

// Where and under what name the Excalidraw plugin would save a drawing made
// for an embed in `notePath` (its getEmbedFilename + folder rules).
// Returns {folder, base, ext}; the file is folder/base[ suffix]ext.
function drawingTarget(exc, app, notePath, date) {
  exc = isObj(exc) ? exc : {}
  var fmt = typeof exc.drawingFilenameDateTime === "string" ? exc.drawingFilenameDateTime : "YYYYMMDDHHmm"
  var postfix = typeof exc.drawingFilnameEmbedPostfix === "string" ? exc.drawingFilnameEmbedPostfix : " "
  var withName = exc.drawingEmbedPrefixWithFilename !== false
  var base = safeName(((withName ? noteTitle(notePath) : "") + postfix + (fmt !== "" ? formatMoment(fmt, date) : "")).trim())
  if (!base) base = "Drawing " + formatMoment("YYYYMMDDHHmm", date)
  var folder
  if (exc.embedUseExcalidrawFolder !== false) {
    folder = cleanFolder(typeof exc.folder === "string" ? exc.folder : "Excalidraw")
  } else {
    var att = isObj(app) && typeof app.attachmentFolderPath === "string" ? app.attachmentFolderPath : "/"
    if (att === "./" || att === ".") folder = dirname(notePath)
    else if (att.indexOf("./") === 0) folder = cleanFolder(dirname(notePath) + "/" + att.slice(2))
    else folder = cleanFolder(att)
  }
  return { folder: folder, base: base, ext: exc.useExcalidrawExtension ? ".excalidraw.md" : ".md" }
}

// What goes between ![[ and ]] for a vault file: Obsidian drops ".md".
function embedName(path) { return basename(path).replace(/\.md$/i, "") }

// ------------------------------------------------------------------ embeds

// byName: lower-cased basename (and basename without ".md") -> [paths]
function assetIndex(assets) {
  var byName = {}, byPath = {}
  function add(k, p) { (byName[k] = byName[k] || []).push(p) }
  assets.forEach(function(p) {
    var b = basename(p).toLowerCase()
    add(b, p)
    if (/\.md$/.test(b)) add(b.slice(0, -3), p)
    byPath[p.toLowerCase()] = p
  })
  return { byName: byName, byPath: byPath }
}

function normalizePath(p) {
  var out = []
  String(p).split("/").forEach(function(part) {
    if (part === "" || part === ".") return
    if (part === "..") out.pop()
    else out.push(part)
  })
  return out.join("/")
}

// Obsidian-style link resolution (getFirstLinkpathDest): exact vault path,
// then relative to the linking note, then by file name, preferring the
// linking note's folder, then the shortest path. Returns a vault path or "".
function resolveLink(idx, name, fromPath) {
  var n = String(name || "").split("|")[0].split("#")[0].trim()
  if (!n) return ""
  try { if (/%[0-9a-fA-F]{2}/.test(n)) n = decodeURIComponent(n) } catch (e) {}
  var lower = n.replace(/^\/+/, "").toLowerCase()
  function exact(p) { return idx.byPath[p] || idx.byPath[p + ".md"] || "" }
  var hit = exact(lower)
  if (hit) return hit
  var from = dirname(fromPath || "")
  if (from || n.indexOf("./") === 0 || n.indexOf("../") === 0) {
    hit = exact(normalizePath(from + "/" + n).toLowerCase())
    if (hit) return hit
  }
  var leaf = basename(lower)
  var cands = (idx.byName[leaf] || []).slice()
  if (lower.indexOf("/") !== -1) {
    cands = cands.filter(function(p) {
      var pl = p.toLowerCase()
      return pl.slice(-(lower.length + 1)) === "/" + lower || pl.slice(-(lower.length + 4)) === "/" + lower + ".md"
    })
  }
  if (!cands.length) return ""
  var fromDir = from.toLowerCase()
  cands.sort(function(a, b) {
    var sa = dirname(a).toLowerCase() === fromDir ? 0 : 1, sb = dirname(b).toLowerCase() === fromDir ? 0 : 1
    if (sa !== sb) return sa - sb
    if (a.length !== b.length) return a.length - b.length
    return a < b ? -1 : a > b ? 1 : 0
  })
  return cands[0]
}
