// Tests for helper/recall-io:   node tests/helper.test.mjs [testVault]
// The vault is the argument, else $RECALL_TEST_VAULT, else the committed fixture
// vault. Works on a temporary copy (never the vault itself) with a temporary
// state dir, so backups and logs land in the copy too.
import assert from "node:assert/strict"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, readdirSync, statSync, mkdirSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Osr, testVault } from "./load.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const HELPER = join(here, "..", "helper", "recall-io")
// Expectations below are computed from the copy itself, so any vault with both
// plugins' settings works.
const SOURCE = testVault(process.argv[2])
const PY = existsSync("/usr/bin/python3") ? "/usr/bin/python3" : "python3"
const HAVE_RG = spawnSync("rg", ["--version"]).status === 0

const work = mkdtempSync(join(process.env.RECALL_TEST_TMP || process.env.TMPDIR || tmpdir(), "recall-helper-"))
const vault = join(work, "vault")
const state = join(work, "state")
cpSync(SOURCE, vault, { recursive: true })

function run(args, input, extraEnv) {
  const p = spawnSync(PY, ["-I", HELPER, ...args, "--state-dir", state], {
    input: input === undefined ? "" : input, env: { ...process.env, ...(extraEnv || {}) }, maxBuffer: 1 << 28
  })
  const out = p.stdout.toString("utf8")
  let json
  try { json = JSON.parse(out) } catch (e) { throw new Error("helper printed no JSON (exit " + p.status + "): " + out + p.stderr) }
  return { status: p.status, json }
}
const sha = (buf) => createHash("sha256").update(buf).digest("hex")
const md5 = (buf) => createHash("md5").update(buf).digest("hex")
const bytes = (x) => Buffer.isBuffer(x) ? x : Buffer.from(String(x), "utf8")
// write/create with the integrity arguments the service sends.
function write(path, expectSha, text, extra) {
  const b = bytes(text)
  return run(["write", "--vault", vault, "--path", path, "--expect-sha", expectSha, "--length", String(b.length), "--md5", md5(b),
    ...(extra || ["--max-change", "65536"])], b)
}
function create(path, text, extra) {
  const b = bytes(text)
  return run(["create", "--vault", vault, "--path", path, "--length", String(b.length), "--md5", md5(b), ...(extra || [])], b)
}
const fileSha = (p) => sha(readFileSync(join(vault, p)))
const backupsOf = (rel) => {
  const out = []
  const root = join(state, "backups")
  if (!existsSync(root)) return out
  const dirRel = dirname(rel) === "." ? "" : dirname(rel), base = rel.split("/").pop().slice(0, -3)
  for (const day of readdirSync(root).sort()) {
    const d = join(root, day, dirRel)
    if (!existsSync(d)) continue
    const names = readdirSync(d).filter((n) => new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\.\\d{6}(-\\d+)?\\.md$").test(n))
    const key = (n) => { const m = /\.(\d{6})(?:-(\d+))?\.md$/.exec(n); return m[1] + String(+(m[2] || 0)).padStart(6, "0") }
    names.sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0)).forEach((n) => out.push(join(d, n)))
  }
  return out
}
const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") }

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++ } catch (e) { failed++; console.log("FAIL " + name + "\n  " + String(e.stack || e.message).split("\n").slice(0, 8).join("\n  ")) }
}

