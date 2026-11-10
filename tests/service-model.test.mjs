// Unit tests for ServiceModel.js (Service.qml's pure helpers):
//   node tests/service-model.test.mjs [testVault]
// Note and deck expectations are written against the committed fixture vault.
// A vault given as the argument or in $RECALL_TEST_VAULT gets generic checks too.
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { loadQmlJs, Osr, FIXTURE_VAULT, REAL_VAULT } from "./load.mjs"

const M = loadQmlJs("ServiceModel.js", [
  "PAUSE_FOREVER", "normalizeConfig", "deckKey", "deckTag", "cleanFolder", "inQuietHours", "isFullscreenWindow",
  "formatCountdown", "shortCountdown", "reviewDays", "streak", "dayKey", "tailDeck", "planAdd", "uniquePath",
  "withEmbed", "annotateStartLines", "openBlockAtEnd", "utf8Length", "reviewBudget", "formatMoment", "drawingTarget", "embedName", "assetIndex", "resolveLink", "safeName", "validMode"
])
const OTHER_VAULT = process.argv[2] || REAL_VAULT

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++ } catch (e) { failed++; console.log("FAIL " + name + "\n  " + String(e.stack || e.message).split("\n").slice(0, 8).join("\n  ")) }
}
const eq = (a, b) => assert.deepStrictEqual(a, b)

test("config defaults and normalisation", () => {
  const c = M.normalizeConfig({}, "/home/u", null)
  eq(c.vault, "/home/u/obsidian")
  eq([c.enabled, c.intervalMinutes, c.cardsPerPopup, c.decks, c.tags, c.skipWhenFullscreen, c.strict], [true, 5, 1, [], null, true, false])
  eq(c.quietHours, { enabled: false, start: "22:00", end: "08:00" })
  eq(c.newNoteFolder, "01 - Main")
  const d = M.normalizeConfig({
    vault: "~/v", enabled: "false", intervalMinutes: "0", cardsPerPopup: 3.4, decks: ["#a/b", "c/"], tags: ["flashnotes"],
    quietHours: { enabled: true, start: "7:5", end: "6:30" }, lastDeck: "x/y", lastNoteByDeck: { "#x/y": "n.md", bad: 3 },
    newNoteFolder: "/Inbox/", pausedUntil: "12"
  }, "/h", { newFileFolderPath: "Elsewhere" })
  eq(d.vault, "/h/v")
  eq([d.enabled, d.intervalMinutes, d.cardsPerPopup], [false, 1, 3])
  eq(d.decks, ["a/b", "c"])
  eq(d.tags, ["#flashnotes"])
  eq(d.quietHours, { enabled: true, start: "22:00", end: "06:30" })
  eq(d.lastDeck, "#x/y")
  eq(d.lastNoteByDeck, { "x/y": "n.md" })
  eq(d.newNoteFolder, "Inbox")
  eq(d.pausedUntil, 12)
  eq(M.normalizeConfig({}, "/h", { newFileFolderPath: "Notes/New" }).newNoteFolder, "Notes/New")
  eq(M.normalizeConfig({ newNoteFolder: "../x" }, "/h", null).newNoteFolder, "01 - Main")
  eq(M.validMode("stats"), "stats")
  eq(M.validMode("bogus"), "review")
})

test("quiet hours, fullscreen, countdowns", () => {
  const q = { enabled: true, start: "22:00", end: "08:00" }
  const at = (h, m) => new Date(2026, 10, 2, h, m)
  eq([M.inQuietHours(q, at(23, 0)), M.inQuietHours(q, at(7, 59)), M.inQuietHours(q, at(8, 0)), M.inQuietHours(q, at(12, 0))], [true, true, false, false])
  const day = { enabled: true, start: "12:00", end: "13:00" }
  eq([M.inQuietHours(day, at(12, 30)), M.inQuietHours(day, at(13, 0))], [true, false])
  eq(M.inQuietHours({ ...q, enabled: false }, at(23, 0)), false)
  eq([0, 1, 2, 3, true, false].map((f) => M.isFullscreenWindow({ fullscreen: f })), [false, false, true, true, true, false])
  eq(M.isFullscreenWindow(null), false)
  eq([M.formatCountdown(0), M.formatCountdown(61000), M.formatCountdown(3725000)], ["00:00", "01:01", "1:02:05"])
  eq([M.shortCountdown(45000), M.shortCountdown(61000), M.shortCountdown(3600000), M.shortCountdown(5400000)], ["45s", "2m", "1h", "1h30"])
})

