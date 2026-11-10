// Unit tests for engine/Osr.js:   node tests/osr.test.mjs
// Parser and scheduling expectations are transcribed from the Obsidian Spaced
// Repetition plugin's own suite (tests/unit/parser.test.ts and
// scheduling.test.ts at tag 1.14.2, MIT) so the port is held to upstream.
import assert from "node:assert/strict"
import { Osr } from "./load.mjs"

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++ } catch (e) { failed++; console.log("FAIL " + name + "\n  " + String(e.message).split("\n").slice(0, 14).join("\n  ")) }
}
const T = Osr.CardType
const R = Osr.Response
const opts = {
  singleLineCardSeparator: "::", singleLineReversedCardSeparator: ":::",
  multilineCardSeparator: "?", multilineReversedCardSeparator: "??", multilineCardEndMarker: "",
  clozePatterns: ["==[123;;]answer[;;hint]==", "**[123;;]answer[;;hint]**", "{{[123;;]answer[;;hint]}}"],
}
const P = (text, o = opts) => Osr.parse(text, o).map((p) => [p.type, p.text, p.firstLine, p.lastLine])
const eq = (a, b) => assert.deepStrictEqual(a, b)

// ------------------------------------------------------------- parser (upstream cases)
test("single line basic", () => {
  eq(P("Question::Answer"), [[T.SingleLineBasic, "Question::Answer", 0, 0]])
  eq(P("Question::Answer\n<!--SR:!2021-08-11,4,270-->"), [[T.SingleLineBasic, "Question::Answer\n<!--SR:!2021-08-11,4,270-->", 0, 1]])
  eq(P("Question::Answer <!--SR:2021-08-11,4,270-->"), [[T.SingleLineBasic, "Question::Answer <!--SR:2021-08-11,4,270-->", 0, 0]])
  eq(P("Some text before\nQuestion ::Answer"), [[T.SingleLineBasic, "Question ::Answer", 1, 1]])
  eq(P("#Title\n\nQ1::A1\nQ2:: A2"), [[T.SingleLineBasic, "Q1::A1", 2, 2], [T.SingleLineBasic, "Q2:: A2", 3, 3]])
  eq(P("#flashcards/science Question ::Answer"), [[T.SingleLineBasic, "#flashcards/science Question ::Answer", 0, 0]])
  eq(P("Question&&Answer", { ...opts, singleLineCardSeparator: "&&", multilineCardEndMarker: "---", clozePatterns: [] }), [[T.SingleLineBasic, "Question&&Answer", 0, 0]])
})
test("single line reversed", () => {
  eq(P("Question:::Answer"), [[T.SingleLineReversed, "Question:::Answer", 0, 0]])
  eq(P("Question:::Answer\n<!--SR:!2021-08-11,4,270!2021-08-11,4,270-->"), [[T.SingleLineReversed, "Question:::Answer\n<!--SR:!2021-08-11,4,270!2021-08-11,4,270-->", 0, 1]])
})
test("multi line basic", () => {
  eq(P("Question\n?\nAnswer"), [[T.MultiLineBasic, "Question\n?\nAnswer", 0, 2]])
  eq(P("Question\n? \nAnswer"), [[T.MultiLineBasic, "Question\n?\nAnswer", 0, 2]])
  eq(P("Question\n?\nAnswer <!--SR:!2021-08-11,4,270-->"), [[T.MultiLineBasic, "Question\n?\nAnswer <!--SR:!2021-08-11,4,270-->", 0, 2]])
  eq(P("Question\n?\nAnswer\n<!--SR:2021-08-11,4,270-->"), [[T.MultiLineBasic, "Question\n?\nAnswer\n<!--SR:2021-08-11,4,270-->", 0, 3]])
  eq(P("#Title\n\nLine0\nQ1\n?\nA1\nAnswerExtra\n\nQ2\n?\nA2"), [[T.MultiLineBasic, "Line0\nQ1\n?\nA1\nAnswerExtra", 2, 6], [T.MultiLineBasic, "Q2\n?\nA2", 8, 10]])
  eq(P("#flashcards/tag-on-previous-line\nQuestion\n?\nAnswer"), [[T.MultiLineBasic, "#flashcards/tag-on-previous-line\nQuestion\n?\nAnswer", 0, 3]])
  const em = { ...opts, multilineCardEndMarker: "---", clozePatterns: ["**[123;;]answer[;;hint]**"] }
  eq(P("Question\n?\nAnswer line 1\nAnswer line 2\n\n---", em), [[T.MultiLineBasic, "Question\n?\nAnswer line 1\nAnswer line 2", 0, 4]])
  eq(P("Question 1\n?\nAnswer line 1\nAnswer line 2\n\n---\nQuestion with empty line after question mark\n?\n\nAnswer line 1\nAnswer line 2\n---\n", em),
    [[T.MultiLineBasic, "Question 1\n?\nAnswer line 1\nAnswer line 2", 0, 4],
     [T.MultiLineBasic, "Question with empty line after question mark\n?\n\nAnswer line 1\nAnswer line 2", 6, 10]])
  eq(P("Question\n@@\nAnswer\n\nsfdg", { ...opts, multilineCardSeparator: "@@", clozePatterns: [] }), [[T.MultiLineBasic, "Question\n@@\nAnswer", 0, 2]])
  eq(P("Question\n?\nAnswer", { ...opts, multilineCardSeparator: "", multilineCardEndMarker: "---", clozePatterns: [] }), [])
})
test("cloze", () => {
  eq(P("cloze ==deletion== test"), [[T.Cloze, "cloze ==deletion== test", 0, 0]])
  eq(P("cloze ==deletion== test <!--SR:2021-08-11,4,270-->"), [[T.Cloze, "cloze ==deletion== test <!--SR:2021-08-11,4,270-->", 0, 0]])
  eq(P("==this== is a ==deletion==\n"), [[T.Cloze, "==this== is a ==deletion==", 0, 0]])
  eq(P("some text before\n\na deletion on\nsuch ==wow==\n\nmany text\nsuch surprise ==wow== more ==text==\nsome text after\n\nHmm"),
    [[T.Cloze, "a deletion on\nsuch ==wow==", 2, 3], [T.Cloze, "many text\nsuch surprise ==wow== more ==text==\nsome text after", 5, 7]])
  eq(P("srdf =="), [])
  eq(P("lorem ipsum ==p\ndolor won=="), [])
  eq(P("lorem ipsum ==dolor won="), [])
  eq(P("cloze ==deletion== test", { ...opts, clozePatterns: ["**[123;;]answer[;;hint]**", "{{[123;;]answer[;;hint]}}"] }), [])
  eq(P("cloze **deletion** test"), [[T.Cloze, "cloze **deletion** test", 0, 0]])
})
test("mix of card types", () => {
  eq(P("# Lorem Ipsum\n\nLorem ipsum dolor ==sit amet==, consectetur ==adipiscing== elit.\nDuis magna arcu, eleifend rhoncus ==euismod non,==\nlaoreet vitae enim.\n\nFusce placerat::velit in pharetra gravida\n\nDonec dapibus ullamcorper aliquam.\n??\nDonec dapibus ullamcorper aliquam.\n<!--SR:2021-08-11,4,270-->"),
    [[T.Cloze, "Lorem ipsum dolor ==sit amet==, consectetur ==adipiscing== elit.\nDuis magna arcu, eleifend rhoncus ==euismod non,==\nlaoreet vitae enim.", 2, 4],
     [T.SingleLineBasic, "Fusce placerat::velit in pharetra gravida", 6, 6],
     [T.MultiLineReversed, "Donec dapibus ullamcorper aliquam.\n??\nDonec dapibus ullamcorper aliquam.\n<!--SR:2021-08-11,4,270-->", 8, 11]])
})
test("code blocks", () => {
  eq(P("my inline question containing `some inline code` in it::and this is answer possibly containing `inline` code."),
    [[T.SingleLineBasic, "my inline question containing `some inline code` in it::and this is answer possibly containing `inline` code.", 0, 0]])
  eq(P("this has some ==`inline`== code"), [[T.Cloze, "this has some ==`inline`== code", 0, 0]])
  eq(P("How do you ... Python?\n?\n```python\nprint('Hello World!')\n\n\nprint('Howdy?')\n\nlambda x: x[0]\n```"),
    [[T.MultiLineBasic, "How do you ... Python?\n?\n```python\nprint('Hello World!')\n\n\nprint('Howdy?')\n\nlambda x: x[0]\n```", 0, 9]])
  eq(P("```\nCodeblockq::CodeblockA\n```"), [])
})
test("html comments", () => {
  eq(P("<!--question::answer test-->"), [])
  eq(P("<!--\nQuestion\n?\nAnswer <!--SR:!2021-08-11,4,270-->\n-->"), [])
  eq(P("something something\n<!--cloze {{curly}} test-->"), [])
  eq(P("something something\n\n<!--cloze {{curly}} test-->\n\na::b"), [[T.SingleLineBasic, "a::b", 4, 4]])
})