const SR_JSON = ".obsidian/plugins/obsidian-spaced-repetition/data.json"
const jsonOf = (rel) => JSON.parse(readFileSync(join(vault, rel), "utf8"))
function vaultFiles(dir = vault, rel = "", out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue
    const p = join(dir, name), r = rel ? rel + "/" + name : name
    if (statSync(p).isDirectory()) vaultFiles(p, r, out)
    else out.push(r)
  }
  return out
}
// The notes under test, picked from the copy: NOTE has a #flashnotes tag and a
// scheduled card, NOTE2 is only under the vault's other tag.
const initialMd = vaultFiles().filter((p) => p.endsWith(".md")).map((p) => ({ path: p, text: readFileSync(join(vault, p), "utf8") }))
const textOfNote = (p) => initialMd.find((f) => f.path === p).text
const initialNotes = Osr.buildIndex(initialMd, Osr.settingsFrom(jsonOf(SR_JSON)), Date.now()).notes
const NOTE = initialNotes.find((n) => /#flashnotes/i.test(textOfNote(n.path)) && n.questions.some((q) => q.cards.some((c) => c.schedule))).path
const NOTE2 = initialNotes.find((n) => !/flashnotes/i.test(textOfNote(n.path))).path
const DIR = NOTE.split("/")[0]                // a real folder of the vault
const DIR_CASE = DIR === DIR.toLowerCase() ? DIR.toUpperCase() : DIR.toLowerCase()
const ASSET = vaultFiles().find((p) => p.endsWith(".png"))

test("scan finds the flashcard notes with rg and with the Python fallback", () => {
  const a = run(["scan", "--vault", vault]).json
  const b = run(["scan", "--vault", vault, "--no-rg"]).json
  assert.equal(a.ok, true)
  assert.equal(a.rg, HAVE_RG)
  assert.equal(b.rg, false)
  assert.deepEqual(a.files.map((f) => f.path), b.files.map((f) => f.path))
  // Independent count: every non-hidden .md file mentioning a tag's text.
  const srTags = JSON.parse(readFileSync(join(vault, ".obsidian/plugins/obsidian-spaced-repetition/data.json"), "utf8")).settings.flashcardTags
  const needles = srTags.map((t) => t.replace(/^#/, "").toLowerCase())
  const expected = []
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue
      const p = join(dir, name), r = rel ? rel + "/" + name : name
      if (statSync(p).isDirectory()) walk(p, r)
      else if (name.endsWith(".md") && needles.some((n) => readFileSync(p, "utf8").toLowerCase().includes(n))) expected.push(r)
    }
  }
  walk(vault, "")
  assert.ok(expected.length > 0)
  assert.deepEqual(a.files.map((f) => f.path).sort(), expected.sort())
  assert.deepEqual(a.tags, srTags)
  for (const f of a.files) {
    const buf = readFileSync(join(vault, f.path))
    assert.equal(f.sha, sha(buf), f.path)
    assert.equal(f.text, buf.toString("utf8"))
  }
  assert.ok(ASSET && a.assets.includes(ASSET), "an image in the vault is listed: " + ASSET)
  assert.ok(!a.assets.some((p) => p.split("/").some((c) => c.startsWith("."))), "no hidden assets")
  assert.equal(a.excalidraw.folder, jsonOf(".obsidian/plugins/obsidian-excalidraw-plugin/data.json").folder)
  assert.equal(a.app.newFileFolderPath, jsonOf(".obsidian/app.json").newFileFolderPath)
  assert.ok(a.sr.settings.flashcardTags.length)
  // Same index as one built from every .md file read directly (what
  // tests/vault-roundtrip.mjs does): the tag prefilter loses no note.
  const settings = Osr.settingsFrom(a.sr)
  const all = []
  const walkAll = (dir, rel) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue
      const p = join(dir, name), r = rel ? rel + "/" + name : name
      if (statSync(p).isDirectory()) walkAll(p, r)
      else if (name.endsWith(".md")) all.push({ path: r, text: readFileSync(p, "utf8") })
    }
  }
  walkAll(vault, "")
  const now = Date.now()
  const qs = (idx) => idx.notes.map((n) => n.path + ":" + n.questions.length).sort()
  assert.deepEqual(qs(Osr.buildIndex(a.files, settings, now)), qs(Osr.buildIndex(all, settings, now)))
})

test("scan --tag overrides SR's tags; frontmatter tags without # are found", () => {
  writeFileSync(join(vault, "fm-only.md"), "---\ntags: [flashnotes/fm]\n---\nQ::A\n")
  const r = run(["scan", "--vault", vault, "--tag", "#flashnotes"]).json
  assert.ok(r.files.some((f) => f.path === "fm-only.md"))
  assert.ok(!r.files.some((f) => f.path === NOTE2), "notes only under another tag are left out")
  rmSync(join(vault, "fm-only.md"))
})

test("read returns text, sha and mtime; reads allowed plugin settings only", () => {
  const r = run(["read", "--vault", vault, "--path", NOTE]).json
  const buf = readFileSync(join(vault, NOTE))
  assert.equal(r.ok, true)
  assert.equal(r.text, buf.toString("utf8"))
  assert.equal(r.sha, sha(buf))
  assert.ok(Math.abs(r.mtime - statSync(join(vault, NOTE)).mtimeMs) < 2)
  assert.equal(run(["read", "--vault", vault, "--path", ".obsidian/app.json"]).json.ok, true)
  assert.equal(run(["read", "--vault", vault, "--path", ".obsidian/plugins/obsidian-spaced-repetition/data.json"]).json.ok, true)
  assert.equal(run(["read", "--vault", vault, "--path", ".obsidian/workspace.json"]).json.error, "path-refused")
  assert.equal(run(["read", "--vault", vault, "--path", "nope.md"]).json.error, "not-found")
})

