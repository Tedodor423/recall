// Read-only render sweep over a vault (argument, else $RECALL_TEST_VAULT, else
// the committed fixture vault):
//   node tests/markdown-sweep.mjs [vaultPath] [--all-tags] [--samples N] [--show kind]
//
// Parses every flashcard note with engine/Osr.js, renders both sides of every
// card with engine/Markdown.js and checks that nothing throws or falls back,
// that every "<" in the html starts a tag the renderer itself emits (so note
// text is always escaped), that no private-use marker survives, and that no
// tag references a resource. Prints a few samples per feature to eyeball.
// Nothing is written anywhere.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, basename } from "node:path"
import { Osr, loadQmlJs, testVault } from "./load.mjs"

const Md = loadQmlJs("engine/Markdown.js", ["blocks"])
const args = process.argv.slice(2)
const vault = testVault(args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a)))
const samplesPer = +(args[args.indexOf("--samples") + 1] || 2) || 2
const showKind = args.includes("--show") ? args[args.indexOf("--show") + 1] : ""

const data = JSON.parse(readFileSync(join(vault, ".obsidian/plugins/obsidian-spaced-repetition/data.json"), "utf8"))
const settings = Osr.settingsFrom(data)
if (args.includes("--all-tags")) settings.flashcardTags = ["#flashcards", "#flashnotes"]

const md = [], assets = []
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p)
    else { assets.push(p); if (name.endsWith(".md")) md.push(p) }
  }
})(vault)

// Obsidian-ish basename resolution: exact name, name + ".md", or a path suffix.
const byName = new Map()
for (const p of assets) {
  const b = basename(p)
  if (!byName.has(b)) byName.set(b, p)
  if (b.endsWith(".md") && !byName.has(b.slice(0, -3))) byName.set(b.slice(0, -3), p)
}
function resolve(name) {
  if (byName.has(name)) return byName.get(name)
  if (name.includes("/")) {
    const hit = assets.find((p) => p.endsWith("/" + name) || p.endsWith("/" + name + ".md"))
    if (hit) return hit
  }
  return ""
}

const palette = { text: "#cdd6f4", muted: "#7f849c", accent: "#89b4fa", cloze: "#f9e2af", clozeAnswer: "#a6e3a1",
                  highlight: "#80f9e2af", code: "#94e2d5", codeBg: "#313244", link: "#89b4fa", border: "#585b70" }
const ctx = { resolve, palette, fontSize: 16, charWidth: 9.6 }

const files = md.map((p) => ({ path: relative(vault, p), text: readFileSync(p, "utf8") }))
const index = Osr.buildIndex(files, settings, Date.now())

const OWN_TAG = /<\/?(p|span|b|i|u|s|sub|sup|small|br|hr|table|tr|td|th)(\s[^<>]*)?\/?>/g
const features = {
  table: /<table border/, list: /text-indent:-/, cloze: /\uE000|\uE002/, math: /<sub>|<sup>|√|→|⇔/,
  quote: /<table width="100%" cellspacing="0" cellpadding="\d+" bgcolor="[^"]+" style="margin-bottom:\d+px"><tr><td><p/,
  code: /white-space:pre-wrap/, heading: /font-weight:bold;">/, highlight: /background-color:rgba/,
}
const kinds = {}
const featureCount = {}
const samples = {}
let sides = 0, failures = 0, ms = 0, unresolved = 0
const problems = []

for (const n of index.notes) for (const q of n.questions) for (const c of q.cards) for (const side of ["front", "back"]) {
  const text = c[side]
  sides++
  const t0 = performance.now()
  let blocks
  try { blocks = Md.blocks(text, ctx) } catch (e) { failures++; problems.push(`${n.path}:${q.firstLine + 1} ${side}: THROW ${e}`); continue }
  ms += performance.now() - t0
  for (const b of blocks) {
    kinds[b.kind] = (kinds[b.kind] || 0) + 1
    if (b.kind === "file" && !b.path) unresolved++
    if (b.kind !== "html") continue
    let bad = ""
    if (b.error) bad = "fallback: " + b.error
    else if (/[<>]/.test(b.html.replace(OWN_TAG, ""))) bad = "stray < or > : " + b.html.replace(OWN_TAG, "").match(/.{0,30}[<>].{0,30}/)[0]
    else if (/[\uE000-\uE0FF]/.test(b.html)) bad = "private-use marker left"
    else if ((b.html.match(OWN_TAG) || []).some((t) => /src=|href=|url\(/i.test(t))) bad = "resource reference"
    if (bad) { failures++; if (problems.length < 20) problems.push(`${n.path}:${q.firstLine + 1} ${side}: ${bad}`) }
  }
  const html = blocks.filter((b) => b.kind === "html").map((b) => b.html).join("")
  const hit = []
  for (const [k, re] of Object.entries(features)) if (re.test(k === "cloze" ? text : html)) hit.push(k)
  for (const b of blocks) if (b.kind !== "html") hit.push(b.kind)
  for (const k of new Set(hit)) {
    featureCount[k] = (featureCount[k] || 0) + 1
    ;(samples[k] = samples[k] || []).push({ where: `${n.path}:${q.firstLine + 1} ${side}`, text, blocks })
  }
}

console.log(`vault ${vault}: ${index.notes.length} notes, ${sides} card sides rendered in ${Math.round(ms)} ms (${(ms / Math.max(1, sides)).toFixed(3)} ms/side)`)
console.log("blocks:", JSON.stringify(kinds), " unresolved embeds:", unresolved)
console.log("sides per feature:", JSON.stringify(featureCount))
console.log(failures ? `FAILURES: ${failures}` : "no throws, no fallbacks, no unescaped note text, no markers, no resource references")
problems.forEach((p) => console.log("  " + p))

function show(k) {
  const list = samples[k] || []
  // spread the picks over the vault rather than the first note
  const picks = []
  for (let i = 0; i < samplesPer && i < list.length; i++) picks.push(list[Math.floor(i * list.length / samplesPer)])
  for (const s of picks) {
    console.log(`\n=== ${k}: ${s.where}`)
    console.log("--- markdown:\n" + s.text.replace(/\uE000|\uE002/g, "⟦").replace(/\uE001|\uE003/g, "⟧").slice(0, 600))
    console.log("--- blocks:")
    for (const b of s.blocks) console.log(b.kind === "html" ? "html " + b.html.slice(0, 700) : JSON.stringify(b))
  }
}
if (showKind) show(showKind)
else if (!args.includes("--quiet")) for (const k of ["table", "list", "cloze", "math", "image", "drawing", "file", "quote", "code"]) show(k)
process.exit(failures ? 1 : 0)
