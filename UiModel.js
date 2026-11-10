.pragma library

// Pure helpers for the overlay views (deck search, deck tree, settings input).
// No QML types: tests/ui-model.test.mjs loads this under node.

// Subsequence match of `query` in `text` (both lower-cased by the caller or
// not). Returns -1 when not every query character appears in order; higher is
// better: substring hits, matches at segment starts and runs score more,
// longer texts score slightly less.
function fuzzyScore(query, text) {
  var q = String(query || "").toLowerCase()
  var t = String(text || "").toLowerCase()
  if (!q) return 0
  var sub = t.indexOf(q)
  if (sub !== -1) {
    var atStart = sub === 0 || /[\/\-_ .#]/.test(t[sub - 1])
    return 1000 + (atStart ? 200 : 0) + (sub + q.length === t.length ? 50 : 0) - t.length
  }
  var score = 0, ti = 0, run = 0
  for (var qi = 0; qi < q.length; qi++) {
    var c = q[qi]
    var found = -1
    for (var j = ti; j < t.length; j++) if (t[j] === c) { found = j; break }
    if (found === -1) return -1
    run = found === ti && qi > 0 ? run + 1 : 0
    score += 10 + run * 8
    if (found === 0 || /[\/\-_ .#]/.test(t[found - 1])) score += 15
    score -= Math.min(10, found - ti)
    ti = found + 1
  }
  return score - t.length * 0.5
}

var TAG_CHARS = /^[^\s!"#$%&'()*+,.:;<=>?@^`{|}~\[\]\\]+$/

// "Bio cells" -> "bio-cells"; "#a/b/" -> "a/b". Returns a deck key or "".
function normalizeKey(q) {
  var s = String(q || "").replace(/^\s+|\s+$/g, "").replace(/^#+/, "").replace(/\s+/g, "-")
  s = s.replace(/\/+/g, "/").replace(/^\/|\/$/g, "")
  if (!s) return ""
  var parts = s.split("/")
  for (var i = 0; i < parts.length; i++) if (!TAG_CHARS.test(parts[i]) || /^[0-9]+$/.test(parts[i]) && i === 0) return ""
  return s
}

function underFlashcardTag(key, flashcardTags) {
  var tag = "#" + key
  for (var i = 0; i < (flashcardTags || []).length; i++) {
    var t = flashcardTags[i]
    if (tag === t || tag.indexOf(t + "/") === 0) return true
  }
  return false
}

// deckList: [{tag, key, total, due, fresh}] -> rows [{tag, key, total, due, fresh, create}]
function deckSuggestions(deckList, query, flashcardTags, limit) {
  limit = limit || 8
  var list = deckList || []
  var q = String(query || "").replace(/^\s+|\s+$/g, "").replace(/^#+/, "")
  var rows = []
  if (!q) {
    rows = list.slice().sort(function(a, b) { return (b.total - a.total) || (a.key < b.key ? -1 : 1) })
  } else {
    var scored = []
    for (var i = 0; i < list.length; i++) {
      var s = fuzzyScore(q, list[i].key)
      if (s >= 0) scored.push({ d: list[i], s: s })
    }
    scored.sort(function(a, b) { return (b.s - a.s) || (a.d.key < b.d.key ? -1 : 1) })
    rows = scored.map(function(x) { return x.d })
  }
  rows = rows.slice(0, limit).map(function(d) {
    return { tag: d.tag || "#" + d.key, key: d.key, total: d.total || 0, due: d.due || 0, fresh: d.fresh || 0, create: false }
  })
  var key = normalizeKey(q)
  if (key) {
    var exists = list.some(function(d) { return d.key === key })
    var target = key
    if (!underFlashcardTag(target, flashcardTags) && flashcardTags && flashcardTags.length)
      target = flashcardTags[0].replace(/^#/, "") + "/" + key
    var existsTarget = list.some(function(d) { return d.key === target })
    if (!exists && !existsTarget)
      rows.push({ tag: "#" + target, key: target, total: 0, due: 0, fresh: 0, create: true })
  }
  return rows
}

// Visible rows of a deckTree() list ([{key, name, depth, ...}] sorted by key).
// Nodes at depth >= maxDepth start collapsed (-1: everything expanded);
// `collapsed` ({key: bool}) overrides that per node.
function visibleTree(tree, collapsed, maxDepth) {
  var out = []
  var list = tree || []
  var hiddenUnder = null
  for (var i = 0; i < list.length; i++) {
    var d = list[i]
    var next = list[i + 1]
    var hasChildren = !!(next && next.key.indexOf(d.key + "/") === 0)
    if (hiddenUnder !== null && d.key.indexOf(hiddenUnder + "/") === 0) continue
    hiddenUnder = null
    var isCollapsed = hasChildren && (collapsed && collapsed[d.key] !== undefined ? !!collapsed[d.key] : (maxDepth >= 0 && d.depth >= maxDepth))
    var row = {}
    for (var k in d) row[k] = d[k]
    row.hasChildren = hasChildren
    row.collapsed = isCollapsed
    out.push(row)
    if (isCollapsed) hiddenUnder = d.key
  }
  return out
}

// Deck filter state of a key: "on" (listed), "implied" (an ancestor is), "off".
function filterState(decks, key) {
  var list = decks || []
  if (list.indexOf(key) !== -1) return "on"
  for (var i = 0; i < list.length; i++) if (key.indexOf(list[i] + "/") === 0) return "implied"
  return "off"
}

// Toggles a key in the deck filter; adding a deck drops its listed descendants.
function toggleFilter(decks, key) {
  var list = (decks || []).slice()
  var st = filterState(list, key)
  if (st === "on") return list.filter(function(k) { return k !== key })
  if (st === "implied") return list
  list = list.filter(function(k) { return k.indexOf(key + "/") !== 0 })
  list.push(key)
  list.sort()
  return list
}

// "#a, b ,#c/d" -> ["#a", "#b", "#c/d"]; "" -> null (use Obsidian's).
function parseTags(text) {
  var out = []
  String(text || "").split(/[,\s]+/).forEach(function(t) {
    var k = normalizeKey(t)
    if (k && out.indexOf("#" + k) === -1) out.push("#" + k)
  })
  return out.length ? out : null
}

// "8" -> "08:00", "7:5" -> "07:05", "22:30" -> "22:30", junk -> "".
function parseTime(text) {
  var m = /^\s*(\d{1,2})(?::(\d{1,2}))?\s*$/.exec(String(text || ""))
  if (!m) return ""
  var h = parseInt(m[1], 10), mi = m[2] === undefined ? 0 : parseInt(m[2], 10)
  if (h > 23 || mi > 59) return ""
  return (h < 10 ? "0" : "") + h + ":" + (mi < 10 ? "0" : "") + mi
}

function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s") }

// Bar heights (0..1) for a forecast strip; never all-zero-height for nonzero data.
function barHeights(values) {
  var max = 0
  for (var i = 0; i < values.length; i++) max = Math.max(max, values[i] || 0)
  return values.map(function(v) { return max > 0 ? (v || 0) / max : 0 })
}

function dayLabel(offset, nowMs) {
  if (offset === 0) return "today"
  if (offset === 1) return "tmrw"
  var d = new Date(nowMs + offset * 86400000)
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][d.getDay()]
}