test("path confinement: escapes, absolute, hidden, symlinks are refused", () => {
  writeFileSync(join(work, "outside.md"), "outside\n")
  symlinkSync(join(work, "outside.md"), join(vault, "link.md"))
  symlinkSync(work, join(vault, "linkdir"))
  const bad = ["../outside.md", DIR + "/../../outside.md", "/etc/passwd", "./x.md", "a//b.md",
    ".obsidian/app.json/../../outside.md", "link.md", "linkdir/outside.md", ".trash/x.md", DIR + "/.hidden.md", "a\\b.md"]
  for (const p of bad) {
    for (const r of [run(["read", "--vault", vault, "--path", p]), write(p, "0", "x\n"), create(p, "x\n")]) {
      assert.equal(r.status, 0, p)
      assert.equal(r.json.ok, false, p)
      assert.ok(["path-refused", "not-found"].includes(r.json.error), p + ": " + r.json.error)
    }
  }
  assert.equal(readFileSync(join(work, "outside.md"), "utf8"), "outside\n")
  assert.ok(!existsSync(join(work, "x.md")))
  // Symlinked notes are not scanned either.
  writeFileSync(join(work, "outside.md"), "#flashnotes\nQ::A\n")
  const s = run(["scan", "--vault", vault]).json
  assert.ok(!s.files.some((f) => f.path === "link.md" || f.path.startsWith("linkdir/")))
  assert.ok(!s.assets.some((p) => p === "link.md" || p.startsWith("linkdir/")))
  rmSync(join(vault, "link.md")); rmSync(join(vault, "linkdir"))
  // Only .md files can be written.
  assert.equal(create("x.png", "x").json.error, "path-refused")
})

test("write refuses on sha mismatch and leaves the file alone", () => {
  const before = readFileSync(join(vault, NOTE))
  const r = write(NOTE, sha(Buffer.from("other")), "clobber\n")
  assert.equal(r.json.ok, false)
  assert.equal(r.json.error, "conflict")
  assert.equal(r.json.sha, sha(before))
  assert.deepEqual(readFileSync(join(vault, NOTE)), before)
  assert.ok(!existsSync(join(state, "backups")), "no backup for a refused write")
})

test("input integrity: a short or altered feed is never written", () => {
  // A >64 KiB note reviewed, then fed cut at the pipe boundary (the reviewer's trunc case).
  const p = "big.md"
  const lines = ["#flashcards/x", ""]
  for (let i = 0; i < 3000; i++) lines.push("slovíčko číslo " + i + "::překlad číslo " + i)
  writeFileSync(join(vault, p), lines.join("\n") + "\n")
  const before = readFileSync(join(vault, p))
  const full = Buffer.from(before.toString("utf8").replace("překlad číslo 2999", "překlad číslo 2999\n<!--SR:!2030-01-01,3,250-->"), "utf8")
  let cut = full.subarray(0, 65536)
  cut = cut.subarray(0, cut.lastIndexOf(10) + 1)
  // Declared as the full text, received cut: refused on length.
  let r = run(["write", "--vault", vault, "--path", p, "--expect-sha", sha(before), "--length", String(full.length), "--md5", md5(full), "--max-change", "65536"], cut)
  assert.equal(r.json.error, "bad-input")
  // Same length, different bytes: refused on md5.
  const tampered = Buffer.from(full); tampered[100] ^= 1
  r = run(["write", "--vault", vault, "--path", p, "--expect-sha", sha(before), "--length", String(full.length), "--md5", md5(full), "--max-change", "65536"], tampered)
  assert.equal(r.json.error, "bad-input")
  assert.deepEqual(readFileSync(join(vault, p)), before)
  // Even a consistent but truncated text is caught by the change budget.
  r = write(p, sha(before), cut)
  assert.equal(r.json.error, "too-big-change")
  assert.deepEqual(readFileSync(join(vault, p)), before)
  // The intended review goes through.
  r = write(p, sha(before), full)
  assert.equal(r.json.ok, true, r.json.message)
  assert.deepEqual(readFileSync(join(vault, p)), full)
  // create checks too.
  const nb = Buffer.from("#flashnotes/n\n\nQ::A\n")
  r = run(["create", "--vault", vault, "--path", "n-int.md", "--length", String(nb.length + 1), "--md5", md5(nb)], nb)
  assert.equal(r.json.error, "bad-input")
  assert.ok(!existsSync(join(vault, "n-int.md")))
  rmSync(join(vault, p))
})