test("review days and streaks", () => {
  const now = new Date(2026, 10, 2, 10).getTime()
  const day = (n) => new Date(2026, 10, 2 - n, 9).getTime()
  const text = [0, 1, 1, 2, 4].map((n) => JSON.stringify({ ts: day(n) })).join("\n") + "\nnot json\n"
  const days = M.reviewDays(text)
  eq(days[M.dayKey(day(1))], 2)
  eq(M.streak(days, now), 3)
  const noToday = M.reviewDays([1, 2].map((n) => JSON.stringify({ ts: day(n) })).join("\n"))
  eq(M.streak(noToday, now), 2)
  eq(M.streak({}, now), 0)
})

test("moment format and Excalidraw drawing names", () => {
  const d = new Date(2026, 10, 2, 9, 5, 7)
  eq(M.formatMoment("YYYYMMDDHHmm", d), "202611020905")
  eq(M.formatMoment("YYYY-MM-DD HH.mm.ss [at] h", d), "2026-11-02 09.05.07 at 9")
  const exc = { folder: "Files/excalidraw", embedUseExcalidrawFolder: true, drawingFilenamePrefix: "ED-",
    drawingEmbedPrefixWithFilename: true, drawingFilnameEmbedPostfix: " ", drawingFilenameDateTime: "YYYYMMDDHHmm", useExcalidrawExtension: false }
  const t = M.drawingTarget(exc, {}, "Notes/x/Biology flashnotes.md", d)
  eq(t, { folder: "Files/excalidraw", base: "Biology flashnotes 202611020905", ext: ".md" })
  const taken = { ["files/excalidraw/biology flashnotes 202611020905.md"]: true }
  eq(M.uniquePath(t.folder, t.base, t.ext, taken), "Files/excalidraw/Biology flashnotes 202611020905 1.md")
  eq(M.embedName("Files/excalidraw/Biology flashnotes 202611020905 1.md"), "Biology flashnotes 202611020905 1")
  const t2 = M.drawingTarget({ ...exc, embedUseExcalidrawFolder: false, useExcalidrawExtension: true }, { attachmentFolderPath: "./att" }, "A/n.md", d)
  eq(t2, { folder: "A/att", base: "n 202611020905", ext: ".excalidraw.md" })
  eq(M.embedName("A/att/n 202611020905.excalidraw.md"), "n 202611020905.excalidraw")
  eq(M.withEmbed("Front text\n", "pic 1"), "Front text\n![[pic 1]]")
  eq(M.withEmbed("", "pic 1"), "![[pic 1]]")
  eq(M.safeName('a:b/c?d#e[f]'), "a_b_c_d_e_f_")
})

function loadVault(VAULT = FIXTURE_VAULT) {
  const data = JSON.parse(readFileSync(join(VAULT, ".obsidian/plugins/obsidian-spaced-repetition/data.json"), "utf8"))
  const settings = Osr.settingsFrom(data)
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else files.push(relative(VAULT, p))
    }
  }
  walk(VAULT)
  const md = files.filter((p) => p.endsWith(".md")).map((p) => ({ path: p, text: readFileSync(join(VAULT, p), "utf8") }))
  const index = Osr.buildIndex(md, settings, Date.now())
  const texts = Object.fromEntries(md.map((f) => [f.path, f.text]))
  index.notes.forEach((n) => { n.tailDeck = M.tailDeck(Osr, n.path, texts[n.path], settings) })
  return { settings, index, files, texts }
}

