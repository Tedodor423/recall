.pragma library

// Flashcard engine compatible with the Obsidian Spaced Repetition plugin
// (st3v3nmw/obsidian-spaced-repetition, MIT), version 1.14.x, algorithm
// SM-2-OSR with scheduling stored in the notes as <!--SR:...--> comments.
//
// The parser, card expansion, scheduling maths and comment format are ports
// of that plugin's source (src/parser.ts, src/card/questions/*.ts,
// src/algorithms/osr/*.ts, src/data-stores/notes/notes.ts) and of the
// clozecraft library it uses (MIT). Quirks are kept on purpose: the point is
// that a card reviewed here ends up byte-for-byte where Obsidian would put it.
//
// No QML types are used, so the file also runs under plain node (tests/).

var DAY_MS = 24 * 3600 * 1000
var DUMMY_DUE = "2000-01-01"

var CardType = {
  SingleLineBasic: 0,
  SingleLineReversed: 1,
  MultiLineBasic: 2,
  MultiLineReversed: 3,
  Cloze: 4
}
var CARD_TYPE_NAMES = ["single", "single-reversed", "multi", "multi-reversed", "cloze"]

// Same order as the plugin's ReviewResponse enum.
var Response = { Easy: 0, Good: 1, Hard: 2, Again: 3 }

// ---------------------------------------------------------------- settings

var DEFAULT_SETTINGS = {
  flashcardTags: ["#flashcards"],
  flashcardTagsToIgnore: [],
  convertFoldersToDecks: false,
  burySiblingCards: false,
  convertHighlightsToClozes: true,
  convertBoldTextToClozes: false,
  convertCurlyBracketsToClozes: false,
  clozePatterns: ["==[123;;]answer[;;hint]=="],
  singleLineCardSeparator: "::",
  singleLineReversedCardSeparator: ":::",
  multilineCardSeparator: "?",
  multilineReversedCardSeparator: "??",
  multilineCardEndMarker: "",
  editLaterTag: "#edit-later",
  noteFoldersToIgnore: ["**/*.excalidraw.md"],
  showContextInCards: true,
  flashcardAgainText: "Again",
  flashcardHardText: "Hard",
  flashcardGoodText: "Good",
  flashcardEasyText: "Easy",
  algorithm: "SM-2-OSR",
  baseEase: 250,
  lapsesIntervalChange: 0.5,
  easyBonus: 1.3,
  loadBalance: true,
  maximumInterval: 36525,
  maxLinkFactor: 1.0,
  startOfDay: "00:00:00",
  dataStore: "NOTES",
  cardCommentOnSameLine: false
}

// The plugin's data.json is {settings: {...}, buryDate, buryList, ...}.
function settingsFrom(dataJson) {
  var raw = {}
  if (dataJson && typeof dataJson === "object") raw = dataJson.settings || dataJson
  var s = {}
  for (var k in DEFAULT_SETTINGS) s[k] = DEFAULT_SETTINGS[k]
  for (var key in raw) {
    if (raw[key] !== undefined && raw[key] !== null) s[key] = raw[key]
  }
  // Mirrors the migration in the plugin's settings.ts upgradeSettings().
  if (raw.clozePatterns === null || raw.clozePatterns === undefined) {
    s.clozePatterns = []
    if (s.convertHighlightsToClozes) s.clozePatterns.push("==[123;;]answer[;;hint]==")
    if (s.convertBoldTextToClozes) s.clozePatterns.push("**[123;;]answer[;;hint]**")
    if (s.convertCurlyBracketsToClozes) s.clozePatterns.push("{{[123;;]answer[;;hint]}}")
  }
  return s
}

// What this engine can faithfully write. Anything else is read-only.
function unsupportedReason(settings) {
  if (settings.dataStore !== "NOTES") return "Scheduling is not stored in notes (dataStore=" + settings.dataStore + ")"
  if (settings.algorithm !== "SM-2-OSR") return "Only the SM-2-OSR algorithm is supported (got " + settings.algorithm + ")"
  if (settings.convertFoldersToDecks) return "convertFoldersToDecks is not supported"
  return ""
}

// ------------------------------------------------------------------- dates

function pad2(n) { return (n < 10 ? "0" : "") + n }

function formatDate(ms) {
  var d = new Date(ms)
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
}

function startOfLocalDay(ms) {
  var d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// Adds whole calendar days in local time (DST-safe, like moment.add(n, "d")).
// moment rounds a fractional day count half away from zero.
function addDays(ms, days) {
  var n = days < 0 ? -Math.round(-days) : Math.round(days)
  var d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n,
                  d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()).getTime()
}

var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

// ALLOWED_DATE_FORMATS = ["YYYY-MM-DD", "DD-MM-YYYY", "ddd MMM DD YYYY"]
function parseDate(str) {
  if (!str) return null
  str = String(str).trim()
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(str)
  if (m) return validDate(+m[1], +m[2] - 1, +m[3])
  m = /^(\d{1,2})-(\d{1,2})-(\d{4})/.exec(str)
  if (m) return validDate(+m[3], +m[2] - 1, +m[1])
  m = /^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/.exec(str)
  if (m && MONTHS[m[1].toLowerCase()] !== undefined) return validDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2])
  return null
}

function validDate(y, mo, d) {
  var dt = new Date(y, mo, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null
  return dt.getTime()
}

// The plugin's LiveDateProvider.today, including its quirk: a custom day
// boundary only applies when hour, minute and second are all non-zero.
function todayMs(nowMs, settings) {
  var result = startOfLocalDay(nowMs)
  var parts = String((settings && settings.startOfDay) || "00:00:00").split(":")
  if (parts.length === 3) {
    var h = parseInt(parts[0]), mi = parseInt(parts[1]), se = parseInt(parts[2])
    if (h > 0 && h <= 23 && mi > 0 && mi <= 59 && se > 0 && se <= 59) {
      var d = new Date(nowMs)
      var boundary = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi, se, 0).getTime()
      if (nowMs < boundary) result = addDays(result, -1)
    }
  }
  return result
}

// ------------------------------------------------------------------ clozes
// Port of clozecraft 0.4.0 (ClozePattern, ClozeRegExp, ClozeNote*).

var CLOZE_PRIORITY = ["classic", "overlapping", "simple"]
var NUM_PATTERN = /\[(?:(?:\\\])?[^\]]?)+?\d+(?:(?:\\\])?[^\]]?)+?\]/
var HINT_PATTERN = /\[(?:(?:\\\])?[^\]]?)+?hint(?:(?:\\\])?[^\]]?)+?\]/

function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }

function processClozePart(text, rplc) {
  var ans = text.substring(1, text.length - 1)
  ans = ans.replace(/\\\[/g, "[").replace(/\\]/g, "]")
  ans = escapeRegex(ans)
  return rplc(ans)
}

