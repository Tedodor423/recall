// Renders sample card sides through CardFace.qml offscreen and saves a PNG:
//   node tests/cardface-render.mjs [vault] [--light] [--out file.png] [--grep text]
// Output defaults to $RECALL_OUT or ~/.cache/theo.recall-dev/b-shots.
// Default vault: $RECALL_TEST_VAULT, else the committed fixture vault. Read-only.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import { join, relative, basename, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import { Osr, testVault } from "./load.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const vault = testVault(args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--light")))
const outDir = process.env.RECALL_OUT || join(process.env.HOME, ".cache/theo.recall-dev/b-shots")
const out = opt("--out", join(outDir, args.includes("--light") ? "cardface-light.png" : "cardface.png"))
const grep = opt("--grep", "")

const data = JSON.parse(readFileSync(join(vault, ".obsidian/plugins/obsidian-spaced-repetition/data.json"), "utf8"))
const settings = Osr.settingsFrom(data)
settings.flashcardTags = ["#flashcards", "#flashnotes"]
const md = [], assets = {}
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else {
      if (!(name in assets)) assets[name] = p
      if (name.endsWith(".md")) md.push(p)
    }
  }
})(vault)
const files = md.map((p) => ({ path: relative(vault, p), text: readFileSync(p, "utf8") }))
const index = Osr.buildIndex(files, settings, Date.now())

const sides = []
for (const n of index.notes) for (const q of n.questions) for (const c of q.cards)
  for (const side of ["front", "back"]) sides.push({ title: `${basename(n.path, ".md")}:${q.firstLine + 1} ${side}`, text: c[side] })

const picks = []
const want = grep ? [[grep, 12]] : [
  ["", 1], ["", 1], ["![[Pasted", 2], ["|", 1], ["\t\t-", 1], ["$", 1], ["![[", 2], ["**", 1], [".pdf", 1],
]
for (const [needle, count] of want) {
  let k = 0
  for (const s of sides) {
    if (k >= count) break
    if (s.text.includes(needle) && !picks.includes(s)) { picks.push(s); k++ }
  }
}
if (!grep) picks.push({ title: "kitchen sink (synthetic)", text: [
  "### Heading *with* `code`",
  "Text with **bold**, *italic*, ~~strike~~, ==highlight==, a [[Wiki link|alias]], [md link](https://x), #inline/tag and x<sub>2</sub>.",
  "Cloze: [...] and answer mitochondria; math $E=mc^2$, $\\frac{a+b}{c}$, $H_2O \\rightleftharpoons H^+ + OH^-$",
  "- bullet one that is long enough to wrap onto a second line to check the hanging indent",
  "\t- nested ◦ item",
  "\t\t- third level",
  "- [ ] open task",
  "- [x] done task",
  "1. first",
  "2. second",
  "> [!tip] Callout title",
  "> quoted with **bold**",
  "",
  "| col A | col B |",
  "| :-- | --: |",
  "| a < b | 42 |",
  "",
  "```",
  "fenced <code> block",
  "    indented",
  "```",
  "$$\\sqrt{x^2+y^2} \\leq \\alpha$$",
  "---",
  "after rule ![[missing image.png]] and ![[Some note#Part]]",
].join("\n") })

mkdirSync(outDir, { recursive: true })
const dataPath = join(outDir, "cardface-data.json")
writeFileSync(dataPath, JSON.stringify({ cards: picks, assets, dark: !args.includes("--light") }))
console.log(`${picks.length} sides -> ${out}`)
const res = execFileSync("/usr/lib/qt6/bin/qml", [join(here, "CardFaceHarness.qml"), "--", dataPath, out, "560"], {
  env: { ...process.env, QT_QPA_PLATFORM: "offscreen", QML_XHR_ALLOW_FILE_READ: "1", QT_FORCE_STDERR_LOGGING: "1" }, encoding: "utf8", stdio: ["ignore", "inherit", "inherit"], timeout: 60000,
})