test("write needs a change mode; --max-change and --append-only are enforced", () => {
  const p = "modes.md"
  const base = "#flashcards/x\n\nQ1::A1\n\nQ2::A2\n\t- keep \n\n\n"
  writeFileSync(join(vault, p), base)
  const b = Buffer.from(base + "x")
  let r = run(["write", "--vault", vault, "--path", p, "--expect-sha", fileSha(p), "--length", String(b.length), "--md5", md5(b)], b)
  assert.equal(r.status, 2); assert.equal(r.json.error, "usage")
  r = run(["write", "--vault", vault, "--path", p, "--expect-sha", fileSha(p), "--length", String(b.length), "--md5", md5(b), "--append-only", "--max-change", "10"], b)
  assert.equal(r.status, 2); assert.equal(r.json.error, "usage")
  // A small note replaced by anything (the reviewer's case 2) exceeds a small budget.
  assert.equal(write(p, fileSha(p), "x\n", ["--max-change", "8"]).json.error, "too-big-change")
  // A comment-sized edit fits.
  r = write(p, fileSha(p), base.replace("Q1::A1", "Q1::A1\n<!--SR:!2030-01-01,3,250-->"), ["--max-change", "64"])
  assert.equal(r.json.ok, true, r.json.message)
  const cur = readFileSync(join(vault, p), "utf8")
  // Append-only: the old text minus trailing blank lines must be kept as a prefix.
  const appended = cur.replace(/(\r?\n[ \t]*)+$/, "") + "\n\nQ3::A3\n"
  assert.equal(write(p, fileSha(p), cur.replace("Q2::A2", "Q2::B2") + "\nQ3::A3\n", ["--append-only"]).json.error, "not-append")
  assert.equal(write(p, fileSha(p), cur.replace(/(\r?\n[ \t]*)+$/, ""), ["--append-only"]).json.error, "not-append")
  r = write(p, fileSha(p), appended, ["--append-only"])
  assert.equal(r.json.ok, true, r.json.message)
  assert.ok(readFileSync(join(vault, p), "utf8").includes("\t- keep \n\nQ3::A3\n"), "last line kept byte for byte")
  rmSync(join(vault, p))
})

test("whatever Osr.appendCard produces passes --append-only", () => {
  const p = "ap.md"
  const bases = ["#flashnotes/x\n\nQ::A\n", "#flashnotes/x\n\nQ::A", "#flashnotes/x\n\nQ::A\n\t- \n\n\n", "#flashnotes/x\r\n\r\nQ::A\r\n  \r\n",
    "#flashnotes/x\n\nQ::A <!--SR:!2024-01-01,1,250-->   ", "   "]
  for (const base of bases) {
    writeFileSync(join(vault, p), base)
    const next = Osr.appendCard(base, "New::card")
    const r = write(p, fileSha(p), next, ["--append-only"])
    assert.equal(r.json.ok, true, JSON.stringify(base) + ": " + r.json.message)
    assert.equal(readFileSync(join(vault, p), "utf8"), next)
  }
  rmSync(join(vault, p))
})