function ClozePattern(raw) {
  this.raw = raw
  var num = NUM_PATTERN.exec(raw)
  var hint = HINT_PATTERN.exec(raw)
  if (!num) throw new Error("No cloze number pattern found")
  if (!hint) throw new Error("No cloze hint pattern found")
  if (raw.indexOf("answer") === -1) throw new Error("No answer keyword found")
  this.num = num
  this.hint = hint
  this.numRegex = processClozePart(num[0], function(t) { return t.replace(/\d+/g, "(\\d+)") })
  this.seqRegex = processClozePart(num[0], function(t) { return t.replace(/\d+/g, "([ash]+)") })
  this.hintRegex = "(?:" + processClozePart(hint[0], function(t) { return t.replace(/hint/g, "(.+?)") }) + ")?"
  var positions = { answer: raw.indexOf("answer"), hint: hint.index, seq: num.index }
  this.fieldOrder = ["answer", "hint", "seq"].sort(function(a, b) { return positions[a] - positions[b] })
  this.cache = {}
}

ClozePattern.prototype.regexStr = function(first, firstRep, second, secondRep) {
  var raw = this.raw
  var begin = raw.slice(0, first.index)
  var middle = raw.slice(first.index + first[0].length, second.index)
  var ending = raw.slice(second.index + second[0].length)
  var s = escapeRegex(begin) + firstRep + escapeRegex(middle) + secondRep + escapeRegex(ending)
  return s.replace("answer", "(.+?)")
}

ClozePattern.prototype.regex = function(type) {
  var r = this.cache[type]
  if (r) { r.re.lastIndex = 0; return r }
  var numFirst = this.num.index < this.hint.index
  var str, order
  if (type === "simple") {
    str = numFirst ? this.regexStr(this.num, "", this.hint, this.hintRegex)
                   : this.regexStr(this.hint, this.hintRegex, this.num, "")
    order = this.fieldOrder.filter(function(f) { return f !== "seq" })
  } else {
    var rep = type === "classic" ? this.numRegex : this.seqRegex
    str = numFirst ? this.regexStr(this.num, rep, this.hint, this.hintRegex)
                   : this.regexStr(this.hint, this.hintRegex, this.num, rep)
    order = this.fieldOrder
  }
  r = { re: new RegExp(str, "g"), order: order }
  this.cache[type] = r
  return r
}

function clozeExec(r, str) {
  var m = r.re.exec(str)
  if (!m) return null
  var seqIdx = r.order.indexOf("seq")
  return {
    raw: m[0],
    answer: m[r.order.indexOf("answer") + 1],
    hint: m[r.order.indexOf("hint") + 1],
    seq: seqIdx === -1 ? null : m[seqIdx + 1]
  }
}

ClozePattern.prototype.mainType = function(text) {
  for (var i = 0; i < CLOZE_PRIORITY.length; i++) {
    if (this.regex(CLOZE_PRIORITY[i]).re.test(text)) return CLOZE_PRIORITY[i]
  }
  return null
}

function ClozeCrafter(patterns) {
  this.patterns = []
  for (var i = 0; i < patterns.length; i++) {
    try { this.patterns.push(new ClozePattern(patterns[i])) } catch (e) {}
  }
}

ClozeCrafter.prototype.noteType = function(text) {
  var type = null
  for (var i = 0; i < this.patterns.length; i++) {
    var t = this.patterns[i].mainType(text)
    if (t !== null && (type === null || CLOZE_PRIORITY.indexOf(t) < CLOZE_PRIORITY.indexOf(type))) type = t
  }
  return type
}

ClozeCrafter.prototype.isClozeNote = function(text) { return this.noteType(text) !== null }

// Returns {numCards, deletions:[{raw, answer, hint, seq}], type}
ClozeCrafter.prototype.createNote = function(text) {
  var type = this.noteType(text)
  if (type === null) return null
  var deletions = [], numCards = 0
  for (var i = 0; i < this.patterns.length; i++) {
    var r = this.patterns[i].regex(type), m
    while ((m = clozeExec(r, text))) {
      if (type === "simple") {
        numCards++
        deletions.push({ raw: m.raw, answer: m.answer, hint: m.hint, seq: numCards })
      } else if (type === "classic") {
        if (!m.seq) break
        var n = parseInt(m.seq)
        deletions.push({ raw: m.raw, answer: m.answer, hint: m.hint, seq: n })
        if (numCards < n) numCards = n
      } else {
        if (!m.seq) break
        deletions.push({ raw: m.raw, answer: m.answer, hint: m.hint, seq: m.seq })
        if (numCards < m.seq.length) numCards = m.seq.length
      }
    }
  }
  return { type: type, numCards: numCards, deletions: deletions, raw: text }
}

// fmt: {asking(answer, hint), showingAnswer(answer, hint), hiding(answer, hint)}
function clozeSide(note, cardIndex, fmt, back) {
  var text = note.raw
  for (var i = 0; i < note.deletions.length; i++) {
    var d = note.deletions[i]
    var action
    if (note.type === "overlapping") action = cardIndex < d.seq.length ? d.seq[cardIndex] : "s"
    else action = d.seq === cardIndex + 1 ? "a" : "s"
    var rep
    if (action === "a") rep = back ? fmt.showingAnswer(d.answer, d.hint) : fmt.asking(d.answer, d.hint)
    else if (action === "h") rep = fmt.hiding(d.answer, d.hint)
    else rep = d.answer
    // String.replace with a string pattern: first occurrence, "$" specials apply.
    text = text.replace(d.raw, rep)
  }
  return text
}

// Markers the renderer turns into styled spans. Private-use characters so
// they can never collide with note text.
var CLOZE_ASK_OPEN = "", CLOZE_ASK_CLOSE = ""
var CLOZE_ANS_OPEN = "", CLOZE_ANS_CLOSE = ""
var CLOZE_FMT = {
  asking: function(a, h) { return CLOZE_ASK_OPEN + (h ? "[" + h + "]" : "[...]") + CLOZE_ASK_CLOSE },
  showingAnswer: function(a, h) { return CLOZE_ANS_OPEN + a + CLOZE_ANS_CLOSE },
  hiding: function(a, h) { return CLOZE_ASK_OPEN + (h ? "[" + h + "]" : "[...]") + CLOZE_ASK_CLOSE }
}

// ------------------------------------------------------------------ parser
// Port of src/parser.ts parse(). Line numbers are 0-based.

function markerInsideCodeBlock(text, marker, idx) {
  var before = 0, after = 0
  for (var i = idx - 1; i >= 0; i--) if (text[i] === "`") before++
  for (var j = idx + marker.length; j < text.length; j++) if (text[j] === "`") after++
  return before % 2 === 1 && after % 2 === 1
}