// ------------------------------------------------------------- scheduling (upstream cases)
const S = Osr.DEFAULT_SETTINGS
const empty = {}
test("osrSchedule default settings", () => {
  eq(Osr.osrSchedule(R.Easy, 1, S.baseEase, 0, S, empty), { ease: S.baseEase + 20, interval: 4 })
  eq(Osr.osrSchedule(R.Good, 1, S.baseEase, 0, S, empty), { ease: S.baseEase, interval: 3 })
  eq(Osr.osrSchedule(R.Hard, 1, S.baseEase, 0, S, empty), { ease: S.baseEase - 20, interval: 1 })
})
test("osrSchedule with delay", () => {
  const delay = 2 * 24 * 3600 * 1000
  eq(Osr.osrSchedule(R.Easy, 10, S.baseEase, delay, S, empty), { ease: S.baseEase + 20, interval: 42 })
  eq(Osr.osrSchedule(R.Good, 10, S.baseEase, delay, S, empty), { ease: S.baseEase, interval: 28 })
  eq(Osr.osrSchedule(R.Hard, 10, S.baseEase, delay, S, empty), { ease: S.baseEase - 20, interval: 5 })
})
test("load balancing", () => {
  eq(Osr.osrSchedule(R.Good, 1, S.baseEase, 0, S, { 0: 1, 1: 1, 2: 1, 3: 4 }), { ease: S.baseEase, interval: 3 })
  eq(Osr.osrSchedule(R.Good, 2, S.baseEase, 0, S, { 5: 2 }), { ease: S.baseEase, interval: 5 })
  eq(Osr.osrSchedule(R.Good, 7, S.baseEase, 0, S, { 17: 4, 18: 5, 19: 3 }), { ease: S.baseEase, interval: 19 })
  eq(Osr.osrSchedule(R.Good, 10, S.baseEase, 0, S, { 23: 5, 26: 1 }), { ease: S.baseEase, interval: 25 })
  eq(Osr.osrSchedule(R.Good, 25, S.baseEase, 0, S, { 2: 5, 59: 8, 60: 9, 61: 3, 62: 5, 63: 4, 64: 4, 65: 8, 66: 2, 67: 10 }), { ease: S.baseEase, interval: 66 })
  eq(Osr.osrSchedule(R.Good, 500, S.baseEase, 0, S, { 1245: 7, 1246: 4, 1247: 2, 1248: 9, 1249: 5, 1250: 4, 1251: 1, 1252: 1, 1254: 1 }), { ease: S.baseEase, interval: 1253 })
})
test("again", () => {
  eq(Osr.osrSchedule(R.Again, 20, 250, 0, S, empty), { ease: 230, interval: 0 })
  eq(Osr.osrSchedule(R.Again, 20, 140, 0, S, empty), { ease: 130, interval: 0 })
})
test("textInterval", () => {
  eq(Osr.textInterval(1), "1 day")
  eq(Osr.textInterval(41), "1.3 months")
  eq(Osr.textInterval(366), "1 years")
  eq(Osr.textInterval(undefined), "New")
})

