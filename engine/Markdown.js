.pragma library

// Card text -> render blocks for CardFace.qml.
//
//   blocks(text, ctx) -> [{kind: "html", html}
//                        | {kind: "image", path, width}
//                        | {kind: "drawing", path}
//                        | {kind: "file", name, path}]
//
// `text` is one side of a card as engine/Osr.js produces it: raw Obsidian
// markdown, with cloze gaps wrapped in private-use markers (U+E000 [...] U+E001
// while asking, U+E002 answer U+E003 once revealed).
//
// ctx (every field optional):
//   resolve(name)     -> absolute path or "" for an embed target (no |size, no #section)
//   isDrawing(path, name) -> bool; overrides the built-in Excalidraw guess
//   palette           {text, muted, accent, cloze, clozeAnswer, highlight, code, codeBg, link, border}
//                     QML colors or "#rgb" / "#rrggbb" / "#aarrggbb" strings
//   fontSize          base pixel size the html is laid out with (default 16)
//   charWidth         advance of one character of the (monospace) font (default 0.6 * fontSize)
//   fontFamily        family for code blocks (default "monospace")
//
// The html is Qt RichText: every piece of note text is escaped, the only tags
// are the ones built here (plus a short whitelist of inline tags from the note,
// re-emitted without attributes), and nothing ever references a resource, so
// rendering can never fetch a file or a URL. Media are separate blocks.
//
// ES5, no QML types: the file also runs under node (tests/markdown.test.mjs).

var ASK_OPEN = "\uE000", ASK_CLOSE = "\uE001", ANS_OPEN = "\uE002", ANS_CLOSE = "\uE003"
var PH_OPEN = "\uE010", PH_CLOSE = "\uE011", MEDIA_OPEN = "\uE012", MB_MARK = "\uE013", MEDIA_CLOSE = "\uE014"
var RESERVED_RE = /[\uE010-\uE014]/g

var IMAGE_EXT = { png: 1, jpg: 1, jpeg: 1, gif: 1, bmp: 1, svg: 1, webp: 1, avif: 1, ico: 1, tif: 1, tiff: 1 }

var DEFAULT_PALETTE = {
  text: "#cacccc", muted: "#808890", accent: "#7aa2f7", cloze: "#e0af68", clozeAnswer: "#9ece6a",
  highlight: "rgba(224,175,104,0.35)", code: "#c0caf5", codeBg: "#1f2326", link: "#7aa2f7", border: "#4a5058"
}

var MAX_DEPTH = 6        // nested quotes
var MAX_INPUT = 200000   // characters; longer sides are cut (a card, not a book)

// ------------------------------------------------------------------ helpers

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function hex2(n) {
  var h = Math.max(0, Math.min(255, Math.round(n))).toString(16)
  return h.length < 2 ? "0" + h : h
}

// Any color form -> a CSS value Qt's rich text accepts. Unknown input falls back,
// so nothing from the outside can break out of a style attribute.
function cssColor(c, fallback) {
  if (c === null || c === undefined || c === "") return fallback
  if (typeof c === "object" && c.r !== undefined && c.g !== undefined && c.b !== undefined) {
    var a = c.a === undefined ? 1 : Number(c.a)
    if (a >= 0.999) return "#" + hex2(c.r * 255) + hex2(c.g * 255) + hex2(c.b * 255)
    return "rgba(" + Math.round(c.r * 255) + "," + Math.round(c.g * 255) + "," + Math.round(c.b * 255) + "," + (Math.round(a * 1000) / 1000) + ")"
  }
  var s = String(c).replace(/^\s+|\s+$/g, "")
  var m = /^#([0-9a-fA-F]{3})$/.exec(s)
  if (m) return "#" + m[1][0] + m[1][0] + m[1][1] + m[1][1] + m[1][2] + m[1][2]
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase()
  m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(s)   // Qt's #aarrggbb
  if (m) {
    var al = parseInt(m[1], 16) / 255
    if (al >= 0.999) return "#" + m[2] + m[3] + m[4]
    return "rgba(" + parseInt(m[2], 16) + "," + parseInt(m[3], 16) + "," + parseInt(m[4], 16) + "," + (Math.round(al * 1000) / 1000) + ")"
  }
  if (/^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)$/.test(s)) return s
  if (/^[a-zA-Z]{3,20}$/.test(s)) return s.toLowerCase()
  return fallback
}

function makePalette(p) {
  var out = {}
  p = p || {}
  for (var k in DEFAULT_PALETTE) out[k] = cssColor(p[k], DEFAULT_PALETTE[k])
  return out
}

// Visual column of the first non-blank character (tabs to multiples of 4).
function indentOf(line) {
  var col = 0
  for (var i = 0; i < line.length; i++) {
    var ch = line[i]
    if (ch === " ") col++
    else if (ch === "\t") col = col - (col % 4) + 4
    else break
  }
  return col
}

function extOf(name) {
  var base = String(name).split("/").pop()
  var dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ""
}

function baseName(path) {
  return String(path).split("/").pop()
}

function px(n) { return Math.max(0, Math.round(n)) + "px" }

// ---------------------------------------------------------------- TeX -> text
// Not a TeX engine: enough to make the inline chemistry and physics in the
// user's cards readable (sub/superscripts, fractions, Greek, arrows).