test("tail deck of the fixture vault notes", () => {
  const { index } = loadVault()
  const tails = Object.fromEntries(index.notes.map((n) => [n.path.split("/").pop(), n.tailDeck]))
  eq(tails["Biology flashnotes.md"], "flashnotes/bio/genetics")
  eq(tails["Physics flashnotes.md"], "flashnotes/phys")
  eq(tails["Vocabulary.md"], "flashcards/lang/spanish")
  // A note that ends inside an open fence cannot take an appended card.
  const s = Osr.settingsFrom({ settings: { flashcardTags: ["#flashnotes"] } })
  eq(M.tailDeck(Osr, "x.md", "#flashnotes/a\n\nQ::A\n```\nopen fence", s), "")
  eq(M.tailDeck(Osr, "x.md", "---\ntags: flashnotes/fm\n---\nQ::A\n", s), "flashnotes/fm")
  eq(M.tailDeck(Osr, "x.md", "#flashnotes/a\n\nQ::A\n\n#flashnotes/b\n\nQ2::A2\n", s), "flashnotes/b")
})

test("open blocks at the end of a note are detected; such notes never take cards", () => {
  const cases = [
    ["a\n```\ncode", "code"], ["a\n```js\nx\n```\n", ""], ["~~~~\nx\n~~~\n", "code"], ["x\n%% hidden", "comment"],
    ["x %%a%% y", ""], ["$$\nE=mc^2", "math"], ["$$x$$\n", ""], ["<!-- note", "html"], ["<!-- a --> b", ""],
    ["`%%` inline code", ""], ["```\n%% inside code\n```\n", ""], ["%%\n```\n%%\n", ""], ["Q::A\n\n", ""]
  ]
  for (const [t, want] of cases) eq([t, M.openBlockAtEnd(t)], [t, want])
  const s = Osr.settingsFrom({ settings: { flashcardTags: ["#flashnotes"] } })
  for (const tail of ["\n%%\nlater", "\n$$\nx^2", "\n```\ncode", "\n~~~\ncode"])
    eq(M.tailDeck(Osr, "x.md", "#flashnotes/a\n\nQ::A\n" + tail, s), "")
  eq(M.tailDeck(Osr, "x.md", "#flashnotes/a\n\nQ::A\n%%c%%\n", s), "flashnotes/a")
  // planAdd skips notes without a tail deck (Service only offers those).
  const notes = [{ path: "a.md", tailDeck: "", questions: [] }]
  eq(M.planAdd(notes.filter((n) => n.tailDeck), "flashnotes/a", { "flashnotes/a": "a.md" }, "Notes", {}).createsNote, true)
})

test("utf8 length and review budget", () => {
  for (const t of ["", "abc", "čřžýáíé Ž", "🧠 emoji\r\n", "\u0000x", "příliš žluťoučký kůň\n".repeat(500)])
    eq(M.utf8Length(t), Buffer.byteLength(t, "utf8"))
  eq(M.utf8Length("a\ud800b"), Buffer.byteLength("a\ud800b", "utf8"))   // lone surrogate -> U+FFFD
  eq([M.reviewBudget("short"), M.reviewBudget("x".repeat(10000)), M.reviewBudget("x".repeat(100000))], [4096, 12048, 65536])
})

test("question start lines skip the parser's firstLine quirk", () => {
  const s = Osr.settingsFrom({ settings: { flashcardTags: ["#flashnotes"] } })
  const text = "#flashnotes/a\n\nQ1::A1\nmore ==cloze== text\n<!--SR:!2024-01-01,3,250-->\n"
  const n = Osr.parseNote("x.md", text, s)
  M.annotateStartLines(Osr, n, text)
  eq(n.questions.map((q) => [q.firstLine, q.startLine]), [[2, 2], [2, 3]])
})

