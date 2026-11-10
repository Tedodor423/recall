// Unit tests for engine/Markdown.js:   node tests/markdown.test.mjs
import assert from "node:assert/strict"
import { loadQmlJs, Osr } from "./load.mjs"

const Md = loadQmlJs("engine/Markdown.js", ["blocks", "texToHtml", "cssColor", "escapeHtml", "plainText", "renderInline"])

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++ } catch (e) { failed++; console.log("FAIL " + name + "\n  " + String(e.stack || e.message).split("\n").slice(0, 12).join("\n  ")) }
}

const files = {
  "img.png": "/v/Files/attachments/img.png",
  "Pasted image 1.png": "/v/Files/attachments/Pasted image 1.png",
  "Note 202401011200": "/v/Files/excalidraw/Note 202401011200.md",
  "Other note": "/v/Notes/Other note.md",
  "doc.pdf": "/v/Files/attachments/doc.pdf",
  "a/b.jpg": "/v/a/b.jpg",
}
const ctx = { resolve: (n) => files[n] || "", fontSize: 10, charWidth: 6 }
const B = (t, c = ctx) => Md.blocks(t, c)
const H = (t, c = ctx) => B(t, c).filter((b) => b.kind === "html").map((b) => b.html).join("\n")
const ASK = (s) => "\uE000" + s + "\uE001"
const ANS = (s) => "\uE002" + s + "\uE003"

