// Read-only check of a vault (argument, else $RECALL_TEST_VAULT, else the
// committed fixture vault):
//   node tests/vault-roundtrip.mjs [vaultPath] [--all-tags]
//
// Parses every note the way the Spaced Repetition plugin would, then for each
// scheduled question re-formats it and checks the file would come back
// unchanged (apart from same-line comments, which the plugin itself moves to
// their own line when cardCommentOnSameLine is off). Nothing is written.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { Osr, testVault } from "./load.mjs"

const vault = testVault(process.argv.slice(2).find((a) => !a.startsWith("--")))
const data = JSON.parse(readFileSync(join(vault, ".obsidian/plugins/obsidian-spaced-repetition/data.json"), "utf8"))
const settings = Osr.settingsFrom(data)
const allTags = process.argv.includes("--all-tags")
if (allTags) settings.flashcardTags = ["#flashcards", "#flashnotes"]

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (name.endsWith(".md")) out.push(p)
  }
  return out
}

const t0 = Date.now()
const files = walk(vault, []).map((p) => ({ path: relative(vault, p), text: readFileSync(p, "utf8") }))
const now = Date.now()
const index = Osr.buildIndex(files, settings, now)
const entries = Osr.cardEntries(index, settings, now)
const c = Osr.counts(entries)
console.log(`settings: tags=${JSON.stringify(settings.flashcardTags)} sep=${settings.singleLineCardSeparator} ${settings.multilineCardSeparator} cloze=${JSON.stringify(settings.clozePatterns)}`)
console.log(`scanned ${files.length} md files in ${Date.now() - t0} ms; ${index.notes.length} flashcard notes; errors: ${index.errors.length}`)
index.errors.slice(0, 5).forEach((e) => console.log("  ERR", e))
const qn = index.notes.reduce((a, n) => a + n.questions.length, 0)
console.log(`questions ${qn}, cards ${c.total}: due ${c.due}, new ${c.fresh}, later ${c.later} (mature ${c.mature}, young ${c.young})`)

const byType = {}
index.notes.forEach((n) => n.questions.forEach((q) => { byType[q.type] = (byType[q.type] || 0) + 1 }))
console.log("question types:", JSON.stringify(byType), "(0 single,1 single-rev,2 multi,3 multi-rev,4 cloze)")

// Round trip
let same = 0, moved = 0, other = 0, unscheduled = 0
const samples = []
for (const n of index.notes) {
  const text = files.find((f) => f.path === n.path).text
  for (const q of n.questions) {
    if (!q.cards.some((c) => c.schedule)) { unscheduled++; continue }
    const formatted = Osr.formatQuestion(q, settings)
    const span = Osr.questionSpan(text.split(/\r\n|\n/), q)
    if (!span) { other++; if (samples.length < 6) samples.push({ path: n.path, line: q.firstLine, file: "(span not found)", out: q.original }); continue }
    const lines = text.split(/\r\n|\n/).slice(span.start, span.end + 1).map((l) => l.replace(/\s+$/, "")).join("\n")
    if (formatted === lines) same++
    else if (/\S.*<!--SR:/.test(lines) && formatted.replace(/\s*\n<!--SR:/, " <!--SR:") === lines.replace(/\s+<!--SR:/, " <!--SR:")) moved++
    else if (q.hadExtraSchedules) moved++
    else { other++; if (samples.length < 6) samples.push({ path: n.path, line: q.firstLine, file: lines, out: formatted }) }
  }
}
console.log(`round-trip: identical ${same}, same-line comment moved ${moved}, DIFFERENT ${other}, unscheduled ${unscheduled}`)
for (const s of samples) {
  console.log("--- " + s.path + ":" + (s.line + 1))
  const a = s.file, b = s.out; let i = 0; while (i < a.length && a[i] === b[i]) i++
  console.log("first difference at char " + i + ": file " + JSON.stringify(a.slice(Math.max(0, i - 60), i + 80)))
  console.log("                       out  " + JSON.stringify(b.slice(Math.max(0, i - 60), i + 80)))
}

// Deck tree
console.log("\ndecks:")
for (const d of Osr.deckTree(entries)) {
  if (d.depth > 3) continue
  console.log(`  ${"  ".repeat(d.depth)}${d.name.padEnd(28 - 2 * d.depth)} total ${String(d.total).padStart(5)}  due ${String(d.due).padStart(4)}  new ${String(d.fresh).padStart(4)}`)
}