test("write applies a review in place: only the SR comment changes, inode and mode kept, backup made", () => {
  const before = readFileSync(join(vault, NOTE))
  const ino = statSync(join(vault, NOTE)).ino
  const text = before.toString("utf8")
  const settings = Osr.settingsFrom(JSON.parse(readFileSync(join(vault, ".obsidian/plugins/obsidian-spaced-repetition/data.json"), "utf8")))
  const note = Osr.parseNote(NOTE, text, settings)
  const q = note.questions.find((x) => x.cards.some((c) => c.schedule)) || note.questions[0]
  const sched = { dueMs: new Date(2030, 0, 15).getTime(), interval: 77, ease: 262 }
  const applied = Osr.applyReview(text, NOTE, settings, { original: q.original, firstLine: q.firstLine, cardIdx: 0 }, sched)
  assert.equal(applied.ok, true, applied.error)
  const log = JSON.stringify({ ts: Date.now(), path: NOTE, deck: "x", cardIdx: 0, response: 1, interval: 77, prevInterval: 3, isNew: false })
  const r = write(NOTE, sha(before), applied.text, ["--max-change", "65536", "--log", log]).json
  assert.equal(r.ok, true, r.message)
  const after = readFileSync(join(vault, NOTE))
  assert.equal(r.sha, sha(after))
  assert.equal(after.toString("utf8"), applied.text)
  assert.equal(statSync(join(vault, NOTE)).ino, ino, "same inode (no rename)")
  // Lines outside the question's span are byte-identical.
  const A = before.toString("utf8").split("\n"), B = after.toString("utf8").split("\n")
  const span = applied.span
  assert.deepEqual(B.slice(0, span.start), A.slice(0, span.start))
  const tailA = A.slice(span.end + 1), tailB = B.slice(B.length - tailA.length)
  assert.deepEqual(tailB, tailA)
  assert.ok(after.toString("utf8").includes("2030-01-15,77,262"))
  // Backup holds the original bytes, named <note>.HHMMSS.md under today's folder.
  assert.ok(r.backup.startsWith(join(state, "backups", today(), dirname(NOTE)) + "/"), r.backup)
  const noteBase = NOTE.split("/").pop().slice(0, -3).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  assert.match(r.backup.split("/").pop(), new RegExp("^" + noteBase + "\\.\\d{6}(-\\d+)?\\.md$"))
  assert.deepEqual(readFileSync(r.backup), before)
  const lines = readFileSync(join(state, "reviews.jsonl"), "utf8").trim().split("\n")
  assert.equal(lines.length, 1)
  assert.equal(JSON.parse(lines[0]).interval, 77)
  assert.ok(!readdirSync(dirname(join(vault, NOTE))).some((n) => n.startsWith(".recall-")))
})

test("a backup is taken before every write whose content is not already backed up", () => {
  const p = "b.md"
  writeFileSync(join(vault, p), "#flashcards/x\n\nQ::A\n")
  const v1 = readFileSync(join(vault, p))
  assert.equal(write(p, fileSha(p), "#flashcards/x\n\nQ::A\n<!--SR:!2031-01-01,3,250-->\n").json.ok, true)
  assert.equal(backupsOf(p).length, 1)
  assert.deepEqual(readFileSync(backupsOf(p)[0]), v1)
  // The user edits the note in Obsidian, then the plugin writes again: the edit is backed up.
  writeFileSync(join(vault, p), "#flashcards/x\n\nQ::A\n<!--SR:!2031-01-01,3,250-->\n\nUSER EDIT\n")
  const v2 = readFileSync(join(vault, p))
  assert.equal(write(p, fileSha(p), "#flashcards/x\n\nQ::A\n<!--SR:!2031-02-01,9,250-->\n\nUSER EDIT\n").json.ok, true)
  const bk = backupsOf(p)
  assert.equal(bk.length, 2)
  assert.deepEqual(readFileSync(bk[bk.length - 1]), v2)
  // A write on top of the plugin's own last write adds the plugin's version (not yet backed up)...
  const v3 = readFileSync(join(vault, p))
  assert.equal(write(p, fileSha(p), "#flashcards/x\n\nQ::A\n<!--SR:!2031-03-01,20,250-->\n\nUSER EDIT\n").json.ok, true)
  assert.equal(backupsOf(p).length, 3)
  assert.deepEqual(readFileSync(backupsOf(p)[2]), v3)
  // ...but restoring exactly the newest backed-up content does not duplicate it.
  writeFileSync(join(vault, p), v3)
  assert.equal(write(p, fileSha(p), "#flashcards/x\n\nQ::A\n<!--SR:!2031-04-01,30,250-->\n\nUSER EDIT\n").json.ok, true)
  assert.equal(backupsOf(p).length, 3)
  // A failed backup blocks the write.
  const ro = join(work, "ro-state")
  mkdirSync(join(ro, "backups"), { recursive: true })
  writeFileSync(join(ro, "backups", today()), "a file where the day folder should be")
  const cur = readFileSync(join(vault, p))
  const b = Buffer.from(cur.toString("utf8").replace("2031-04-01", "2031-05-01"))
  const r = spawnSync(PY, ["-I", HELPER, "write", "--vault", vault, "--path", p, "--expect-sha", sha(cur), "--length", String(b.length),
    "--md5", md5(b), "--max-change", "100", "--state-dir", ro], { input: b })
  assert.equal(JSON.parse(r.stdout.toString()).ok, false)
  assert.deepEqual(readFileSync(join(vault, p)), cur)
  rmSync(join(vault, p))
})