var TEX_SYMBOLS = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π",
  varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "φ",
  varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ",
  Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  rightarrow: "→", to: "→", leftarrow: "←", gets: "←", Rightarrow: "⇒", Leftarrow: "⇐",
  leftrightarrow: "↔", Leftrightarrow: "⇔", longrightarrow: "⟶", longleftarrow: "⟵",
  Longrightarrow: "⟹", longleftrightarrow: "⟷", rightleftharpoons: "⇌", leftrightharpoons: "⇋",
  uparrow: "↑", downarrow: "↓", updownarrow: "↕", mapsto: "↦", implies: "⟹", iff: "⟺",
  times: "×", cdot: "·", ast: "∗", star: "⋆", pm: "±", mp: "∓", div: "÷", leq: "≤", le: "≤",
  geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈", sim: "∼", simeq: "≃", cong: "≅", equiv: "≡",
  propto: "∝", ll: "≪", gg: "≫", infty: "∞", sum: "∑", prod: "∏", int: "∫", oint: "∮",
  partial: "∂", nabla: "∇", circ: "∘", degree: "°", bullet: "•", ldots: "…", cdots: "⋯", dots: "…",
  vdots: "⋮", in: "∈", notin: "∉", ni: "∋", subset: "⊂", supset: "⊃", subseteq: "⊆", supseteq: "⊇",
  cup: "∪", cap: "∩", setminus: "∖", forall: "∀", exists: "∃", neg: "¬", lnot: "¬", land: "∧",
  wedge: "∧", lor: "∨", vee: "∨", emptyset: "∅", varnothing: "∅", angle: "∠", perp: "⊥",
  parallel: "∥", mid: "∣", prime: "′", hbar: "ℏ", ell: "ℓ", Re: "ℜ", Im: "ℑ", aleph: "ℵ",
  langle: "⟨", rangle: "⟩", lceil: "⌈", rceil: "⌉", lfloor: "⌊", rfloor: "⌋", vert: "|", Vert: "‖",
  quad: "  ", qquad: "    ", log: "log", ln: "ln", exp: "exp", sin: "sin", cos: "cos", tan: "tan",
  lim: "lim", max: "max", min: "min", det: "det", dagger: "†", therefore: "∴", because: "∵",
  checkmark: "✓", triangle: "△", square: "□", percent: "%", "%": "%", "#": "#", "$": "$", "&": "&",
  "_": "_", "{": "{", "}": "}", ",": " ", ";": " ", ":": " ", " ": " ", "!": "", "|": "‖"
}
var TEX_TEXT = { text: 1, textrm: 1, mathrm: 1, mathit: 1, textit: 1, mathsf: 1, mathtt: 1, texttt: 1,
                 operatorname: 1, mathcal: 1, mathbb: 1, mathfrak: 1, mbox: 1, hbox: 1, ce: 1, pu: 1 }
var TEX_BOLD = { mathbf: 1, textbf: 1, boldsymbol: 1, bm: 1 }
var TEX_ACCENT = { vec: "⃗", hat: "̂", bar: "̄", overline: "̄", tilde: "̃", dot: "̇", ddot: "̈", underline: "" }
var TEX_IGNORE = { displaystyle: 1, textstyle: 1, scriptstyle: 1, limits: 1, nolimits: 1, big: 1, Big: 1,
                   bigg: 1, Bigg: 1, bigl: 1, bigr: 1, Bigl: 1, Bigr: 1, left: 1, right: 1, middle: 1,
                   tag: 0 }

