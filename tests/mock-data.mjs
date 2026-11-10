// Dumps realistic data for tests/MockService.qml from a vault (read-only):
//   node tests/mock-data.mjs [vault] > tests/out/mock-data.json
// Default vault: $RECALL_TEST_VAULT, else the committed fixture vault.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, relative, basename } from "node:path"
import { Osr, testVault } from "./load.mjs"

const vault = testVault(process.argv[2])
const sr = JSON.parse(readFileSync(join(vault, ".obsidian/plugins/obsidian-spaced-repetition/data.json"), "utf8"))
const settings = Osr.settingsFrom(sr)
const md = [], assets = {}
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else {
      if (!(name in assets)) assets[name] = p
      if (name.endsWith(".md") && !(name.slice(0, -3) in assets)) assets[name.slice(0, -3)] = p
      if (name.endsWith(".md")) md.push(p)
    }
  }
})(vault)
const now = Date.now()
const files = md.map((p) => ({ path: relative(vault, p), text: readFileSync(p, "utf8") }))
const index = Osr.buildIndex(files, settings, now)
const entries = Osr.cardEntries(index, settings, now)

function view(e) {
  const note = index.notes[e.noteIndex], q = note.questions[e.questionIndex], card = q.cards[e.cardIdx]
  const iv = Osr.previewIntervals(card, note, settings, now, index.histogram)
  const labels = {}
  for (const r in iv) labels[r] = Osr.shortInterval(iv[r])
  return { key: e.key, path: e.path, noteTitle: basename(e.path, ".md"), deck: e.deck, tag: "#" + e.deck, context: q.context,
           type: ["single", "single-reversed", "multi", "multi-reversed", "cloze"][q.type], front: card.front, back: card.back,
           isNew: !card.schedule, interval: e.interval, ease: e.ease, dueMs: e.dueMs, intervals: iv, intervalLabels: labels, line: q.firstLine + 1 }
}
// Interesting cards first: cloze, image, drawing, list, table/long.
const picks = []
const want = [
  (v) => v.type === "cloze" && v.front.length < 200,
  (v) => /!\[\[Pasted/.test(v.back),
  (v) => /!\[\[[^\]]*20\d{10}/.test(v.back) && /\n\s*-/.test(v.back),
  (v) => /\t\t-/.test(v.back),
  (v) => v.type === "single" && !v.isNew,
  (v) => v.back.length > 900,
]
const views = entries.map(view)
for (const f of want) { const v = views.find((x) => f(x) && !picks.includes(x)); if (v) picks.push(v) }

function excalidrawFolder() {
  const p = join(vault, ".obsidian/plugins/obsidian-excalidraw-plugin/data.json")
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")).folder || "Excalidraw" : "Excalidraw"
}

const tree = Osr.deckTree(entries)
const deckList = tree.map((d) => ({ tag: "#" + d.key, key: d.key, name: d.name, depth: d.depth, total: d.total, due: d.due, fresh: d.fresh }))
process.stdout.write(JSON.stringify({
  vaultPath: vault,
  srSettings: settings,
  cards: picks,
  entries: entries.map((e) => ({ key: e.key, deck: e.deck, state: e.state, interval: e.interval, dueMs: e.dueMs })),
  decks: tree,
  deckList,
  allStats: Osr.counts(entries),
  forecast: Osr.upcoming(entries, [], now, settings, 7),
  assets,
  excalidraw: { folder: excalidrawFolder() },
  notesCount: index.notes.length,
}))