test("write keeps CRLF and other bytes exactly as given, preserves mode", () => {
  const p = "crlf.md"
  const crlf = Buffer.from("#flashnotes\r\n\r\nQ::A\r\n<!--SR:!2024-01-01,1,250-->\r\ntrailing \t \r\n", "utf8")
  writeFileSync(join(vault, p), crlf, { mode: 0o640 })
  const r0 = run(["read", "--vault", vault, "--path", p]).json
  const settings = Osr.settingsFrom({})
  settings.flashcardTags = ["#flashnotes"]
  const note = Osr.parseNote(p, r0.text, settings)
  const q = note.questions[0]
  const ap = Osr.applyReview(r0.text, p, settings, { original: q.original, firstLine: q.firstLine, cardIdx: 0 }, { dueMs: new Date(2031, 1, 2).getTime(), interval: 5, ease: 270 })
  const r = write(p, r0.sha, ap.text).json
  assert.equal(r.ok, true)
  const out = readFileSync(join(vault, p))
  assert.equal(out.toString("utf8"), "#flashnotes\r\n\r\nQ::A\r\n<!--SR:!2031-02-02,5,270-->\r\ntrailing \t \r\n")
  assert.equal(statSync(join(vault, p)).mode & 0o777, 0o640)
  // A shorter text is truncated cleanly.
  const shorter = out.toString("utf8").replace("trailing \t \r\n", "")
  assert.equal(write(p, sha(out), shorter).json.ok, true)
  assert.equal(readFileSync(join(vault, p), "utf8"), shorter)
})

test("write refuses empty input and invalid UTF-8", () => {
  const before = readFileSync(join(vault, NOTE2))
  assert.equal(write(NOTE2, sha(before), "").json.error, "empty")
  assert.equal(write(NOTE2, sha(before), Buffer.from([0x66, 0xff, 0xfe])).json.error, "bad-utf8")
  assert.deepEqual(readFileSync(join(vault, NOTE2)), before)
})

test("create refuses existing files and case variants, creates parents", () => {
  const before = readFileSync(join(vault, NOTE))
  const r = create(NOTE, "new\n").json
  assert.equal(r.ok, false)
  assert.equal(r.error, "exists")
  assert.deepEqual(readFileSync(join(vault, NOTE)), before)
  const p = DIR + "/New Folder/Deck leaf ž.md"
  const c = create(p, "#flashnotes/x\n\nQ::A\n").json
  assert.equal(c.ok, true, c.message)
  assert.equal(readFileSync(join(vault, p), "utf8"), "#flashnotes/x\n\nQ::A\n")
  assert.equal(c.sha, sha(readFileSync(join(vault, p))))
  assert.equal(create(p, "again\n").json.error, "exists")
  // Names that differ only in case (NTFS, shared with Windows).
  writeFileSync(join(vault, "Topic.md"), "x\n")
  assert.equal(create("topic.md", "#flashcards/topic\n\nQ::A\n").json.error, "exists")
  assert.equal(create(DIR_CASE + "/n.md", "#flashcards/topic\n\nQ::A\n").json.error, "exists")
  assert.equal(create(DIR + "/NEW FOLDER/Deck leaf Ž.md", "y\n").json.error, "exists")
  assert.ok(!existsSync(join(vault, "topic.md")) || readFileSync(join(vault, "topic.md"), "utf8") === "x\n")
  assert.ok(!existsSync(join(vault, DIR_CASE)))
  assert.ok(!readdirSync(join(vault, DIR, "New Folder")).some((n) => n.startsWith(".recall-")))
})