function texToHtml(src, display, depth) {
  depth = depth || 0
  if (depth > 12) return escapeHtml(src)
  var s = String(src), i = 0, n = s.length, out = ""

  function skipSpace() { while (i < n && /\s/.test(s[i])) i++ }
  function group() {             // s[i] === "{": returns the inner text, i after "}"
    var d = 0, start = i + 1
    for (var j = i; j < n; j++) {
      if (s[j] === "\\") { j++; continue }
      if (s[j] === "{") d++
      else if (s[j] === "}") { d--; if (d === 0) { i = j + 1; return s.slice(start, j) } }
    }
    i = n
    return s.slice(start)
  }
  function arg() {
    skipSpace()
    if (i >= n) return ""
    if (s[i] === "{") return group()
    if (s[i] === "\\") {
      var m = /^\\([A-Za-z]+|.)/.exec(s.slice(i))
      if (m) { i += m[0].length; return m[0] }
    }
    return s[i++]
  }
  function simple(raw) { return /^\s*([A-Za-z0-9.,'+\-]|\\[A-Za-z]+)\s*$/.test(raw) || /^\s*[0-9.,]+\s*$/.test(raw) || /^\s*[A-Za-z]\s*$/.test(raw) }
  function sub(raw) { return texToHtml(raw, display, depth + 1) }

  while (i < n) {
    var c = s[i]
    if (c === "\\") {
      var m = /^\\([A-Za-z]+|.)/.exec(s.slice(i))
      if (!m) { out += "\\"; i++; continue }
      var name = m[1]
      i += m[0].length
      if (name === "\\") { out += display ? "<br>" : " "; continue }
      if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "cfrac") {
        var a = arg(), b = arg()
        out += (simple(a) ? sub(a) : "(" + sub(a) + ")") + "/" + (simple(b) ? sub(b) : "(" + sub(b) + ")")
        continue
      }
      if (name === "sqrt") {
        skipSpace()
        var root = ""
        if (s[i] === "[") { var close = s.indexOf("]", i); if (close > i) { root = s.slice(i + 1, close); i = close + 1 } }
        var r = arg()
        out += (root ? "<sup>" + sub(root) + "</sup>" : "") + "√" + (simple(r) ? sub(r) : "(" + sub(r) + ")")
        continue
      }
      if (name === "begin" || name === "end") { arg(); continue }
      if (TEX_TEXT[name]) { out += sub(arg()); continue }
      if (TEX_BOLD[name]) { out += "<b>" + sub(arg()) + "</b>"; continue }
      if (TEX_ACCENT[name] !== undefined) {
        var acc = arg()
        out += sub(acc) + (simple(acc) ? TEX_ACCENT[name] : "")
        continue
      }
      if (name === "overset" || name === "underset" || name === "stackrel") {
        var top = arg(), base = arg()
        out += sub(base) + "<sup>" + sub(top) + "</sup>"
        continue
      }
      if (TEX_IGNORE[name] !== undefined) {
        if ((name === "left" || name === "right" || name === "middle") && i < n) {
          // The delimiter that follows; "." means none.
          if (s[i] === ".") i++
          else if (s[i] === "\\") {
            var dm = /^\\([A-Za-z]+|.)/.exec(s.slice(i))
            if (dm) { i += dm[0].length; out += escapeHtml(TEX_SYMBOLS[dm[1]] !== undefined ? TEX_SYMBOLS[dm[1]] : dm[1]) }
          } else out += escapeHtml(s[i++])
        }
        continue
      }
      if (TEX_SYMBOLS[name] !== undefined) { out += escapeHtml(TEX_SYMBOLS[name]); continue }
      out += escapeHtml("\\" + name)
    } else if (c === "^" || c === "_") {
      i++
      var g = arg()
      var tag = c === "^" ? "sup" : "sub"
      out += "<" + tag + ">" + sub(g) + "</" + tag + ">"
    } else if (c === "{") {
      out += sub(group())
    } else if (c === "}") {
      i++
    } else if (c === "~") {
      out += "&nbsp;"; i++
    } else if (c === "&") {
      out += " "; i++
    } else if (c === "'") {
      out += "′"; i++
    } else {
      out += escapeHtml(c); i++
    }
  }
  return out
}

// ------------------------------------------------------------------ embeds

function isDrawingPath(path, name, R) {
  if (R.isDrawing) {
    try { return !!R.isDrawing(path, name) } catch (e) { return false }
  }
  var p = String(path).toLowerCase()
  if (/\.excalidraw(\.md)?$/.test(p)) return true
  return /\.md$/.test(p) && /(^|\/)excalidraw\//.test(p)
}

function resolveName(name, R) {
  if (!R.resolve || !name) return ""
  try {
    var r = R.resolve(name)
    return r ? String(r) : ""
  } catch (e) {
    return ""
  }
}

// target: "name", "name.png", "name#section"; size: "300", "300x200", "alt"
function embedBlock(target, size, R, external) {
  var t = String(target).replace(/^\s+|\s+$/g, "")
  var clean = t.split("#")[0].replace(/\s+$/, "")
  var label = clean || t
  var width = 0
  var sm = /^\s*(\d+)(?:\s*x\s*\d+)?\s*$/.exec(size || "")
  if (sm) width = parseInt(sm[1], 10)
  if (external) return { kind: "file", name: label, path: "" }
  var path = clean ? resolveName(clean, R) : ""
  var ext = extOf(clean) || extOf(path)
  if (IMAGE_EXT[ext] || IMAGE_EXT[extOf(path)]) {
    if (path) return { kind: "image", path: path, width: width }
    return { kind: "file", name: baseName(label), path: "" }
  }
  if (path && (ext === "excalidraw" || isDrawingPath(path, clean, R))) return { kind: "drawing", path: path }
  var shown = baseName(label).replace(/\.md$/i, "")
  var section = t.indexOf("#") !== -1 ? t.slice(t.indexOf("#") + 1).replace(/^\^/, "") : ""
  var page = /^page=(\d+)/.exec(section)
  if (page) shown += " · page " + page[1]
  else if (section && (ext === "md" || ext === "")) shown += " › " + section
  return { kind: "file", name: shown, path: path }
}

// ------------------------------------------------------------------ inline

var WORD = "A-Za-z0-9\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF"
var RE_UNDER_BOLD = new RegExp("(^|[^" + WORD + "_])__(?=\\S)([\\s\\S]*?\\S)__(?![" + WORD + "_])", "g")
var RE_UNDER_ITAL = new RegExp("(^|[^" + WORD + "_])_(?=[^\\s_])([\\s\\S]*?[^\\s_])_(?![" + WORD + "_])", "g")
var INLINE_TAGS = { b: "b", strong: "b", i: "i", em: "i", u: "u", s: "s", del: "s", strike: "s",
                    sub: "sub", sup: "sup", small: "small", mark: "mark", kbd: "kbd", code: "kbd" }

// Returns [{html}, {media}] parts. R.mediaAsText renders embeds as a small
// label instead (table cells cannot be split around a block).
function renderInline(src, R) {
  var store = []
  var media = []
  var P = R.palette
  function ph(html) { store.push(html); return PH_OPEN + (store.length - 1) + PH_CLOSE }
  function embed(block) {
    if (R.mediaAsText) {
      var label = block.kind === "image" ? "image" : block.kind === "drawing" ? "drawing" : "file"
      var nm = block.name || baseName(block.path || "")
      return ph('<span style="color:' + P.muted + '">[' + escapeHtml(label + (nm && block.kind !== "drawing" ? ": " + nm : "")) + "]</span>")
    }
    media.push(block)
    return MEDIA_OPEN + (media.length - 1) + MEDIA_CLOSE
  }

  var s = String(src)

  // 1. Code spans: nothing inside them is markdown.
  s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, function(m, ticks, body) {
    if (/^ [\s\S]* $/.test(body) && /\S/.test(body)) body = body.slice(1, -1)
    return ph('<span style="color:' + P.code + ";background-color:" + P.codeBg + '">' + escapeHtml(body) + "</span>")
  })

  // 2. Comments.
  s = s.replace(/%%[\s\S]*?%%/g, "").replace(/<!--[\s\S]*?-->/g, "")

  // 3. Math. $$...$$ first, then $...$ (opening $ not followed by a space,
  //    closing $ not preceded by one nor followed by a digit, like Obsidian).
  function mathSpan(body) {
    return ph('<span style="color:' + P.code + '">' + texToHtml(body, false) + "</span>")
  }
  s = s.replace(/(^|[^\\])\$\$([\s\S]+?)\$\$/g, function(m, pre, body) { return pre + mathSpan(body) })
  s = s.replace(/(^|[^\\$])\$(?=[^\s$])([^$\n]*?[^\s\\$]|[^\s\\$])\$(?![\d$])/g, function(m, pre, body) { return pre + mathSpan(body) })

  // 4. Backslash escapes (a backslash in front of a cloze marker escaped a
  //    character the cloze then consumed; drop it).
  s = s.replace(/\\([!-\/:-@\[-`{-~])/g, function(m, c) { return ph(escapeHtml(c)) })
  s = s.replace(/\\(?=[\uE000\uE002])/g, "")

  // 5. Embeds and links.
  s = s.replace(/!\[\[([^\]\n]+?)\]\]/g, function(m, inner) {
    var bar = inner.indexOf("|")
    return embed(embedBlock(bar === -1 ? inner : inner.slice(0, bar), bar === -1 ? "" : inner.slice(bar + 1), R, false))
  })
  s = s.replace(/!\[([^\]\n]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g, function(m, alt, url) {
    var bar = alt.lastIndexOf("|")
    var size = bar === -1 ? alt : alt.slice(bar + 1)
    var u = url
    try { u = decodeURI(url) } catch (e) {}
    if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^file:/i.test(u)) return embed(embedBlock(alt || u, "", R, true))
    u = u.replace(/^file:\/\//i, "")
    return embed(embedBlock(u, size, R, false))
  })
  s = s.replace(/\[\[([^\]\n]+?)\]\]/g, function(m, inner) {
    var bar = inner.indexOf("|")
    var shown = bar === -1 ? inner.replace(/\.md(?=#|$)/i, "").replace(/#\^?/g, " › ") : inner.slice(bar + 1)
    return ph('<span style="color:' + P.link + '">' + escapeHtml(shown) + "</span>")
  })
  s = s.replace(/\[([^\]\n]+)\]\(\s*<?[^)\s>]*>?(?:\s+"[^"]*")?\s*\)/g, function(m, text) {
    return ph('<span style="color:' + P.link + ';text-decoration:underline">') + text + ph("</span>")
  })

  // 6. Whitelisted inline html (no attributes kept), footnote refs, block ids.
  var open = {}
  s = s.replace(/<\s*(\/?)\s*([a-zA-Z]+)\s*(\/?)\s*>/g, function(m, closing, tag, selfClose) {
    var t = tag.toLowerCase()
    if (t === "br") return ph("<br>")
    var mapped = INLINE_TAGS[t]
    if (!mapped || selfClose) return m
    if (closing) {
      if (!open[mapped]) return ""
      open[mapped]--
      return ph(mapped === "mark" || mapped === "kbd" ? "</span>" : "</" + mapped + ">")
    }
    open[mapped] = (open[mapped] || 0) + 1
    if (mapped === "mark") return ph('<span style="background-color:' + P.highlight + '">')
    if (mapped === "kbd") return ph('<span style="color:' + P.code + ";background-color:" + P.codeBg + '">')
    return ph("<" + mapped + ">")
  })
  s = s.replace(/\[\^([^\]\s]+)\]/g, function(m, id) { return ph("<sup>" + escapeHtml(id) + "</sup>") })
  s = s.replace(/\s\^[A-Za-z0-9-]+\s*$/, "")

  // 7. Tags (same character rules as engine/Osr.js).
  s = s.replace(/(^|\s)#([^\s!"#$%&'()*+,.:;<=>?@^`{|}~\[\]\\\uE000-\uE0FF]+)/g, function(m, pre, tag) {
    if (/^[0-9\/]+$/.test(tag)) return m
    return pre + ph('<span style="color:' + P.muted + '">' + escapeHtml("#" + tag) + "</span>")
  })

  // 8. Escape what is left, then emphasis on the escaped text.
  s = escapeHtml(s)
  function wrap1(openTag, closeTag) {        // one group: the content
    return function(m, a) { return ph(openTag) + a + ph(closeTag) }
  }
  function wrap2(openTag, closeTag) {        // two groups: preceding char, content
    return function(m, pre, a) { return pre + ph(openTag) + a + ph(closeTag) }
  }
  s = s.replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, wrap1("<b><i>", "</i></b>"))
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, wrap1("<b>", "</b>"))
  s = s.replace(RE_UNDER_BOLD, wrap2("<b>", "</b>"))
  s = s.replace(/(^|[^*])\*(?=[^\s*])([^*]*?[^\s*]|[^\s*])\*(?!\*)/g, wrap2("<i>", "</i>"))
  s = s.replace(RE_UNDER_ITAL, wrap2("<i>", "</i>"))
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, wrap1("<s>", "</s>"))
  s = s.replace(/==(?=\S)([\s\S]*?\S)==/g, wrap1('<span style="background-color:' + P.highlight + '">', "</span>"))

  // 9. Cloze markers (balanced: a stray marker can never leave a span open).
  var depthAsk = 0
  s = s.replace(/[\uE000-\uE003]/g, function(ch) {
    if (ch === ASK_OPEN || ch === ANS_OPEN) {
      depthAsk++
      return ch === ASK_OPEN
        ? '<span style="color:' + P.cloze + ';font-weight:bold">'
        : '<span style="color:' + P.clozeAnswer + ';font-weight:bold">'
    }
    if (depthAsk === 0) return ""
    depthAsk--
    return "</span>"
  })
  while (depthAsk-- > 0) s += "</span>"
  for (var t in open) {
    var tagName = t === "mark" || t === "kbd" ? "span" : t
    for (var k = 0; k < open[t]; k++) s += "</" + tagName + ">"
  }

  // 10. Restore placeholders (contents never contain placeholders themselves,
  //     except link text, which is in the stream; loop for safety).
  for (var pass = 0; pass < 4 && s.indexOf(PH_OPEN) !== -1; pass++)
    s = s.replace(/\uE010(\d+)\uE011/g, function(m, idx) { return store[+idx] })
  s = s.replace(/[\uE010\uE011]/g, "")

  if (!media.length) return [{ html: s }]
  var parts = []
  var re = /\uE012(\d+)\uE014/g, last = 0, mm
  while ((mm = re.exec(s))) {
    if (mm.index > last) parts.push({ html: s.slice(last, mm.index) })
    parts.push({ media: media[+mm[1]] })
    last = re.lastIndex
  }
  if (last < s.length) parts.push({ html: s.slice(last) })
  return parts
}