// Every "<" in the output must start one of the tags the renderer emits.
const OWN_TAG = /<\/?(p|span|b|i|u|s|sub|sup|small|br|hr|table|tr|td|th)(\s[^<>]*)?\/?>/g
function assertSafe(html) {
  const rest = html.replace(OWN_TAG, "")
  assert.ok(!/[<>]/.test(rest), "stray < or > in: " + html)
  assert.ok(!/[\uE000-\uE0FF]/.test(html), "private-use marker left in: " + JSON.stringify(html))
  for (const tag of html.match(OWN_TAG) || []) assert.ok(!/src=|href=|url\(/i.test(tag), "resource reference in: " + tag)
  assert.ok(!/<img/i.test(html))
}

// ------------------------------------------------------------------ basics
test("empty and plain", () => {
  assert.deepEqual(B(""), [])
  assert.deepEqual(B("   \n\n"), [])
  const b = B("Hello world")
  assert.equal(b.length, 1)
  assert.equal(b[0].kind, "html")
  assert.match(b[0].html, /Hello world/)
  assert.match(b[0].html, /^<p style="margin-top:0;margin-bottom:0px;">/)
})

test("escaping", () => {
  const h = H("a < b && c > d \"q\" <script>alert(1)</script> <img src=x> <-> <= 6/6")
  assertSafe(h)
  assert.match(h, /a &lt; b &amp;&amp; c &gt; d &quot;q&quot;/)
  assert.match(h, /&lt;script&gt;/)
  assert.match(h, /&lt;img src=x&gt;/)
  assert.match(h, /&lt;-&gt; &lt;= 6\/6/)
})

test("line breaks and paragraphs", () => {
  const h = H("one\ntwo\n\nthree")
  assert.match(h, /one<br>two<\/p>/)
  assert.equal((h.match(/<p /g) || []).length, 2)
  // margins: all but the last paragraph get the gap
  assert.match(h, /margin-bottom:5px;">one/)
  assert.match(h, /margin-bottom:0px;">three/)
})

test("headings", () => {
  const h = H("### Résumé\ntext")
  assert.match(h, /font-size:12px;font-weight:bold;">Résumé<\/p>/)
  assert.match(h, /text<\/p>/)
  assert.ok(!/#/.test(h.replace(/#[0-9a-f]{6}/g, "")))
  assert.match(H("# Big"), /font-size:15px/)
  // a tag is not a heading
  assert.match(H("#tag text"), /color:#808890">#tag<\/span> text/)
})

test("emphasis", () => {
  const h = H("**bold** *it* __b2__ _i2_ ***bi*** ~~gone~~ ==hl== snake_case_name 2 * 3 * 4")
  assert.match(h, /<b>bold<\/b>/)
  assert.match(h, /<i>it<\/i>/)
  assert.match(h, /<b>b2<\/b>/)
  assert.match(h, /<i>i2<\/i>/)
  assert.match(h, /<b><i>bi<\/i><\/b>/)
  assert.match(h, /<s>gone<\/s>/)
  assert.match(h, /<span style="background-color:rgba\(224,175,104,0.35\)">hl<\/span>/)
  assert.match(h, /snake_case_name/)
  assert.match(h, /2 \* 3 \* 4/)
  assertSafe(h)
})

test("escapes", () => {
  const h = H("6,6\\*10^-34 J\\*s and \\[short RNA] \\=x \\#notatag")
  assert.match(h, /6,6\*10\^-34 J\*s/)
  assert.match(h, /\[short RNA\]/)
  assert.match(h, /=x/)
  assert.match(h, /#notatag/)
  assert.ok(!/color:#808890">#notatag/.test(h))
})

test("inline code is literal", () => {
  const h = H("use `a **b** <c> $x$` here")
  assert.match(h, /<span style="color:#c0caf5;background-color:#1f2326">a \*\*b\*\* &lt;c&gt; \$x\$<\/span>/)
  assertSafe(h)
})

test("inline html whitelist", () => {
  const h = H("H<sub>2</sub>O x<sup>2</sup> <u>u</u> <mark>m</mark> <span style=\"x\">no</span> <b>unclosed")
  assert.match(h, /H<sub>2<\/sub>O x<sup>2<\/sup> <u>u<\/u>/)
  assert.match(h, /<span style="background-color:[^"]+">m<\/span>/)
  assert.match(h, /&lt;span style=&quot;x&quot;&gt;no&lt;\/span&gt;/)
  assert.match(h, /<b>unclosed<\/b><\/p>/)
  assertSafe(h)
  assert.match(H("a<br>b<br/>c<br />d"), /a<br>b<br>c<br>d/)
  // stray closing tags are dropped
  assert.ok(!/<\/b>/.test(H("x </b> y")))
})

test("comments are hidden", () => {
  const h = H("a %%hidden%% b <!-- also --> c")
  assert.ok(!/hidden|also/.test(h))
  assert.ok(!/secret/.test(H("before\n%%\nsecret\n%%\nafter")))
  assert.match(H("before\n%%\nsecret\n%%\nafter"), /after/)
})

// ------------------------------------------------------------------ clozes
test("cloze markers", () => {
  const front = H("The pump moves " + ASK("[...]") + " ions per cycle")
  assert.match(front, /<span style="color:#e0af68;font-weight:bold">\[\.\.\.\]<\/span>/)
  assertSafe(front)
  const back = H("The pump moves " + ANS("3") + " ions per cycle")
  assert.match(back, /<span style="color:#9ece6a;font-weight:bold">3<\/span>/)
  const hint = H("x " + ASK("[hint]"))
  assert.match(hint, /\[hint\]/)
  // markdown inside the answer
  assert.match(H(ANS("**bold** ans")), /font-weight:bold"><b>bold<\/b> ans<\/span>/)
  // escaped before a marker (\===Answer== in a note)
  const esc = H("value<br>\\" + ASK("[...]"))
  assert.ok(!/\\/.test(esc))
  assert.match(H("\\" + ANS("=Answer")), />=Answer<\/span>/)
  // unbalanced markers never leave a span open
  const bad = H("a \uE000 b")
  assert.equal((bad.match(/<span/g) || []).length, (bad.match(/<\/span>/g) || []).length)
  assert.ok(!/[\uE000-\uE003]/.test(H("\uE001 stray close")))
})

test("cloze from the engine", () => {
  const s = Osr.settingsFrom({})
  const cards = Osr.expand(Osr.CardType.Cloze, "The ==mitochondria== is the ==powerhouse== of the cell", s, new Osr.ClozeCrafter(s.clozePatterns))
  assert.equal(cards.length, 2)
  const f = H(cards[0].front), b = H(cards[0].back)
  assert.match(f, /\[\.\.\.\]<\/span> is the powerhouse/)
  assert.match(b, />mitochondria<\/span> is the powerhouse/)
  assertSafe(f); assertSafe(b)
})

// ------------------------------------------------------------------ lists
test("bullet lists, nesting with tabs and spaces", () => {
  const h = H("- a\n\t- b\n\t\t- c\n  - d\n- e")
  const items = h.match(/<p [^>]*>.*?<\/p>/g)
  assert.equal(items.length, 5)
  assert.match(items[0], /margin-left:12px;text-indent:-12px">.*•<\/span>&nbsp;a/)
  assert.match(items[1], /margin-left:24px;.*◦<\/span>&nbsp;b/)
  assert.match(items[2], /margin-left:36px;.*▪<\/span>&nbsp;c/)
  assert.match(items[3], /margin-left:24px;.*◦<\/span>&nbsp;d/)
  assert.match(items[4], /margin-left:12px;.*•<\/span>&nbsp;e/)
  // only the last item gets a bottom margin (0 here, as the last block)
  assert.equal((h.match(/margin-bottom:0px/g) || []).length, 5)
})

test("list starting indented", () => {
  const h = H("\t- deep first\n- top\n\t- child")
  const items = h.match(/<p [^>]*>.*?<\/p>/g)
  assert.equal(items.length, 3)
  assert.match(items[0], /margin-left:12px/)
  assert.match(items[1], /margin-left:12px/)
  assert.match(items[2], /margin-left:24px/)
})

test("ordered lists number like Obsidian", () => {
  const h = H("1. one\n\t- sub\n1. two\n2. three\n\n5. five\n6. six")
  assert.match(h, /1\.<\/span>&nbsp;one/)
  assert.match(h, /2\.<\/span>&nbsp;two/)
  assert.match(h, /3\.<\/span>&nbsp;three/)
  // a blank line between items keeps one (loose) list: CommonMark numbers on
  assert.match(h, /4\.<\/span>&nbsp;five/)
  assert.match(h, /5\.<\/span>&nbsp;six/)
  // a new list after a paragraph starts at its own number
  assert.match(H("1. a\n\npara\n\n5. five"), /5\.<\/span>&nbsp;five/)
})

test("task lists", () => {
  const h = H("- [ ] todo\n- [x] done")
  assert.match(h, /☐<\/span>&nbsp;todo/)
  assert.match(h, /☒<\/span>&nbsp;<s>done<\/s>/)
})

test("list continuation and paragraph before list", () => {
  const h = H("intro line\n- item\n  continued\n- **b** \\[x]")
  assert.match(h, /intro line<\/p>/)
  assert.match(h, /item<br>continued/)
  assert.match(h, /<b>b<\/b> \[x\]/)
})

test("hr is not a list", () => {
  const h = H("- a\n---\nb")
  assert.match(h, /<hr style="background-color:#4a5058"\/>/)
  assert.match(h, /b<\/p>/)
  assert.match(H("***"), /<hr/)
})

// ------------------------------------------------------------------ blocks
test("fenced code", () => {
  const h = H("```js\nlet a = 1 < 2\n  **x**\n```\nafter")
  assert.match(h, /<table width="100%"[^>]*bgcolor="#1f2326"/)
  assert.match(h, /let a = 1 &lt; 2<br>  \*\*x\*\*/)
  assert.match(h, /white-space:pre-wrap/)
  assert.match(h, /after<\/p>/)
  // unterminated fence runs to the end
  assert.match(H("```\nopen"), /open/)
})

test("tables", () => {
  const t = "| ítem | Left<br>\\" + ASK("[...]") + " | Right |\n| --- | :---: | ---: |\n| one | 10 g | 20 g |\n| two | 3,5-4,5 g |"
  const h = H(t)
  assert.match(h, /<table border="1" cellspacing="0" cellpadding="3"/)
  assert.match(h, /<th align="left">ítem<\/th>/)
  assert.match(h, /<th align="center">Left<br><span[^>]*>\[\.\.\.\]<\/span><\/th>/)
  assert.match(h, /<th align="right">Right<\/th>/)
  assert.match(h, /<td align="left">two<\/td><td align="center">3,5-4,5 g<\/td><td align="right"><\/td>/)
  assertSafe(h)
  // pipes inside code and escaped pipes stay in the cell
  const h2 = H("a | b\n--|--\n`x|y` | c \\| d")
  assert.match(h2, /x\|y<\/span><\/td><td align="left">c \| d<\/td>/)
})

test("blockquotes and callouts", () => {
  const h = H("> quoted **text**\n> - item\n\nafter")
  assert.match(h, /<table width="100%" cellspacing="0" cellpadding="5" bgcolor="#1f2326"[^>]*><tr><td>/)
  assert.match(h, /quoted <b>text<\/b>/)
  assert.match(h, /•<\/span>&nbsp;item/)
  assert.match(h, /<\/td><\/tr><\/table><p[^>]*>after/)
  const c = H("> [!warning] Careful\n> body")
  assert.match(c, /font-weight:bold;color:#e0af68">Careful<\/p>/)
  const c2 = H("> [!note]\n> body")
  assert.match(c2, />Note<\/p>/)
})

test("math", () => {
  const h = H("$U_{mem}=\\frac{59mV}{1}*pH$ and $x^2$ costs $5 and $10")
  assert.match(h, /U<sub>mem<\/sub>=\(59mV\)\/1\*pH/)
  assert.match(h, /x<sup>2<\/sup>/)
  assert.match(h, /costs \$5 and \$10/)
  const m2 = H("$H_2O+CO_2 \\Leftrightarrow H^+ + HCO_3^- \\rightarrow \\Delta$")
  assert.match(m2, /H<sub>2<\/sub>O\+CO<sub>2<\/sub> ⇔ H<sup>\+<\/sup> \+ HCO<sub>3<\/sub><sup>-<\/sup> → Δ/)
  const d = H("$$\n\\sqrt{a^2+b^2} \\leq c\n$$")
  assert.match(d, /<p align="center"[^>]*><span style="color:#c0caf5">√\(a<sup>2<\/sup>\+b<sup>2<\/sup>\) ≤ c<\/span><\/p>/)
  assertSafe(Md.texToHtml("\\frac{<a>}{b} \\unknown{x} \\left( x \\right.", false))
  assert.match(Md.texToHtml("\\text{if } x < 1", false), /if  x &lt; 1/)
  assert.match(H("$$a=b$$"), /align="center"/)
})

test("links and wikilinks", () => {
  const h = H("see [[Other note|alias]] and [[Other note#Section]] and [label](https://x.eu/a_b) <https://raw>")
  assert.match(h, /color:#7aa2f7">alias<\/span>/)
  assert.match(h, /color:#7aa2f7">Other note › Section<\/span>/)
  assert.match(h, /color:#7aa2f7;text-decoration:underline">label<\/span>/)
  assert.ok(!/https:\/\/x\.eu/.test(h))
  assertSafe(h)
})

test("footnotes and block ids", () => {
  const h = H("claim[^1] text ^abc-123")
  assert.match(h, /claim<sup>1<\/sup> text<\/p>/)
})

// ------------------------------------------------------------------ media
test("image embeds", () => {
  const b = B("![[img.png|300]]")
  assert.deepEqual(b, [{ kind: "image", path: "/v/Files/attachments/img.png", width: 300 }])
  const b2 = B("text before![[Pasted image 1.png]] after")
  assert.equal(b2.length, 3)
  assert.match(b2[0].html, /text before<\/p>/)
  assert.deepEqual(b2[1], { kind: "image", path: "/v/Files/attachments/Pasted image 1.png", width: 0 })
  assert.match(b2[2].html, /^<p[^>]*>after<\/p>$/)
  // markdown image, sized via alt, url-encoded
  assert.deepEqual(B("![x|200](a/b.jpg)"), [{ kind: "image", path: "/v/a/b.jpg", width: 200 }])
  // remote images are never loaded
  assert.deepEqual(B("![logo](https://example.com/x.png)"), [{ kind: "file", name: "logo", path: "" }])
  // missing image -> chip
  assert.deepEqual(B("![[nope.png]]"), [{ kind: "file", name: "nope.png", path: "" }])
})

test("drawings, notes and files", () => {
  assert.deepEqual(B("![[Note 202401011200|200]]"), [{ kind: "drawing", path: "/v/Files/excalidraw/Note 202401011200.md" }])
  assert.deepEqual(B("![[Other note]]"), [{ kind: "file", name: "Other note", path: "/v/Notes/Other note.md" }])
  assert.deepEqual(B("![[Other note#Part]]"), [{ kind: "file", name: "Other note › Part", path: "/v/Notes/Other note.md" }])
  assert.deepEqual(B("![[doc.pdf#page=3]]"), [{ kind: "file", name: "doc.pdf · page 3", path: "/v/Files/attachments/doc.pdf" }])
  // isDrawing override
  const c = { ...ctx, isDrawing: (p) => p.endsWith("Other note.md") }
  assert.equal(B("![[Other note]]", c)[0].kind, "drawing")
  // resolver that throws is survived
  assert.equal(B("![[img.png]]", { resolve: () => { throw new Error("x") } })[0].kind, "file")
})

test("media inside lists keep the list going", () => {
  const b = B("- a\n\t- b![[img.png]]\n\t- c")
  assert.equal(b.length, 3)
  assert.match(b[0].html, /a<\/p>.*b<\/p>$/)
  assert.equal(b[1].kind, "image")
  assert.match(b[2].html, /margin-left:24px;text-indent:-12px">.*◦<\/span>&nbsp;c/)
})

test("media inside quotes split the quote", () => {
  const b = B("> before\n> ![[img.png]]\n> after")
  assert.equal(b.length, 3)
  assert.match(b[0].html, /^<table[^>]*><tr><td><p[^>]*>before<\/p><\/td><\/tr><\/table>$/)
  assert.equal(b[1].kind, "image")
  assert.match(b[2].html, /^<table[^>]*><tr><td><p[^>]*>after<\/p><\/td><\/tr><\/table>$/)
})

test("media in tables become labels", () => {
  const h = H("a | b\n-|-\n![[img.png]] | x")
  assert.match(h, /\[image: img\.png\]/)
})

// ------------------------------------------------------------------ palette
test("palette colors", () => {
  assert.equal(Md.cssColor({ r: 1, g: 0.5, b: 0, a: 1 }, "x"), "#ff8000")
  assert.equal(Md.cssColor({ r: 1, g: 0, b: 0, a: 0.5 }, "x"), "rgba(255,0,0,0.5)")
  assert.equal(Md.cssColor("#abc", "x"), "#aabbcc")
  assert.equal(Md.cssColor("#80ff0000", "x"), "rgba(255,0,0,0.502)")
  assert.equal(Md.cssColor("red", "x"), "red")
  assert.equal(Md.cssColor('red;"><b', "x"), "x")
  assert.equal(Md.cssColor(null, "x"), "x")
  const h = H("**x** " + ASK("[...]"), { palette: { cloze: "#123456", text: { r: 0, g: 0, b: 0, a: 1 } } })
  assert.match(h, /color:#123456/)
})

test("robust against hostile input", () => {
  const weird = ["\uE010\uE011\uE012\uE013", "<<<>>>", "`", "``", "$", "$$", "[[", "]]", "![[", "| a |\n|--|", ">", "- ", "1.", "#", "\\", "**", "==", "~~~", "> > > > > > > > > > deep", "\t\t\t\t- x", "a".repeat(5000), "[".repeat(2000) + "]".repeat(2000), "$" + "\\frac{".repeat(50) + "$"]
  for (const w of weird) {
    const b = B(w)
    for (const x of b) if (x.kind === "html") { assertSafe(x.html); assert.ok(!x.error, "fell back for " + JSON.stringify(w.slice(0, 40)) + ": " + x.error) }
  }
  assert.equal(Md.plainText("**a** " + ASK("[...]") + " [[x|y]]"), "a [...] y")
})

test("speed", () => {
  const big = Array.from({ length: 200 }, (_, i) => `- item **${i}** with ==hl== and $x_${i}$ and \`code\``).join("\n")
  const t0 = Date.now()
  for (let i = 0; i < 20; i++) B(big)
  assert.ok(Date.now() - t0 < 2000, "too slow: " + (Date.now() - t0) + " ms")
})

console.log(`markdown: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