test("writes are serialised by a lock", () => {
  const p = "lock.md"
  writeFileSync(join(vault, p), "#flashcards/x\n\nQ::A\n")
  mkdirSync(state, { recursive: true })
  const marker = join(work, "locked")
  const holder = spawn(PY, ["-c", "import fcntl,os,sys,time; fd=os.open(sys.argv[1], os.O_RDWR|os.O_CREAT, 0o644); fcntl.flock(fd, fcntl.LOCK_EX); open(sys.argv[2], 'w').close(); time.sleep(1.5)", join(state, "write.lock"), marker])
  // Wait until the holder has the lock (the event loop is blocked here, so poll a file).
  const deadline = Date.now() + 5000
  while (!existsSync(marker) && Date.now() < deadline) spawnSync("sleep", ["0.05"])
  const t0 = Date.now()
  const r = write(p, fileSha(p), "#flashcards/x\n\nQ::A\n<!--SR:!2031-01-01,3,250-->\n")
  const waited = Date.now() - t0
  assert.equal(r.json.ok, true, r.json.message)
  assert.ok(waited >= 900, "write waited for the lock (" + waited + " ms)")
  holder.kill()
  rmSync(join(vault, p))
})

test("scan reports missing vs unreadable plugin settings and uses fallback tags", () => {
  const srPath = join(vault, ".obsidian/plugins/obsidian-spaced-repetition/data.json")
  const appPath = join(vault, ".obsidian/app.json")
  const excPath = join(vault, ".obsidian/plugins/obsidian-excalidraw-plugin/data.json")
  const sr = readFileSync(srPath), app = readFileSync(appPath), exc = readFileSync(excPath)
  let r = run(["scan", "--vault", vault]).json
  eqErr(r, "", "", "")
  writeFileSync(srPath, sr.subarray(0, 200))          // torn read while Obsidian rewrites it
  writeFileSync(appPath, "")
  rmSync(excPath)
  r = run(["scan", "--vault", vault, "--fallback-tag", "#flashnotes"]).json
  assert.equal(r.sr, null)
  assert.match(r.sr_error, /^unreadable/)
  assert.match(r.app_error, /^unreadable/)
  assert.equal(r.excalidraw_error, "missing")
  assert.deepEqual([r.tags, r.tagsFrom], [["#flashnotes"], "fallback"])
  assert.ok(r.files.length > 0 && r.files.every((f) => /flashnotes/i.test(f.text)))
  rmSync(srPath)
  r = run(["scan", "--vault", vault]).json
  assert.deepEqual([r.sr_error, r.tagsFrom], ["missing", "default"])
  writeFileSync(srPath, sr); writeFileSync(appPath, app); writeFileSync(excPath, exc)
  function eqErr(x, a, b, c) { assert.deepEqual([x.sr_error, x.app_error, x.excalidraw_error], [a, b, c]) }
})

test("scan sweeps stale temp files left by a killed create, and nothing else", () => {
  const dir = join(vault, DIR)
  const stale = join(dir, ".recall-ab12cd_3.recall~"), fresh = join(dir, ".recall-zz99yy00.recall~"), other = join(dir, ".recall-keep-me.recall~")
  for (const f of [stale, fresh, other]) writeFileSync(f, "partial")
  const old = new Date(Date.now() - 3600 * 1000)
  utimesSync(stale, old, old); utimesSync(other, old, old)
  const r = run(["scan", "--vault", vault]).json
  assert.equal(r.swept, 1)
  assert.ok(!existsSync(stale) && existsSync(fresh) && existsSync(other))
  rmSync(fresh); rmSync(other)
})

test("backups older than 30 days are pruned on write", () => {
  const old = new Date(Date.now() - 40 * 86400000), recent = new Date(Date.now() - 10 * 86400000)
  const fmt = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")
  mkdirSync(join(state, "backups", fmt(old), "x"), { recursive: true })
  writeFileSync(join(state, "backups", fmt(old), "x", "a.md"), "old")
  mkdirSync(join(state, "backups", fmt(recent)), { recursive: true })
  mkdirSync(join(state, "backups", "not-a-date"), { recursive: true })
  const cur = readFileSync(join(vault, NOTE2))
  const r = write(NOTE2, sha(cur), cur.toString("utf8") + "\n").json
  assert.equal(r.ok, true, r.message)
  assert.ok(!existsSync(join(state, "backups", fmt(old))))
  assert.ok(existsSync(join(state, "backups", fmt(recent))))
  assert.ok(existsSync(join(state, "backups", "not-a-date")))
  assert.deepEqual(r.pruned, [fmt(old)])
})

test("usage errors print JSON", () => {
  const r = run(["write", "--vault", vault, "--path", NOTE])
  assert.equal(r.status, 2)
  assert.equal(r.json.error, "usage")
  assert.equal(run(["scan", "--vault", join(work, "missing")]).json.error, "vault-missing")
})

rmSync(work, { recursive: true, force: true })
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