// ------------------------------------------------------------------ blocks

var RE_FENCE = /^\s*(`{3,}|~{3,})(.*)$/
var RE_HEADING = /^\s{0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/
var RE_HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
var RE_LIST = /^(\s*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/
var RE_QUOTE = /^\s{0,3}>/
var RE_TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

function isTableStart(lines, i) {
  return i + 1 < lines.length && lines[i].indexOf("|") !== -1 && RE_TABLE_SEP.test(lines[i + 1]) &&
         lines[i + 1].indexOf("-") !== -1 && (lines[i + 1].indexOf("|") !== -1 || lines[i].replace(/^\s*\|/, "").indexOf("|") !== -1)
}

function isBlockStart(lines, i) {
  var l = lines[i]
  return RE_FENCE.test(l) || (RE_HEADING.test(l) && /^\s{0,3}#{1,6}(\s|$)/.test(l)) || RE_HR.test(l) ||
         RE_QUOTE.test(l) || isTableStart(lines, i) || /^\s*\$\$/.test(l) || /^\s*%%\s*$/.test(l)
}

// Splits a table row on unescaped pipes outside code spans.
function splitRow(line) {
  var s = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "")
  var cells = [], cur = "", inCode = false
  for (var i = 0; i < s.length; i++) {
    var c = s[i]
    if (c === "\\" && s[i + 1] === "|") { cur += "\\|"; i++; continue }
    if (c === "`") inCode = !inCode
    if (c === "|" && !inCode) { cells.push(cur); cur = ""; continue }
    cur += c
  }
  cells.push(cur)
  return cells.map(function(x) { return x.replace(/^\s+|\s+$/g, "") })
}