// ------------------------------------------------------------- notes, clozes, rewriting
const userSettings = Osr.settingsFrom({ settings: {
  flashcardTags: ["#flashnotes"], singleLineCardSeparator: "::", singleLineReversedCardSeparator: ":::",
  multilineCardSeparator: ";;", multilineReversedCardSeparator: ";;;", clozePatterns: ["==[123;;]answer[;;hint]=="],
  baseEase: 250, cardCommentOnSameLine: false } })

test("cloze expansion: simple highlights make one card each", () => {
  const n = Osr.parseNote("a.md", "#flashnotes/x\n\nThe ==mitochondria== is the ==powerhouse==\n", userSettings)
  eq(n.questions.length, 1)
  const c = n.questions[0].cards
  eq(c.length, 2)
  eq(c[0].front, "The [...] is the powerhouse")
  eq(c[0].back, "The mitochondria is the powerhouse")
  eq(c[1].front, "The mitochondria is the [...]")
})
test("cloze expansion: classic numbering groups and hints", () => {
  const n = Osr.parseNote("a.md", "#flashnotes/x\n\n==1;;A== and ==1;;B== then ==2;;C;;letter==\n", userSettings)
  const c = n.questions[0].cards
  eq(c.length, 2)
  eq(c[0].front, "[...] and [...] then C")
  eq(c[1].front, "A and B then [letter]")
})
test("deck assignment: note tag, later tag, card tag, frontmatter", () => {
  const text = "---\ntags: [flashnotes/fm]\n---\nQ0::A0\n#flashnotes/one\nQ1::A1\n\n#flashnotes/two\n\nQ2::A2\n#flashnotes/three Q3::A3\n"
  const n = Osr.parseNote("a.md", text, userSettings)
  eq(n.questions.map((q) => q.decks.map((d) => d.join("/"))), [["flashnotes/fm"], ["flashnotes/one"], ["flashnotes/two"], ["flashnotes/three"]])
})
test("notes without a flashcard tag are skipped", () => {
  eq(Osr.parseNote("a.md", "#flashcards/x\nQ::A\n", userSettings), null)
})
test("formatQuestion moves a same-line comment to its own line (cardCommentOnSameLine false)", () => {
  const n = Osr.parseNote("a.md", "#flashnotes/x\n\nQ::A <!--SR:!2024-12-17,24,270-->\n", userSettings)
  eq(Osr.formatQuestion(n.questions[0], userSettings), "Q::A\n<!--SR:!2024-12-17,24,270-->")
})
test("formatQuestion fills unscheduled siblings with the placeholder", () => {
  const n = Osr.parseNote("a.md", "#flashnotes/x\n\nQ:::A\n<!--SR:!2024-12-17,24,270-->\n", userSettings)
  eq(Osr.formatQuestion(n.questions[0], userSettings), "Q:::A\n<!--SR:!2024-12-17,24,270!2000-01-01,1,250-->")
})
test("applyReview edits only the target card, also right after a single-line card", () => {
  const text = "#flashnotes/x\n\nhead::tail <!--SR:!2024-11-28,4,279-->\nline two of a cloze ==gap==\nlast line\n\nafter::card\n"
  const n = Osr.parseNote("a.md", text, userSettings)
  const cloze = n.questions.find((q) => q.type === T.Cloze)
  assert.ok(cloze)
  const sched = { dueMs: new Date(2026, 10, 5).getTime(), interval: 3, ease: 250 }
  const r = Osr.applyReview(text, "a.md", userSettings, { original: cloze.original, firstLine: cloze.firstLine, cardIdx: 0 }, sched)
  eq(r.ok, true)
  eq(r.text, "#flashnotes/x\n\nhead::tail <!--SR:!2024-11-28,4,279-->\nline two of a cloze ==gap==\nlast line\n<!--SR:!2026-11-05,3,250-->\n\nafter::card\n")
})
test("applyReview keeps CRLF line endings", () => {
  const text = "#flashnotes/x\r\n\r\nQ::A\r\nnext\r\n"
  const n = Osr.parseNote("a.md", text, userSettings)
  const q = n.questions[0]
  const r = Osr.applyReview(text, "a.md", userSettings, { original: q.original, firstLine: q.firstLine, cardIdx: 0 }, { dueMs: new Date(2026, 0, 2).getTime(), interval: 1, ease: 250 })
  eq(r.text, "#flashnotes/x\r\n\r\nQ::A\r\n<!--SR:!2026-01-02,1,250-->\r\nnext\r\n")
})
test("applyReview refuses when the card text changed", () => {
  const text = "#flashnotes/x\n\nQ::A\n"
  const r = Osr.applyReview(text, "a.md", userSettings, { original: "Q::B", firstLine: 2, cardIdx: 0 }, { dueMs: 0, interval: 1, ease: 250 })
  eq(r.ok, false)
})
test("applyReview follows a card that moved down", () => {
  const before = "#flashnotes/x\n\nQ::A\n"
  const after = "#flashnotes/x\n\nnew::card\n\nQ::A\n"
  const r = Osr.applyReview(after, "a.md", userSettings, { original: "Q::A", firstLine: 2, cardIdx: 0 }, { dueMs: new Date(2026, 0, 2).getTime(), interval: 1, ease: 250 })
  eq(r.ok, true)
  eq(r.text, "#flashnotes/x\n\nnew::card\n\nQ::A\n<!--SR:!2026-01-02,1,250-->\n")
  void before
})
test("nextSchedule: new card Good uses the note's average ease", () => {
  const now = new Date(2026, 10, 2, 14, 0).getTime()
  const n = Osr.parseNote("a.md", "#flashnotes/x\n\nQ::A\n", userSettings)
  const s = Osr.nextSchedule(n.questions[0].cards[0], n, R.Good, userSettings, now, {})
  eq(Osr.formatDate(s.dueMs), "2026-11-05")
  eq([s.interval, s.ease], [3, 250])
})
test("nextSchedule: due card Again -> due today, interval 0", () => {
  const now = new Date(2026, 10, 2, 14, 0).getTime()
  const n = Osr.parseNote("a.md", "#flashnotes/x\n\nQ::A\n<!--SR:!2026-11-01,10,250-->\n", userSettings)
  const s = Osr.nextSchedule(n.questions[0].cards[0], n, R.Again, userSettings, now, {})
  eq([Osr.formatDate(s.dueMs), s.interval, s.ease], ["2026-11-02", 0, 230])
})
test("new card formatting round-trips through the parser", () => {
  const single = Osr.formatNewCard("What is ATP?", "energy currency", userSettings, {})
  eq(single, "What is ATP?::energy currency")
  eq(Osr.validateNewCard(single, userSettings, false), "")
  const multi = Osr.formatNewCard("Draw the Krebs cycle\n![[x 202611021200]]", "Answer\n\nwith gap", userSettings, { cardTag: "#flashnotes/bio/new", reversed: true })
  eq(multi, "#flashnotes/bio/new Draw the Krebs cycle\n![[x 202611021200]]\n;;;\nAnswer\nwith gap")
  eq(Osr.validateNewCard(multi, userSettings, true), "")
  assert.notEqual(Osr.validateNewCard(Osr.formatNewCard("a::b", "c", userSettings, {}), userSettings, false, "a::b", "c"), "")
  eq(Osr.validateNewCard(single, userSettings, false, "What is ATP?", "energy currency"), "")
  // a second ";;" line in the back is harmless: the plugin splits at the first one
  eq(Osr.validateNewCard(Osr.formatNewCard("x", "y\n;;\nz", userSettings, {}), userSettings, false, "x", "y\n;;\nz"), "")
  assert.notEqual(Osr.validateNewCard(Osr.formatNewCard("x\n;;\ny", "z", userSettings, {}), userSettings, false, "x\n;;\ny", "z"), "")
  const appended = Osr.appendCard("#flashnotes/x\n\nQ::A\n\n\n", single)
  eq(appended, "#flashnotes/x\n\nQ::A\n\nWhat is ATP?::energy currency\n")
  const n = Osr.parseNote("a.md", appended, userSettings)
  eq(n.questions.length, 2)
})
test("appendCard keeps the last line's trailing whitespace", () => {
  eq(Osr.appendCard("#flashnotes/x\n\t- \n\n", "Q::A"), "#flashnotes/x\n\t- \n\nQ::A\n")
  eq(Osr.appendCard("#flashnotes/x\n\t- ", "Q::A"), "#flashnotes/x\n\t- \n\nQ::A\n")
  eq(Osr.appendCard("a\r\nb\r\n\r\n", "Q::A"), "a\r\nb\r\n\r\nQ::A\r\n")
  eq(Osr.appendCard("", "Q::A"), "Q::A\n")
})
test("malformed SR comments are read-only, never rewritten", () => {
  for (const bad of ["!2024-01-01,3,", "!2024-01-01", "!2024-13-01,300,290", "!2024-01-01,,250"]) {
    const text = "#flashnotes/x\n\nQ::A\n<!--SR:" + bad + "-->\n"
    const n = Osr.parseNote("a.md", text, userSettings)
    assert.ok(n.questions[0].cards[0].schedule.invalid, bad)
    const e = Osr.cardEntries({ notes: [n] }, userSettings, Date.now())
    eq(e[0].state, "invalid")
    eq(Osr.pickNext(e, [], {}), null)
    const r = Osr.applyReview(text, "a.md", userSettings, { original: n.questions[0].original, firstLine: 2, cardIdx: 0 }, { dueMs: new Date(2026, 0, 2).getTime(), interval: 1, ease: 250 })
    eq(r.ok, false)
  }
})
test("invalid computed schedules are refused", () => {
  const text = "#flashnotes/x\n\nQ::A\n"
  for (const sc of [{ dueMs: NaN, interval: 1, ease: 250 }, { dueMs: Date.now(), interval: NaN, ease: 250 }, { dueMs: Date.now(), interval: 1, ease: 100 }, { dueMs: Date.now(), interval: 1.5, ease: 250 }])
    eq(Osr.applyReview(text, "a.md", userSettings, { original: "Q::A", firstLine: 2, cardIdx: 0 }, sc).ok, false)
})
test("mixed line endings: only the card's own lines change", () => {
  const text = "#flashnotes/x\n\nfirst::one\r\nQ::A\nlast\n"
  const n = Osr.parseNote("a.md", text, userSettings)
  const q = n.questions.find((x) => x.original === "Q::A")
  const r = Osr.applyReview(text, "a.md", userSettings, { original: q.original, firstLine: q.firstLine, cardIdx: 0 }, { dueMs: new Date(2026, 0, 2).getTime(), interval: 1, ease: 250 })
  eq(r.text, "#flashnotes/x\n\nfirst::one\r\nQ::A\n<!--SR:!2026-01-02,1,250-->\nlast\n")
})
test("BOM before frontmatter is still frontmatter", () => {
  const text = "﻿---\nsource:: Wikipedia\ntags: [flashnotes/x]\n---\nQ::A\n"
  const n = Osr.parseNote("a.md", text, userSettings)
  eq(n.questions.map((q) => q.original), ["Q::A"])
  eq(n.questions[0].decks.map((d) => d.join("/")), ["flashnotes/x"])
})
test("#edit-later cards are not offered", () => {
  const n = Osr.parseNote("a.md", "#flashnotes/x\n\nQ::A #edit-later\n", userSettings)
  const e = Osr.cardEntries({ notes: [n] }, userSettings, Date.now())
  eq(e[0].state, "editLater")
  eq(Osr.pickNext(e, [], {}), null)
})
test("a card with text after its comment is refused (the rewrite would split it)", () => {
  const text = "#flashnotes/x\n\nQ\n;;\nA1\n<!--SR:!2024-01-01,3,250-->\nA2\n"
  const n = Osr.parseNote("a.md", text, userSettings)
  const q = n.questions[0]
  const r = Osr.applyReview(text, "a.md", userSettings, { original: q.original, firstLine: q.firstLine, cardIdx: 0 }, { dueMs: new Date(2026, 0, 2).getTime(), interval: 1, ease: 250 })
  eq(r.ok, false)
  assert.match(r.error, /can't be updated safely/)
})
test("card keys stay unique after the stale-firstLine quirk", () => {
  const n = Osr.parseNote("a.md", "#flashnotes/x\nhead::tail\nline two ==gap==\n", userSettings)
  const keys = Osr.cardEntries({ notes: [n] }, userSettings, Date.now()).map((e) => e.key)
  eq(new Set(keys).size, keys.length)
})
test("new cards keep blank lines inside fenced code", () => {
  const c = Osr.formatNewCard("Q", "```\ncode\n\nmore\n```\n\nafter", userSettings, {})
  eq(c, "Q\n;;\n```\ncode\n\nmore\n```\nafter")
  eq(Osr.validateNewCard(c, userSettings, false, "Q", "```\ncode\n\nmore\n```\n\nafter"), "")
})
test("todayMs honours the plugin's day-boundary quirk", () => {
  const now = new Date(2026, 10, 2, 3, 0, 0).getTime()
  eq(Osr.formatDate(Osr.todayMs(now, { startOfDay: "00:00:00" })), "2026-11-02")
  eq(Osr.formatDate(Osr.todayMs(now, { startOfDay: "04:30:15" })), "2026-11-01")
  eq(Osr.formatDate(Osr.todayMs(now, { startOfDay: "04:00:00" })), "2026-11-02")  // upstream ignores it unless h, m, s are all non-zero
})

console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