test("planAdd: last note, exact deck, ancestor with tag, new note", () => {
  const { index, files } = loadVault()
  const taken = Object.fromEntries(files.map((p) => [p.toLowerCase(), true]))
  const notes = index.notes.filter((n) => n.tailDeck)
  const bio = "Notes/Biology flashnotes.md"
  const exact = M.planAdd(notes, "#flashnotes/bio/genetics", {}, "Notes", taken)
  eq(exact, { notePath: bio, noteTitle: "Biology flashnotes", cardTag: "", createsNote: false, error: "" })
  const child = M.planAdd(notes, "flashnotes/bio/genetics/mendel", {}, "Notes", taken)
  eq([child.notePath, child.cardTag, child.createsNote], [bio, "#flashnotes/bio/genetics/mendel", false])
  const other = "Notes/Chemistry flashnotes.md"
  const last = M.planAdd(notes, "flashnotes/bio/genetics", { "flashnotes/bio/genetics": other }, "Notes", taken)
  eq([last.notePath, last.cardTag], [other, "#flashnotes/bio/genetics"])
  const stale = M.planAdd(notes, "flashnotes/bio/genetics", { "flashnotes/bio/genetics": "gone.md" }, "Notes", taken)
  eq(stale.notePath, bio)
  const fresh = M.planAdd(notes, "#flashnotes/new/Astro deck", {}, "Notes", taken)
  eq(fresh, { notePath: "Notes/Astro deck.md", noteTitle: "Astro deck", cardTag: "", createsNote: true, error: "" })
  const clash = M.planAdd(notes, "#flashnotes/new/astro deck", {}, "Notes", { "notes/astro deck.md": true })
  eq(clash.notePath, "Notes/astro deck 1.md")
  eq(M.planAdd(notes, "", {}, "Notes", taken).error, "Pick a deck")
})

test("embed resolution like Obsidian", () => {
  const { files } = loadVault()
  const idx = M.assetIndex(files)
  const from = "Notes/Biology flashnotes.md"
  const png = "Files/attachments/Pasted image 20260101120000.png"
  eq(M.resolveLink(idx, "Biology flashnotes 202601151030", from), "Files/excalidraw/Biology flashnotes 202601151030.md")
  eq(M.resolveLink(idx, "Pasted image 20260101120000.png|300", from), png)
  eq(M.resolveLink(idx, "pasted IMAGE 20260101120000.png", from), png)
  eq(M.resolveLink(idx, png, from), png)
  eq(M.resolveLink(idx, "attachments/Pasted image 20260101120000.png", from), png)
  eq(M.resolveLink(idx, "Chemistry flashnotes#Bonds", from), "Notes/Chemistry flashnotes.md")
  eq(M.resolveLink(idx, "missing.png", from), "")
  eq(M.resolveLink(idx, "", from), "")
  // Same-folder preference.
  const two = M.assetIndex(["a/x.png", "b/c/x.png", "b/c/note.md"])
  eq(M.resolveLink(two, "x.png", "b/c/note.md"), "b/c/x.png")
  eq(M.resolveLink(two, "x.png", "z.md"), "a/x.png")
})

if (OTHER_VAULT) test("another vault: every file resolves by path, every note takes cards at its own tail deck", () => {
  const { index, files } = loadVault(OTHER_VAULT)
  const idx = M.assetIndex(files)
  for (const p of files) eq(M.resolveLink(idx, p, "x.md"), p)
  const taken = Object.fromEntries(files.map((p) => [p.toLowerCase(), true]))
  const notes = index.notes.filter((n) => n.tailDeck)
  assert.ok(notes.length > 0, "no flashcard notes in " + OTHER_VAULT)
  for (const n of notes) {
    const r = M.planAdd(notes, n.tailDeck, { [n.tailDeck]: n.path }, "Inbox", taken)
    eq([r.notePath, r.cardTag, r.createsNote, r.error], [n.path, "", false, ""])
  }
})

console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