function hasInlineMarker(text, marker) {
  if (!marker || marker.length === 0) return false
  var idx = text.indexOf(marker)
  if (idx === -1) return false
  return !markerInsideCodeBlock(text, marker, idx)
}

function parse(text, o, crafter) {
  var inline = [
    { sep: o.singleLineCardSeparator, type: CardType.SingleLineBasic },
    { sep: o.singleLineReversedCardSeparator, type: CardType.SingleLineReversed }
  ]
  inline.sort(function(a, b) { return b.sep.length - a.sep.length })

  var cards = []
  var cardText = ""
  var cardType = null
  var firstLineNo = 0, lastLineNo
  crafter = crafter || new ClozeCrafter(o.clozePatterns)
  var lines = text.split("\r\n").join("\n").split("\n")

  for (var i = 0; i < lines.length; i++) {
    var currentLine = lines[i]
    var currentTrimmed = lines[i].trim()

    // Skip everything in HTML comments. (Upstream checks the *first* line for
    // "-->" on every iteration; a comment that does not close on its first
    // line therefore swallows the rest of the file. Kept for compatibility.)
    if (currentLine.indexOf("<!--") === 0 && currentLine.indexOf("<!--SR:") !== 0) {
      while (i + 1 < lines.length && currentLine.indexOf("-->") === -1) i++
      i++
      continue
    }

    var isEmptyLine = currentTrimmed.length === 0
    var hasEndMarker = o.multilineCardEndMarker && currentTrimmed === o.multilineCardEndMarker
    if ((isEmptyLine && !o.multilineCardEndMarker) || (isEmptyLine && cardType === null) || hasEndMarker) {
      if (cardType !== null) {
        lastLineNo = i - 1
        cards.push({ type: cardType, text: trimEnd(cardText), firstLine: firstLineNo, lastLine: lastLineNo })
        cardType = null
      }
      cardText = ""
      firstLineNo = i + 1
      continue
    }

    if (cardText.length > 0) cardText += "\n"
    cardText += trimEnd(currentLine)

    for (var s = 0; s < inline.length; s++) {
      if (hasInlineMarker(currentLine, inline[s].sep)) { cardType = inline[s].type; break }
    }

    if (cardType === CardType.SingleLineBasic || cardType === CardType.SingleLineReversed) {
      cardText = currentLine
      firstLineNo = i
      if (i + 1 < lines.length && lines[i + 1].indexOf("<!--SR:") === 0) {
        cardText += "\n" + lines[i + 1]
        i++
      }
      lastLineNo = i
      cards.push({ type: cardType, text: cardText, firstLine: firstLineNo, lastLine: lastLineNo })
      cardType = null
      cardText = ""
    } else if (currentTrimmed === o.multilineCardSeparator) {
      if (cardText.length > 1) cardType = CardType.MultiLineBasic
    } else if (currentTrimmed === o.multilineReversedCardSeparator) {
      if (cardText.length > 1) cardType = CardType.MultiLineReversed
    } else if (currentLine.indexOf("```") === 0 || currentLine.indexOf("~~~") === 0) {
      var close = currentLine.match(/`+|~+/)[0]
      while (i + 1 < lines.length && lines[i + 1].indexOf(close) !== 0) {
        i++
        cardText += "\n" + lines[i]
      }
      cardText += "\n" + close
      i++
    } else if (cardType === null && crafter.isClozeNote(currentLine)) {
      cardType = CardType.Cloze
    }
  }

  if (cardType !== null && cardText) {
    lastLineNo = lines.length - 1
    cards.push({ type: cardType, text: trimEnd(cardText), firstLine: firstLineNo, lastLine: lastLineNo })
  }
  return cards
}

function trimEnd(s) { return s.replace(/\s+$/, "") }
function trimStartWs(s) {
  var t = s.replace(/^\s+/, "")
  return [s.substring(0, s.length - t.length), t]
}

// -------------------------------------------------------------- frontmatter

function splitLines(text) { return text.replace(/\r\n|\r/g, "\n").split("\n") }

// Port of splitNoteIntoFrontmatterAndContent: content keeps the frontmatter
// lines as blanks so line numbers still match the file.
function splitFrontmatter(text) {
  var lines = splitLines(text)
  var idx = 0, inFm = false
  do {
    if (idx === 0 && lines[idx].replace(/^\uFEFF/, "") === "---") inFm = true
    else if (inFm && lines[idx] === "---") { inFm = false; idx++ }
    if (inFm) idx++
  } while (inFm && idx < lines.length)
  if (inFm) idx = 0
  var fm = lines.slice(0, idx).join("\n")
  var blanks = []
  for (var i = 0; i < idx; i++) blanks.push("")
  return { frontmatter: fm, frontmatterLines: idx, content: blanks.concat(lines.slice(idx)).join("\n") }
}

// Minimal YAML reading for the keys we need: tags, sr-due/sr-interval/sr-ease.
function frontmatterFields(fm) {
  var out = {}
  if (!fm) return out
  var lines = fm.split("\n").slice(1)  // drop the opening ---
  for (var i = 0; i < lines.length; i++) {
    var m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i])
    if (!m) continue
    var key = m[1], val = m[2].trim()
    if (val === "") {
      var list = []
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        i++
        list.push(unquote(lines[i].replace(/^\s*-\s+/, "").trim()))
      }
      out[key] = list.length ? list : ""
    } else if (val[0] === "[" && val[val.length - 1] === "]") {
      out[key] = val.slice(1, -1).split(",").map(function(x) { return unquote(x.trim()) })
                    .filter(function(x) { return x.length > 0 })
    } else {
      out[key] = unquote(val)
    }
  }
  return out
}

function unquote(s) {
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'")))
    return s.slice(1, -1)
  return s
}

// ------------------------------------------------------------------- tags
// Approximates Obsidian's metadata cache: content tags with line numbers,
// skipping fenced code, inline code and %% comments.

var TAG_RE = /(^|\s)#([^\s!"#$%&'()*+,.:;<=>?@^`{|}~\[\]\\]+)/g

function contentTags(contentLines) {
  var out = []
  var fence = null, inComment = false
  for (var ln = 0; ln < contentLines.length; ln++) {
    var line = contentLines[ln]
    if (fence) {
      if (line.trim().indexOf(fence) === 0) fence = null
      continue
    }
    var fm = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fm) { fence = fm[1]; continue }
    var scan = line.replace(/`[^`]*`/g, function(x) { return Array(x.length + 1).join(" ") })
    // %% obsidian comments %%
    var cleaned = ""
    var parts = scan.split("%%")
    for (var p = 0; p < parts.length; p++) {
      if (!inComment) cleaned += parts[p]
      else cleaned += Array(parts[p].length + 1).join(" ")
      if (p < parts.length - 1) { inComment = !inComment; cleaned += "  " }
    }
    TAG_RE.lastIndex = 0
    var m
    while ((m = TAG_RE.exec(cleaned))) {
      var tag = m[2].replace(/\/+$/, "")
      if (/^[0-9\/]+$/.test(tag)) continue
      out.push({ tag: "#" + tag, line: ln })
    }
  }
  return out
}

function frontmatterTags(fields) {
  var v = fields.tags
  if (v === undefined || v === null || v === "") return []
  var str = Array.isArray(v) ? v.join(",") : String(v)
  var out = []
  str.split(",").forEach(function(t) {
    t = t.trim()
    if (t !== "") out.push({ tag: t[0] === "#" ? t : "#" + t, line: -1 })
  })
  return out
}

function isSubTag(tag, sub) { return tag === sub || sub.indexOf(tag + "/") === 0 }
function isTagInList(list, tag) {
  for (var i = 0; i < list.length; i++) if (isSubTag(list[i], tag)) return true
  return false
}

function topicPathFromTag(tag) {
  return tag.replace("#", "").split("/").filter(function(x) { return x })
}
function pathKey(path) { return path.join("/") }

// ------------------------------------------------------------ question text

var TAG_AT_START = /^#[^\s#]+/gi
var BLOCK_ID_END = / (\^[a-zA-Z0-9-]+)$/

function removeScheduleInfo(text) { return text.replace(/<!--SR:.+-->/gm, "") }

// Port of QuestionText.splitText
function splitQuestionText(original, settings) {
  var withoutSR = removeScheduleInfo(original)
  var actual = trimEnd(withoutSR)
  var topic = null
  var startTag = withoutSR.replace(/^\s+/, "").match(TAG_AT_START)
  if (startTag && startTag.length > 0) {
    var path = topicPathFromTag(startTag[startTag.length - 1])
    if (path.length > 0) {
      var a = trimStartWs(withoutSR)
      var rest = a[1].replace(TAG_AT_START, "")
      var b = trimStartWs(rest)
      actual = b[1]
      if (!settings.convertFoldersToDecks) topic = { tag: startTag[startTag.length - 1], path: path, pre: a[0], post: b[0] }
    }
  }
  var blockId = null
  var bm = actual.match(BLOCK_ID_END)
  if (bm) {
    blockId = bm[0].trim()
    actual = trimEnd(actual.substring(0, actual.length - blockId.length))
  }
  return { topic: topic, actual: actual, blockId: blockId }
}

// ----------------------------------------------------------- card expansion

function lineIndexIgnoringWs(lines, s) {
  for (var i = 0; i < lines.length; i++) if (lines[i].trim() === s) return i
  return -1
}

function expand(type, text, settings, crafter) {
  var idx, a, b, lines
  switch (type) {
  case CardType.SingleLineBasic:
    idx = text.indexOf(settings.singleLineCardSeparator)
    return [{ front: text.substring(0, idx), back: text.substring(idx + settings.singleLineCardSeparator.length) }]
  case CardType.SingleLineReversed:
    idx = text.indexOf(settings.singleLineReversedCardSeparator)
    a = text.substring(0, idx)
    b = text.substring(idx + settings.singleLineReversedCardSeparator.length)
    return [{ front: a, back: b }, { front: b, back: a }]
  case CardType.MultiLineBasic:
  case CardType.MultiLineReversed:
    lines = text.split("\n")
    var sep = type === CardType.MultiLineBasic ? settings.multilineCardSeparator : settings.multilineReversedCardSeparator
    idx = lineIndexIgnoringWs(lines, sep)
    a = lines.slice(0, idx).join("\n")
    b = lines.slice(idx + 1).join("\n")
    return type === CardType.MultiLineBasic ? [{ front: a, back: b }] : [{ front: a, back: b }, { front: b, back: a }]
  case CardType.Cloze:
    var note = crafter.createNote(text)
    var out = []
    if (!note) return out
    for (var i = 0; i < note.numCards; i++)
      out.push({ front: clozeSide(note, i, CLOZE_FMT, false), back: clozeSide(note, i, CLOZE_FMT, true) })
    return out
  }
  return []
}

// --------------------------------------------------------------- schedules

// Port of StoreInNotes.questionCreateSchedule. Each entry is either null (new
// card, or the 2000-01-01 placeholder) or {dueMs, interval, ease}.
function parseSchedules(original) {
  var m = /<!--SR:(.+?)-->/m.exec(original)
  if (m) {
    return m[1].split("!").map(function(s) { return s.trim() })
               .filter(function(s) { return s.length > 0 })
               .map(parseSegment)
  }
  var res = []
  var re = /!([\d-]+),(\d+),(\d+)/gm, mm
  while ((mm = re.exec(original))) res.push(legacySchedule(mm[1], parseInt(mm[2]), parseInt(mm[3])))
  if (res.length) return res
  re = /<!--SR:([\d-]+),(\d+),(\d+)-->/gm
  while ((mm = re.exec(original))) res.push(legacySchedule(mm[1], parseInt(mm[2]), parseInt(mm[3])))
  return res
}

function parseSegment(seg) {
  if (seg.indexOf("FSRS,") === 0) return { fsrs: true, raw: seg }
  var f = seg.split(",")
  var r = legacySchedule(f[0], parseInt(f[1]), parseInt(f[2]))
  if (r && r.invalid) r.raw = seg
  return r
}

// null = new card (missing or the 2000-01-01 placeholder). Anything that does
// not parse cleanly comes back {invalid:true}: the plugin would keep such an
// entry (as an invalid date or NaN), so treating it as "new" and rewriting it
// would throw away history. Questions holding one are never written.
function legacySchedule(dateStr, interval, ease) {
  if (String(dateStr).trim() === DUMMY_DUE) return null
  var due = parseDate(dateStr)
  if (due === null || !isFinite(interval) || !isFinite(ease))
    return { invalid: true, raw: dateStr + "," + interval + "," + ease }
  if (formatDate(due) === DUMMY_DUE) return null
  return { dueMs: due, interval: Math.round(interval), ease: ease }
}

function scheduleIsWritable(sc) {
  return !!sc && !sc.invalid && !sc.fsrs && isFinite(sc.dueMs) &&
      /^\d{4}-\d{2}-\d{2}$/.test(formatDate(sc.dueMs)) &&
      isFinite(sc.interval) && sc.interval >= 0 && Math.round(sc.interval) === sc.interval &&
      isFinite(sc.ease) && sc.ease >= 130 && sc.ease < 100000
}

function formatScheduleComment(cards, settings) {
  var s = "<!--SR:"
  for (var i = 0; i < cards.length; i++) {
    var sc = cards[i].schedule
    if (sc && (sc.fsrs || sc.invalid)) s += "!" + sc.raw
    else if (sc) s += "!" + formatDate(sc.dueMs) + "," + sc.interval + "," + sc.ease
    else s += "!" + DUMMY_DUE + ",1," + settings.baseEase
  }
  return s + "-->"
}

// Port of Question.formatForNote
function formatQuestion(q, settings) {
  var result = (q.topic ? q.topic.pre + q.topic.tag + q.topic.post : "") + q.actual
  var hasSchedule = q.cards.some(function(c) { return !!c.schedule })
  var sameLine = settings.cardCommentOnSameLine && !(q.actual.slice(-3) === "```")
  if (hasSchedule) {
    result = trimEnd(result)
    var html = formatScheduleComment(q.cards, settings)
    if (q.blockId) {
      if (sameLine) result += " " + html + " " + q.blockId
      else result += " " + q.blockId + "\n" + html
    } else {
      result += (sameLine ? " " : "\n") + html
    }
  } else if (q.blockId) {
    result += " " + q.blockId
  }
  return result
}

// ------------------------------------------------------------------- notes

function headingContext(lines, cardLine) {
  var stack = [], fence = null
  for (var i = 0; i < lines.length && i <= cardLine; i++) {
    var line = lines[i]
    if (fence) { if (line.trim().indexOf(fence) === 0) fence = null; continue }
    var f = /^\s*(`{3,}|~{3,})/.exec(line)
    if (f) { fence = f[1]; continue }
    var h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (!h) continue
    var level = h[1].length
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
    stack.push({ level: level, text: h[2].replace(/\[\^\d+\]/gm, "").trim() })
  }
  return stack.map(function(x) { return x.text })
}

function globToRegex(glob) {
  var re = ""
  for (var i = 0; i < glob.length; i++) {
    var c = glob[i]
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i++; if (glob[i + 1] === "/") i++ }
      else re += "[^/]*"
    } else if (c === "?") re += "[^/]"
    else re += escapeRegex(c)
  }
  return new RegExp("^" + re + "$")
}

function noteIsIgnored(path, settings) {
  var list = settings.noteFoldersToIgnore || []
  for (var i = 0; i < list.length; i++) {
    var g = list[i]
    if (!g) continue
    // pathMatchesPattern: plain prefix, or a glob.
    if (path.indexOf(g) === 0 || globToRegex(g).test(path)) return true
  }
  return false
}

// Parses one note. Returns null when the note carries no flashcard tag.
//   path:  vault-relative path ("Notes/x.md")
//   text:  file contents
function parseNote(path, text, settings, crafter) {
  crafter = crafter || new ClozeCrafter(settings.clozePatterns)
  var split = splitFrontmatter(text)
  var fields = frontmatterFields(split.frontmatter)
  var contentLines = split.content.split("\n")
  var allTags = frontmatterTags(fields).concat(contentTags(contentLines))
  var tagNames = allTags.map(function(t) { return t.tag })

  // findTopicPath / getTopicPathOfFile: does any tag sit under a flashcard tag?
  var hasTopic = tagNames.some(function(t) { return isTagInList(settings.flashcardTags, t) })
  if (!hasTopic) return null
  if (tagNames.some(function(t) { return isTagInList(settings.flashcardTagsToIgnore || [], t) })) return null

  var parsed = parse(split.content, settings, crafter)
  var lines = splitLines(text)
  var questions = []
  for (var i = 0; i < parsed.length; i++) {
    var p = parsed[i]
    var qt = splitQuestionText(p.text, settings)
    var sides = expand(p.type, qt.actual, settings, crafter)
    var schedules = parseSchedules(p.text)
    var trimmed = schedules.length > sides.length
    if (trimmed) schedules = schedules.slice(0, sides.length)
    var cards = []
    for (var c = 0; c < sides.length; c++)
      cards.push({ idx: c, front: sides[c].front, back: sides[c].back, schedule: c < schedules.length ? schedules[c] : null })
    var span0 = questionSpan(contentLines, { original: p.text, firstLine: p.firstLine, lastLine: p.lastLine })
    questions.push({
      type: p.type,
      firstLine: p.firstLine,
      startLine: span0 ? span0.start : p.firstLine,
      lastLine: p.lastLine,
      original: p.text,
      topic: qt.topic,
      actual: qt.actual,
      blockId: qt.blockId,
      editLater: p.text.indexOf(settings.editLaterTag) !== -1,
      hadExtraSchedules: trimmed,
      context: headingContext(lines, span0 ? span0.start : p.firstLine),
      cards: cards,
      decks: null
    })
  }

  // analyseTagCacheList + determineQuestionTopicPathList
  var fcTags = allTags.filter(function(t) { return isTagInList(settings.flashcardTags, t.tag) })
  fcTags.sort(function(a, b) { return a.line - b.line })
  function questionSpecific(line) {
    return questions.some(function(q) { return line >= q.firstLine && line <= q.lastLine })
  }
  var fmList = fcTags.filter(function(t) { return t.line === -1 && !questionSpecific(-1) })
  var frontmatterDecks = fmList.length ? { line: -1, paths: fmList.map(function(t) { return topicPathFromTag(t.tag) }) } : null
  var contentGroups = []
  var cur = []
  fcTags.forEach(function(t) {
    if (t.line < split.frontmatterLines || questionSpecific(t.line)) return
    if (cur.length && cur[0].line !== t.line) {
      contentGroups.push({ line: cur[0].line, paths: cur.map(function(x) { return topicPathFromTag(x.tag) }) })
      cur = []
    }
    cur.push(t)
  })
  if (cur.length) contentGroups.push({ line: cur[0].line, paths: cur.map(function(x) { return topicPathFromTag(x.tag) }) })

  var kept = []
  questions.forEach(function(q) {
    var decks = null
    if (q.topic) {
      decks = [q.topic.path]
    } else {
      var res = frontmatterDecks
      for (var g = contentGroups.length - 1; g >= 0; g--) {
        if (contentGroups[g].line < q.firstLine) { res = contentGroups[g]; break }
      }
      if (!res && fcTags.length > 0) res = { paths: [topicPathFromTag(fcTags[0].tag)] }
      decks = res ? res.paths : null
    }
    // A card-level tag that is not a flashcard tag still counts upstream as a
    // topic path; match that but drop empty results.
    if (decks && decks.length) { q.decks = decks; kept.push(q) }
  })

  // Note-level decks: content groups (not question-specific) + frontmatter.
  var noteDecks = []
  if (frontmatterDecks) noteDecks = noteDecks.concat(frontmatterDecks.paths)
  contentGroups.forEach(function(g) { noteDecks = noteDecks.concat(g.paths) })

  var noteSchedule = null
  if (fields["sr-due"] && fields["sr-interval"] && fields["sr-ease"]) {
    noteSchedule = { dueMs: parseDate(fields["sr-due"]), interval: parseFloat(fields["sr-interval"]), ease: parseFloat(fields["sr-ease"]) }
  }

  var note = {
    path: path,
    questions: kept,
    noteDecks: uniquePaths(noteDecks),
    noteEase: noteSchedule ? noteSchedule.ease : null,
    lineEnding: text.indexOf("\r\n") !== -1 ? "\r\n" : "\n"
  }
  note.initialEase = noteInitialEase(note, settings)
  return note
}

function uniquePaths(paths) {
  var seen = {}, out = []
  paths.forEach(function(p) { var k = pathKey(p); if (!seen[k]) { seen[k] = true; out.push(p) } })
  return out
}

// SrsAlgorithmOsr.noteOnLoadedNote + calculateFlashcardAvgEase. Returns the
// rounded ease a brand-new card in this note starts with, or null for baseEase.
function noteInitialEase(note, settings) {
  var total = 0, count = 0
  note.questions.forEach(function(q) {
    q.cards.forEach(function(c) { if (c.schedule && c.schedule.dueMs !== undefined) { total += c.schedule.ease; count++ } })
  })
  var cardsAvg = 0
  if (count > 0) {
    var contribution = Math.min(1.0, Math.log(count + 0.5) / Math.log(64))
    cardsAvg = (total / count) * contribution + settings.baseEase * (1.0 - contribution)
  }
  var ease
  if (cardsAvg && note.noteEase) ease = (cardsAvg + note.noteEase) / 2
  else ease = cardsAvg ? cardsAvg : note.noteEase
  return ease ? Math.round(ease) : null
}

// --------------------------------------------------------------- scheduling

// Histogram of due cards keyed by days from now (ceil), for load balancing.
function buildHistogram(notes, nowMs) {
  var h = {}
  notes.forEach(function(n) {
    n.questions.forEach(function(q) {
      q.cards.forEach(function(c) {
        if (c.schedule && c.schedule.dueMs !== undefined) {
          var d = Math.ceil((c.schedule.dueMs - nowMs) / DAY_MS)
          if (d === 0) d = 0  // normalise -0
          h[d] = (h[d] || 0) + 1
        }
      })
    })
  })
  return h
}

function leastUsedInterval(h, interval, fuzz) {
  if (!(interval in h)) return interval
  var best = interval
  for (var i = 1; i <= fuzz; i++) {
    var cands = [interval - i, interval + i]
    for (var j = 0; j < 2; j++) {
      var ivl = cands[j]
      if (!(ivl in h)) return ivl
      if (h[ivl] < h[best]) best = ivl
    }
  }
  return best
}

// Port of osrSchedule(). delayedBeforeReview is in ms.
function osrSchedule(response, originalInterval, ease, delayedBeforeReview, settings, histogram) {
  var delayedDays = Math.max(0, Math.floor(delayedBeforeReview / DAY_MS))
  var interval = Math.max(1, originalInterval)
  if (response === Response.Easy) {
    ease += 20
    interval = ((interval + delayedDays) * ease) / 100
    interval *= settings.easyBonus
  } else if (response === Response.Good) {
    interval = ((interval + delayedDays / 2) * ease) / 100
  } else if (response === Response.Hard) {
    ease = Math.max(130, ease - 20)
    interval = Math.max(1, (interval + delayedDays / 4) * settings.lapsesIntervalChange)
  } else if (response === Response.Again) {
    ease = Math.max(130, ease - 20)
    interval = 0
  }
  if (settings.loadBalance && histogram) {
    interval = Math.round(interval)
    if (interval > 7) {
      var fuzz
      if (interval <= 21) fuzz = 1
      else if (interval <= 180) fuzz = Math.min(3, Math.floor(interval * 0.05))
      else fuzz = Math.min(7, Math.floor(interval * 0.025))
      interval = leastUsedInterval(histogram, interval, fuzz)
    }
  }
  interval = Math.min(interval, settings.maximumInterval)
  interval = Math.round(interval * 10) / 10
  return { interval: interval, ease: ease }
}

// New schedule for a card after `response`. card.schedule may be null (new).
function nextSchedule(card, note, response, settings, nowMs, histogram) {
  var today = todayMs(nowMs, settings)
  var r
  if (card.schedule) {
    // delayedBeforeReviewTicks as the plugin computes it when it reads a
    // comment: dueDate - today (so it is 0 or negative for a due card).
    var delayed = card.schedule.dueMs - today
    r = osrSchedule(response, card.schedule.interval, card.schedule.ease, delayed, settings, histogram)
  } else {
    var ease = note.initialEase !== null && note.initialEase !== undefined ? note.initialEase : settings.baseEase
    r = osrSchedule(response, 1.0, ease, 0, settings, histogram)
  }
  return { dueMs: addDays(today, r.interval), interval: Math.round(r.interval), ease: r.ease }
}

// What each button would schedule, for labelling them.
function previewIntervals(card, note, settings, nowMs, histogram) {
  var out = {}
  ;[Response.Again, Response.Hard, Response.Good, Response.Easy].forEach(function(r) {
    out[r] = nextSchedule(card, note, r, settings, nowMs, histogram).interval
  })
  return out
}

// Port of textInterval (desktop strings).
function textInterval(interval) {
  if (interval === undefined || interval === null) return "New"
  var m = Math.round(interval / 3.04375) / 10
  var y = Math.round(interval / 36.525) / 10
  if (m < 1.0) return interval + (interval === 1 ? " day" : " days")
  if (y < 1.0) return m + " months"
  return y + " years"
}

function shortInterval(interval) {
  if (interval === undefined || interval === null) return "new"
  if (interval < 1) return "now"
  var m = Math.round(interval / 3.04375) / 10
  var y = Math.round(interval / 36.525) / 10
  if (m < 1.0) return interval + "d"
  if (y < 1.0) return m + "mo"
  return y + "y"
}

// --------------------------------------------------------------- rewriting

// Applies a new schedule to card `cardIdx` of the question whose original
// text is `expectedOriginal` at lines [firstLine, lastLine] of `fileText`.
// Re-parses the current text first and refuses if the card moved or changed,
// so a stale index can never write over an edit made in Obsidian meanwhile.
// Returns {ok, text, error}.
function applyReview(fileText, path, settings, target, schedule) {
  var crafter = new ClozeCrafter(settings.clozePatterns)
  var note = parseNote(path, fileText, settings, crafter)
  if (!note) return { ok: false, error: "The note no longer has a flashcard tag" }
  var q = null
  for (var i = 0; i < note.questions.length; i++) {
    var c = note.questions[i]
    if (c.original === target.original && c.firstLine === target.firstLine) { q = c; break }
  }
  if (!q) {
    // Same text somewhere else in the note (lines inserted above it) is fine.
    var matches = note.questions.filter(function(c) { return c.original === target.original })
    if (matches.length === 1) q = matches[0]
  }
  if (!q) return { ok: false, error: "The card changed in the note since it was loaded" }
  if (target.cardIdx >= q.cards.length) return { ok: false, error: "The card no longer exists" }
  if (q.cards.some(function(c) { return c.schedule && c.schedule.fsrs })) return { ok: false, error: "Card uses FSRS scheduling" }
  if (q.cards.some(function(c) { return c.schedule && c.schedule.invalid }))
    return { ok: false, unsafe: true, error: "The card's scheduling comment is malformed" }
  if (!scheduleIsWritable(schedule)) return { ok: false, unsafe: true, error: "Refusing to write an invalid schedule" }
  var qIndex = note.questions.indexOf(q)
  var before = q.cards.map(function(c) { return c.schedule })
  q.cards[target.cardIdx].schedule = schedule
  var r = replaceQuestion(fileText, q, formatQuestion(q, settings))
  if (!r.ok) return r
  if (r.span.start < splitFrontmatter(fileText).frontmatterLines)
    return { ok: false, unsafe: true, error: "The card sits inside the note's frontmatter" }
  var why = verifyReview(note, qIndex, before, target.cardIdx, schedule, r.text, path, settings, crafter)
  if (why) return { ok: false, unsafe: true, error: why }
  return r
}

function sameSchedule(a, b) {
  if (!a || !b) return !a && !b
  if (a.fsrs || a.invalid || b.fsrs || b.invalid) return a.raw === b.raw
  return formatDate(a.dueMs) === formatDate(b.dueMs) && a.interval === b.interval && a.ease === b.ease
}

// Re-parses the rewritten note and checks the edit did exactly one thing:
// the target card now holds the new schedule, and every other question and
// sibling card reads exactly as before. Returns "" or the reason to refuse.
function verifyReview(oldNote, qIndex, oldSchedules, cardIdx, schedule, newText, path, settings, crafter) {
  var n = parseNote(path, newText, settings, crafter)
  var bad = "This card can't be updated safely; edit it in Obsidian"
  if (!n || n.questions.length !== oldNote.questions.length) return bad + " (the edit would change how the note parses)"
  for (var i = 0; i < n.questions.length; i++) {
    var a = oldNote.questions[i], b = n.questions[i]
    if (a.type !== b.type || a.actual !== b.actual || a.cards.length !== b.cards.length ||
        (a.topic ? a.topic.tag : "") !== (b.topic ? b.topic.tag : "") ||
        a.decks.map(pathKey).join("|") !== b.decks.map(pathKey).join("|"))
      return bad + " (the edit would change another part of the note)"
    for (var c = 0; c < b.cards.length; c++) {
      var want = i === qIndex ? (c === cardIdx ? schedule : oldSchedules[c]) : a.cards[c].schedule
      if (!sameSchedule(want, b.cards[c].schedule)) return bad + " (the schedule did not land where expected)"
    }
  }
  return ""
}

// The parser's firstLine is not always where the question text starts: after
// a single-line card it is left pointing at that card's line (upstream bug;
// the plugin itself finds questions by text, not by line). So locate the
// question's own lines inside [firstLine, lastLine] by content before
// replacing anything. Returns {start, end} (inclusive) or null.
function questionSpan(lines, q) {
  var want = q.original.split("\n").map(trimEnd)
  for (var start = q.firstLine; start + want.length - 1 <= q.lastLine; start++) {
    var ok = true
    for (var k = 0; k < want.length; k++) {
      if (trimEnd(lines[start + k] || "") !== want[k]) { ok = false; break }
    }
    if (ok) return { start: start, end: start + want.length - 1 }
  }
  return null
}

// Splits into lines keeping each line's own terminator ("\r\n", "\n" or "" for
// the last line), so a rewrite can leave mixed line endings exactly as found.
function splitKeepEol(text) {
  var out = [], re = /\r\n|\n/g, last = 0, m
  while ((m = re.exec(text))) {
    out.push({ line: text.slice(last, m.index), eol: m[0] })
    last = m.index + m[0].length
  }
  out.push({ line: text.slice(last), eol: "" })
  return out
}

function replaceQuestion(fileText, q, replacement) {
  var parts = splitKeepEol(fileText)
  var span = questionSpan(parts.map(function(p) { return p.line }), q)
  if (!span) return { ok: false, error: "Could not locate the card's lines in the note" }
  // Inserted lines use the span's first terminator; the last one keeps the
  // terminator the span ended with (none at end of file).
  var innerEol = parts[span.start].eol || (fileText.indexOf("\r\n") !== -1 ? "\r\n" : "\n")
  var middle = replacement.split("\n")
  var out = ""
  for (var i = 0; i < span.start; i++) out += parts[i].line + parts[i].eol
  for (var j = 0; j < middle.length; j++)
    out += middle[j] + (j < middle.length - 1 ? innerEol : parts[span.end].eol)
  for (var k = span.end + 1; k < parts.length; k++) out += parts[k].line + parts[k].eol
  return { ok: true, text: out, span: span }
}

// ------------------------------------------------------------------- index

// Builds the review index from [{path, text, mtime, sha}].
function buildIndex(files, settings, nowMs) {
  var crafter = new ClozeCrafter(settings.clozePatterns)
  var notes = [], errors = []
  for (var i = 0; i < files.length; i++) {
    var f = files[i]
    if (noteIsIgnored(f.path, settings)) continue
    try {
      var n = parseNote(f.path, f.text, settings, crafter)
      if (!n) continue
      n.sha = f.sha
      n.mtime = f.mtime
      notes.push(n)
    } catch (e) {
      errors.push(f.path + ": " + e)
    }
  }
  return { notes: notes, errors: errors, builtAt: nowMs, histogram: buildHistogram(notes, nowMs) }
}

// Flattens the index into card entries with deck info and due state.
function cardEntries(index, settings, nowMs) {
  var today = todayMs(nowMs, settings)
  var out = []
  index.notes.forEach(function(n, ni) {
    n.questions.forEach(function(q, qi) {
      q.cards.forEach(function(c) {
        var state
        if (q.editLater) state = "editLater"
        else if (q.cards.some(function(x) { return x.schedule && x.schedule.invalid })) state = "invalid"
        else if (!c.schedule) state = "new"
        else if (c.schedule.fsrs) state = "fsrs"
        else if (c.schedule.dueMs <= today) state = "due"
        else state = "later"
        out.push({
          key: n.path + "#" + q.startLine + ":" + c.idx,
          noteIndex: ni,
          questionIndex: qi,
          cardIdx: c.idx,
          path: n.path,
          deck: pathKey(q.decks[0]),
          decks: q.decks.map(pathKey),
          state: state,
          interval: c.schedule && c.schedule.dueMs !== undefined ? c.schedule.interval : null,
          ease: c.schedule && c.schedule.dueMs !== undefined ? c.schedule.ease : null,
          dueMs: c.schedule && c.schedule.dueMs !== undefined ? c.schedule.dueMs : null
        })
      })
    })
  })
  return out
}

function deckMatches(deck, filters) {
  if (!filters || filters.length === 0) return true
  for (var i = 0; i < filters.length; i++) {
    var f = filters[i]
    if (deck === f || deck.indexOf(f + "/") === 0) return true
  }
  return false
}

// Per-deck tree with totals. Keys are "a/b/c"; each node counts its subtree.
function deckTree(entries) {
  var nodes = {}
  function node(key) {
    if (!nodes[key]) nodes[key] = { key: key, name: key.split("/").pop(), depth: key.split("/").length - 1, total: 0, due: 0, fresh: 0, later: 0, mature: 0 }
    return nodes[key]
  }
  entries.forEach(function(e) {
    var parts = e.deck.split("/")
    for (var i = 1; i <= parts.length; i++) {
      var nd = node(parts.slice(0, i).join("/"))
      nd.total++
      if (e.state === "due") nd.due++
      else if (e.state === "new") nd.fresh++
      else if (e.state === "later") nd.later++
      if (e.interval !== null && e.interval >= 21) nd.mature++
    }
  })
  var list = Object.keys(nodes).sort().map(function(k) { return nodes[k] })
  return list
}

function counts(entries) {
  var c = { total: entries.length, due: 0, fresh: 0, later: 0, mature: 0, young: 0 }
  entries.forEach(function(e) {
    if (e.state === "due") c.due++
    else if (e.state === "new") c.fresh++
    else if (e.state === "later") c.later++
    if (e.interval !== null) { if (e.interval >= 21) c.mature++; else c.young++ }
  })
  return c
}

// Next card for a popup: due cards first (most overdue first, random among
// equals), then new cards in a random order. `skip` is a set of keys shown
// recently that should not come straight back.
function pickNext(entries, filters, skip, rand) {
  rand = rand || Math.random
  var due = [], fresh = []
  entries.forEach(function(e) {
    if (!deckMatches(e.deck, filters)) return
    if (skip && skip[e.key]) return
    if (e.state === "due") due.push(e)
    else if (e.state === "new") fresh.push(e)
  })
  if (due.length) {
    var minDue = Math.min.apply(null, due.map(function(e) { return e.dueMs }))
    var oldest = due.filter(function(e) { return e.dueMs === minDue })
    return oldest[Math.floor(rand() * oldest.length)]
  }
  if (fresh.length) return fresh[Math.floor(rand() * fresh.length)]
  return null
}

function upcoming(entries, filters, nowMs, settings, days) {
  var today = todayMs(nowMs, settings)
  var out = []
  for (var i = 0; i < days; i++) out.push(0)
  entries.forEach(function(e) {
    if (!deckMatches(e.deck, filters) || e.dueMs === null) return
    var d = Math.round((startOfLocalDay(e.dueMs) - today) / DAY_MS)
    if (d < 0) d = 0
    if (d < days) out[d]++
  })
  return out
}

// ----------------------------------------------------------------- adding

// Formats a new card for appending to a note.
//   front/back: text (may contain ![[embeds]] and newlines)
//   cardTag:    "#flashnotes/x/y" when the card's deck differs from the note's
//   reversed:   also ask back -> front
function formatNewCard(front, back, settings, opts) {
  opts = opts || {}
  front = String(front).replace(/\r\n/g, "\n").replace(/^\n+|\s+$/g, "")
  back = String(back).replace(/\r\n/g, "\n").replace(/^\n+|\s+$/g, "")
  // Blank lines end a card in the plugin's parser; keep paragraphs apart
  // with a lone line break instead (fenced code may keep its blank lines).
  front = collapseBlankLines(front)
  back = collapseBlankLines(back)
  var single = front.indexOf("\n") === -1 && back.indexOf("\n") === -1 && !opts.forceMultiline
  var tag = opts.cardTag ? opts.cardTag + " " : ""
  if (single) {
    var sep = opts.reversed ? settings.singleLineReversedCardSeparator : settings.singleLineCardSeparator
    return tag + front + sep + back
  }
  var msep = opts.reversed ? settings.multilineReversedCardSeparator : settings.multilineCardSeparator
  var body = tag + front + "\n" + msep + "\n" + back
  if (settings.multilineCardEndMarker) body += "\n" + settings.multilineCardEndMarker
  return body
}

function collapseBlankLines(text) {
  var lines = text.split("\n"), out = [], fence = null
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i]
    if (fence) {
      out.push(l)
      if (l.indexOf(fence) === 0) fence = null
      continue
    }
    var f = /^(`{3,}|~{3,})/.exec(l)
    if (f) { fence = f[1]; out.push(l); continue }
    if (l.trim() === "" ) continue
    out.push(l)
  }
  return out.join("\n")
}

// Validates a formatted card by parsing it on its own, the same way the
// plugin will. Returns "" when it yields exactly the expected card.
// expectFront/expectBack (optional) are the sides as typed; when given, the
// parsed card must split into exactly those sides.
function validateNewCard(cardText, settings, expectReversed, expectFront, expectBack) {
  var crafter = new ClozeCrafter(settings.clozePatterns)
  var parsed = parse(cardText, settings, crafter)
  if (parsed.length !== 1) return "That text would make " + parsed.length + " cards; check for separators or blank lines inside the text"
  var t = parsed[0].type
  var ok = expectReversed ? (t === CardType.SingleLineReversed || t === CardType.MultiLineReversed)
                          : (t === CardType.SingleLineBasic || t === CardType.MultiLineBasic)
  var sepHint = "the text contains a card separator (" + settings.singleLineCardSeparator + ", " +
      settings.singleLineReversedCardSeparator + " or a line with " + settings.multilineCardSeparator + ")"
  if (!ok) return "Can't save: " + sepHint
  var qt = splitQuestionText(parsed[0].text, settings)
  var sides = expand(t, qt.actual, settings, crafter)
  if (!sides.length) return "Can't save: the card would be empty"
  if (expectFront !== undefined && expectBack !== undefined) {
    var norm = function(x) { return collapseBlankLines(String(x).replace(/\r\n/g, "\n")).trim() }
    if (norm(sides[0].front) !== norm(expectFront) || norm(sides[0].back) !== norm(expectBack))
      return "Can't save: " + sepHint
  }
  return ""
}

// Appends a card to the end of a note, separated by a blank line.
function appendCard(fileText, cardText) {
  var eol = fileText.indexOf("\r\n") !== -1 ? "\r\n" : "\n"
  // Drop trailing blank lines only; the last line's own text (even trailing
  // spaces, e.g. an empty "- " list item) is the user's and stays as is.
  var body = fileText.replace(/(\r?\n[ \t]*)+$/, "")
  var add = cardText.split("\n").join(eol)
  return (body.length ? body + eol + eol : "") + add + eol
}

function newNoteText(deckTag) {
  return deckTag + "\n\n"
}
