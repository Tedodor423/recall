// Unit tests for UiModel.js:   node tests/ui-model.test.mjs
import assert from "node:assert/strict"
import { loadQmlJs, Osr } from "./load.mjs"

const M = loadQmlJs("UiModel.js", ["fuzzyScore", "normalizeKey", "deckSuggestions", "visibleTree", "filterState",
  "toggleFilter", "parseTags", "parseTime", "barHeights", "dayLabel", "underFlashcardTag"])

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++ } catch (e) { failed++; console.log("FAIL " + name + "\n  " + String(e.stack || e.message).split("\n").slice(0, 8).join("\n  ")) }
}

const decks = [
  { tag: "#flashnotes", key: "flashnotes", total: 50, due: 3, fresh: 10 },
  { tag: "#flashnotes/sci", key: "flashnotes/sci", total: 40, due: 3, fresh: 8 },
  { tag: "#flashnotes/sci/bones-and-cartilage", key: "flashnotes/sci/bones-and-cartilage", total: 30, due: 2, fresh: 5 },
  { tag: "#flashnotes/sci/brain", key: "flashnotes/sci/brain", total: 10, due: 1, fresh: 3 },
  { tag: "#flashcards/lab/biochemistry", key: "flashcards/lab/biochemistry", total: 300, due: 20, fresh: 0 },
]
const tags = ["#flashnotes", "#flashcards"]

test("fuzzy", () => {
  assert.ok(M.fuzzyScore("brain", "flashnotes/sci/brain") > M.fuzzyScore("brain", "flashnotes/sci/bones-and-cartilage"))
  assert.equal(M.fuzzyScore("xyz", "flashnotes"), -1)
  assert.ok(M.fuzzyScore("bac", "flashnotes/sci/bones-and-cartilage") > 0)
  assert.ok(M.fuzzyScore("bio", "flashcards/lab/biochemistry") > M.fuzzyScore("bio", "flashnotes/sci/bones-and-cartilage"))
})

test("normalizeKey", () => {
  assert.equal(M.normalizeKey("#a/b/"), "a/b")
  assert.equal(M.normalizeKey(" Bio cells "), "Bio-cells")
  assert.equal(M.normalizeKey("a,b"), "")
  assert.equal(M.normalizeKey("123"), "")
  assert.equal(M.normalizeKey(""), "")
})

test("deck suggestions", () => {
  const r = M.deckSuggestions(decks, "brain", tags)
  assert.equal(r[0].key, "flashnotes/sci/brain")
  assert.equal(r.filter((x) => x.create).length, 1)
  assert.equal(r[r.length - 1].tag, "#flashnotes/brain")   // not under a flashcard tag -> prefixed
  const exact = M.deckSuggestions(decks, "#flashnotes/sci/brain", tags)
  assert.equal(exact.filter((x) => x.create).length, 0)
  const fresh = M.deckSuggestions(decks, "flashnotes/new/deck", tags)
  assert.deepEqual(fresh.find((x) => x.create).tag, "#flashnotes/new/deck")
  assert.equal(M.deckSuggestions(decks, "", tags)[0].key, "flashcards/lab/biochemistry")
  assert.equal(M.deckSuggestions(decks, "", tags, 2).length, 2)
})

test("visible tree", () => {
  const tree = Osr.deckTree([
    { deck: "a/b/c", state: "new", interval: null }, { deck: "a/b/d", state: "due", interval: 3 }, { deck: "a/e", state: "later", interval: 30 }, { deck: "f", state: "new", interval: null },
  ])
  assert.deepEqual(M.visibleTree(tree, {}, -1).map((r) => r.key), ["a", "a/b", "a/b/c", "a/b/d", "a/e", "f"])
  assert.deepEqual(M.visibleTree(tree, {}, 1).map((r) => r.key), ["a", "a/b", "a/e", "f"])
  assert.deepEqual(M.visibleTree(tree, { "a/b": false }, 1).map((r) => r.key), ["a", "a/b", "a/b/c", "a/b/d", "a/e", "f"])
  assert.deepEqual(M.visibleTree(tree, { a: true }, -1).map((r) => r.key), ["a", "f"])
  const rows = M.visibleTree(tree, {}, 0)
  assert.deepEqual(rows.map((r) => [r.key, r.hasChildren, r.collapsed]), [["a", true, true], ["f", false, false]])
})

test("deck filter", () => {
  assert.equal(M.filterState(["a"], "a/b"), "implied")
  assert.equal(M.filterState(["a/b"], "a"), "off")
  assert.deepEqual(M.toggleFilter(["a/b", "c"], "a"), ["a", "c"])
  assert.deepEqual(M.toggleFilter(["a", "c"], "a"), ["c"])
  assert.deepEqual(M.toggleFilter(["a"], "a/b"), ["a"])
})

test("settings parsing", () => {
  assert.deepEqual(M.parseTags("#flashnotes, flashcards/x  #y"), ["#flashnotes", "#flashcards/x", "#y"])
  assert.equal(M.parseTags("  "), null)
  assert.equal(M.parseTime("8"), "08:00")
  assert.equal(M.parseTime("7:5"), "07:05")
  assert.equal(M.parseTime("22:30"), "22:30")
  assert.equal(M.parseTime("25:00"), "")
  assert.equal(M.parseTime("x"), "")
  assert.deepEqual(M.barHeights([0, 2, 4]), [0, 0.5, 1])
  assert.deepEqual(M.barHeights([0, 0]), [0, 0])
  assert.equal(M.dayLabel(0, Date.now()), "today")
})

console.log(`ui-model: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