// lines -> [{type, ...}]
function parseBlocks(lines, depth) {
  var out = []
  var para = null
  var i = 0, n = lines.length
  function endPara() { if (para) { out.push({ type: "para", lines: para }); para = null } }

  while (i < n) {
    var line = lines[i]
    var trimmed = line.replace(/^\s+|\s+$/g, "")
    if (!trimmed) { endPara(); i++; continue }

    // %% block comments
    if (/^%%/.test(trimmed) && trimmed.slice(2).indexOf("%%") === -1) {
      endPara()
      i++
      while (i < n && lines[i].indexOf("%%") === -1) i++
      i++
      continue
    }

    var fm = RE_FENCE.exec(line)
    if (fm) {
      endPara()
      var fence = fm[1], body = []
      i++
      while (i < n) {
        var t = lines[i].replace(/^\s+/, "")
        if (t.indexOf(fence[0] === "`" ? "```" : "~~~") === 0 && /^(`+|~+)\s*$/.test(t) && t.replace(/\s+$/, "").length >= fence.length) { i++; break }
        body.push(lines[i])
        i++
      }
      out.push({ type: "code", lang: fm[2].replace(/^\s+|\s+$/g, ""), lines: body })
      continue
    }

    if (/^\$\$/.test(trimmed)) {
      endPara()
      var rest = trimmed.slice(2)
      if (rest.length >= 2 && /\$\$$/.test(rest)) { out.push({ type: "math", text: rest.slice(0, -2) }); i++; continue }
      var mlines = [rest]
      i++
      while (i < n) {
        var ml = lines[i].replace(/\s+$/, "")
        if (/\$\$$/.test(ml)) { mlines.push(ml.replace(/\$\$$/, "")); i++; break }
        mlines.push(ml)
        i++
      }
      out.push({ type: "math", text: mlines.join("\n").replace(/^\s+|\s+$/g, "") })
      continue
    }

    var hm = RE_HEADING.exec(line)
    if (hm && /^\s{0,3}#{1,6}(\s|$)/.test(line)) {
      endPara()
      out.push({ type: "heading", level: hm[1].length, text: hm[2] || "" })
      i++
      continue
    }

    if (RE_HR.test(line) && !(para && /^\s{0,3}-+\s*$/.test(line) && false)) {
      endPara()
      out.push({ type: "hr" })
      i++
      continue
    }

    if (isTableStart(lines, i)) {
      endPara()
      var header = splitRow(lines[i])
      var align = splitRow(lines[i + 1]).map(function(c) {
        var l = c[0] === ":", r = c[c.length - 1] === ":"
        return l && r ? "center" : r ? "right" : "left"
      })
      var rows = []
      i += 2
      while (i < n && lines[i].replace(/^\s+|\s+$/g, "") && lines[i].indexOf("|") !== -1) { rows.push(splitRow(lines[i])); i++ }
      out.push({ type: "table", header: header, align: align, rows: rows })
      continue
    }

    if (RE_QUOTE.test(line)) {
      endPara()
      var q = []
      while (i < n && RE_QUOTE.test(lines[i])) { q.push(lines[i].replace(/^\s{0,3}>\s?/, "")); i++ }
      var callout = null
      var cm = /^\s*\[!([^\]]+)\]([+-]?)\s*(.*)$/.exec(q[0] || "")
      if (cm) {
        callout = { type: cm[1].toLowerCase(), title: cm[3] || (cm[1][0].toUpperCase() + cm[1].slice(1).toLowerCase()) }
        q.shift()
      }
      out.push({ type: "quote", callout: callout,
                 children: depth < MAX_DEPTH ? parseBlocks(q, depth + 1) : [{ type: "para", lines: q }] })
      continue
    }

    var lm = RE_LIST.exec(line)
    if (lm && !(para && /^\d/.test(lm[2]) && false)) {
      endPara()
      var items = []
      var stack = []
      while (i < n) {
        var l2 = lines[i]
        var m2 = RE_LIST.exec(l2)
        if (m2 && !RE_HR.test(l2)) {
          var col = indentOf(l2)
          while (stack.length && col < stack[stack.length - 1]) stack.pop()
          if (!stack.length || col > stack[stack.length - 1]) stack.push(col)
          var text = m2[3] || ""
          var task = null
          var tm = /^\[([ xX\/\-])\]\s+(.*)$/.exec(text) || /^\[([ xX\/\-])\]$/.exec(text)
          if (tm && /^[-*+]$/.test(m2[2])) { task = tm[1] === " " ? "open" : "done"; text = tm[2] || "" }
          items.push({ depth: stack.length - 1, ordered: /^\d/.test(m2[2]), num: parseInt(m2[2], 10) || 0,
                       task: task, lines: [text], col: col })
          i++
          continue
        }
        var tl = l2.replace(/^\s+|\s+$/g, "")
        if (!tl) {
          // A blank line ends the list unless the list goes on after it.
          var j = i + 1
          while (j < n && !lines[j].replace(/^\s+|\s+$/g, "")) j++
          if (j < n && (RE_LIST.exec(lines[j]) && !RE_HR.test(lines[j]) || (indentOf(lines[j]) > items[items.length - 1].col && !isBlockStart(lines, j)))) {
            items[items.length - 1].lines.push("")
            i = j
            continue
          }
          break
        }
        if (isBlockStart(lines, i)) break
        // Continuation (indented, or lazy) of the last item.
        items[items.length - 1].lines.push(l2.replace(/^\s+/, ""))
        i++
      }
      out.push({ type: "list", items: items })
      continue
    }

    if (para && isBlockStart(lines, i)) endPara()
    if (!para) para = []
    para.push(line.replace(/^\s+/, "").replace(/\s+$/, ""))
    i++
  }
  endPara()
  return out
}

// ------------------------------------------------------------------ output

function Out() {
  this.blocks = []
  this.buf = ""
  this.wrappers = []
}
Out.prototype.add = function(html) { this.buf += html }
Out.prototype.media = function(block) {
  var k
  for (k = this.wrappers.length - 1; k >= 0; k--) this.buf += this.wrappers[k].close
  this.flush()
  this.blocks.push(block)
  for (k = 0; k < this.wrappers.length; k++) this.buf += this.wrappers[k].open
}
Out.prototype.flush = function(R) {
  var h = this.buf
  this.buf = ""
  // Drop paragraphs and wrappers left empty by a media split.
  for (var pass = 0; pass < 4; pass++) {
    var before = h
    h = h.replace(/<p [^>]*>(\s|<br>)*<\/p>/g, "")
    for (var k = 0; k < this.allWrappers.length; k++) h = h.split(this.allWrappers[k].open + this.allWrappers[k].close).join("")
    if (h === before) break
  }
  if (!/[^\s]/.test(h.replace(/<(?!hr|table)[^>]*>/g, ""))) return
  this.blocks.push({ kind: "html", html: h })
}

// Paragraph spacing: every block ends with MB_MARK as its bottom margin; the
// last one in an html block gets 0 so the html Text has no trailing gap.
function finishMargins(html, gap) {
  var last = html.lastIndexOf(MB_MARK)
  if (last !== -1) html = html.slice(0, last) + "0" + html.slice(last + 1)
  // A block that ends in a table (code, quote, table): its own margin goes too.
  if (/<\/table>\s*$/.test(html)) {
    var depth = 0, i = html.length
    while (i > 0) {
      var close = html.lastIndexOf("</table>", i - 1), open = html.lastIndexOf("<table", i - 1)
      if (open === -1) break
      if (close > open) { depth++; i = close; continue }
      depth--
      if (depth === 0) {
        var mb = html.indexOf(MB_MARK, open)
        if (mb !== -1 && mb < html.indexOf(">", open)) html = html.slice(0, mb) + "0" + html.slice(mb + 1)
        break
      }
      i = open
    }
  }
  return html.split(MB_MARK).join(String(gap))
}

function pOpen(style) { return '<p style="margin-top:0;margin-bottom:' + MB_MARK + "px;" + (style || "") + '">' }

function emitInline(out, R, src, open, close, reopen) {
  var parts = renderInline(src, R)
  // Line breaks right next to a media split would leave blank lines behind.
  for (var j = 0; j < parts.length; j++) {
    if (!parts[j].media) continue
    if (j > 0 && parts[j - 1].html !== undefined) parts[j - 1].html = parts[j - 1].html.replace(/(\s|<br>)+$/, "")
    if (j + 1 < parts.length && parts[j + 1].html !== undefined) parts[j + 1].html = parts[j + 1].html.replace(/^(\s|<br>)+/, "")
  }
  out.add(open)
  for (var k = 0; k < parts.length; k++) {
    if (parts[k].media) {
      out.add(close)
      out.media(parts[k].media)
      out.add(reopen === undefined ? open : reopen)
    } else out.add(parts[k].html)
  }
  out.add(close)
}

var BULLETS = ["•", "◦", "▪", "‣"]

function renderNodes(nodes, out, R, depth) {
  var P = R.palette, fs = R.fontSize, cw = R.charWidth
  for (var b = 0; b < nodes.length; b++) {
    var node = nodes[b]
    switch (node.type) {
    case "para":
      emitInline(out, R, node.lines.join("\n").replace(/\n/g, "<br>"), pOpen(), "</p>")
      break
    case "heading":
      var scale = [0, 1.45, 1.3, 1.15, 1.05, 1.0, 0.95][node.level]
      var hs = "font-size:" + px(fs * scale) + ";font-weight:bold;" + (b > 0 ? "margin-top:" + px(fs * 0.4) + ";" : "")
      var hopen = '<p style="margin-bottom:' + MB_MARK + "px;" + hs + '">'
      emitInline(out, R, node.text, hopen, "</p>")
      break
    case "hr":
      out.add('<hr style="background-color:' + P.border + '"/>')
      break
    case "code":
      var code = node.lines.join("\n").replace(/\t/g, "    ")
      var codeHtml = escapeHtml(code).replace(/\n/g, "<br>")
      out.add('<table width="100%" cellspacing="0" cellpadding="' + Math.round(fs * 0.45) + '" bgcolor="' + P.codeBg +
              '" style="margin-bottom:' + MB_MARK + 'px"><tr><td><p style="margin:0;white-space:pre-wrap;font-family:' +
              R.fontFamily + ";color:" + P.code + '">' + (codeHtml || "&nbsp;") + "</p></td></tr></table>")
      break
    case "math":
      out.add('<p align="center" style="margin-top:0;margin-bottom:' + MB_MARK + 'px"><span style="color:' + P.code + '">' +
              texToHtml(node.text.replace(/\n/g, " "), true) + "</span></p>")
      break
    case "table":
      var cols = node.header.length
      var pad = Math.round(fs * 0.3)
      var th = '<table border="1" cellspacing="0" cellpadding="' + pad + '" style="border-color:' + P.border +
               ';border-style:solid;border-collapse:collapse;margin-bottom:' + MB_MARK + 'px">'
      var saved = R.mediaAsText
      R.mediaAsText = true
      function cellHtml(src) {
        var parts = renderInline(src.replace(/\\\|/g, "|"), R)
        var h = ""
        for (var q = 0; q < parts.length; q++) h += parts[q].html || ""
        return h
      }
      th += "<tr>"
      for (var c = 0; c < cols; c++)
        th += '<th align="' + (node.align[c] || "left") + '">' + cellHtml(node.header[c]) + "</th>"
      th += "</tr>"
      for (var r = 0; r < node.rows.length; r++) {
        th += "<tr>"
        for (c = 0; c < cols; c++) {
          var cell = node.rows[r][c] === undefined ? "" : node.rows[r][c]
          th += '<td align="' + (node.align[c] || "left") + '">' + cellHtml(cell) + "</td>"
        }
        th += "</tr>"
      }
      th += "</table>"
      R.mediaAsText = saved
      out.add(th)
      break
    case "quote":
      var w = {
        open: '<table width="100%" cellspacing="0" cellpadding="' + Math.round(fs * 0.5) + '" bgcolor="' + P.codeBg +
              '" style="margin-bottom:' + MB_MARK + 'px"><tr><td>',
        close: "</td></tr></table>"
      }
      out.allWrappers.push(w)
      out.add(w.open)
      out.wrappers.push(w)
      if (node.callout) {
        var color = /warn|caution|attention|danger|error|bug|fail|missing/.test(node.callout.type) ? P.cloze
                  : /success|check|done|tip|hint|important/.test(node.callout.type) ? P.clozeAnswer : P.accent
        emitInline(out, R, node.callout.title, pOpen("font-weight:bold;color:" + color), "</p>")
      }
      if (depth < MAX_DEPTH) renderNodes(node.children, out, R, depth + 1)
      out.wrappers.pop()
      out.add(w.close)
      break
    case "list":
      var counters = []
      for (var it = 0; it < node.items.length; it++) {
        var item = node.items[it]
        counters.length = item.depth + 1
        var marker
        if (item.task) marker = item.task === "done" ? "☒" : "☐"
        else if (item.ordered) {
          if (counters[item.depth] === undefined) counters[item.depth] = item.num
          else counters[item.depth]++
          marker = counters[item.depth] + "."
        } else marker = BULLETS[item.depth % BULLETS.length]
        var mw = (marker.length + 1) * cw
        var left = item.depth * 2 * cw + mw
        var lastItem = it === node.items.length - 1
        var base = "margin-top:0;margin-bottom:" + (lastItem ? MB_MARK : "0") + "px;margin-left:" + px(left) + ";"
        var open = '<p style="' + base + "text-indent:-" + px(mw) + '">' +
                   '<span style="color:' + (item.task === "done" ? P.accent : P.muted) + '">' + escapeHtml(marker) + "</span>&nbsp;"
        var reopen = '<p style="' + base + '">'
        var body = item.lines.join("\n").replace(/^\n+|\n+$/g, "").replace(/\n/g, "<br>")
        if (item.task === "done") body = body ? "~~" + body + "~~" : body
        emitInline(out, R, body, open, "</p>", reopen)
      }
      break
    }
  }
}

// ------------------------------------------------------------------ entry

function blocks(text, ctx) {
  ctx = ctx || {}
  var fs = Number(ctx.fontSize) > 0 ? Number(ctx.fontSize) : 16
  var R = {
    palette: makePalette(ctx.palette),
    resolve: typeof ctx.resolve === "function" ? ctx.resolve : null,
    isDrawing: typeof ctx.isDrawing === "function" ? ctx.isDrawing : null,
    fontSize: fs,
    charWidth: Number(ctx.charWidth) > 0 ? Number(ctx.charWidth) : fs * 0.6,
    fontFamily: /^[A-Za-z0-9 _-]{1,80}$/.test(String(ctx.fontFamily || "")) ? String(ctx.fontFamily) : "monospace",
    mediaAsText: false
  }
  var src = String(text === undefined || text === null ? "" : text)
  if (src.length > MAX_INPUT) src = src.slice(0, MAX_INPUT)
  src = src.replace(RESERVED_RE, "\uFFFD").replace(/\r\n?/g, "\n")
  try {
    var nodes = parseBlocks(src.split("\n"), 0)
    var out = new Out()
    out.allWrappers = []
    renderNodes(nodes, out, R, 0)
    out.flush()
    var gap = Math.round(fs * 0.45)
    for (var i = 0; i < out.blocks.length; i++)
      if (out.blocks[i].kind === "html") out.blocks[i].html = finishMargins(out.blocks[i].html, gap)
    return out.blocks
  } catch (e) {
    // Never fail a card over its formatting: show the text as it is.
    var plain = escapeHtml(src.replace(/[\uE000-\uE003]/g, "")).replace(/\n/g, "<br>")
    return plain ? [{ kind: "html", html: '<p style="margin:0">' + plain + "</p>", error: String(e) }] : []
  }
}

// Plain text of a side (for previews, titles and the like).
function plainText(text) {
  return String(text || "")
    .replace(/[\uE000\uE002]/g, "").replace(/[\uE001\uE003]/g, "")
    .replace(/!\[\[[^\]]*\]\]/g, "").replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/[*_~=`#>]+/g, "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "")
}
