// Loads a QML ".pragma library" JS file under node and returns its globals.
import { readFileSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))

// The synthetic vault committed for the tests (invented notes, SR settings, drawings).
export const FIXTURE_VAULT = join(here, "fixtures", "vault")

// A real vault to test against as well: RECALL_TEST_VAULT, opened read-only
// (tests that write work on a temporary copy). "" when it is not set.
export const REAL_VAULT = process.env.RECALL_TEST_VAULT ? expandHome(process.env.RECALL_TEST_VAULT) : ""

function expandHome(p) { return p === "~" || p.startsWith("~/") ? join(process.env.HOME || "", p.slice(1)) : p }

// The vault a script works on: its argument, else RECALL_TEST_VAULT, else the fixtures.
export function testVault(arg) { return realpathSync(arg ? expandHome(arg) : REAL_VAULT || FIXTURE_VAULT) }

export function loadQmlJs(rel, names) {
  const src = readFileSync(join(here, "..", rel), "utf8").replace(/^\.pragma library\s*$/m, "")
  const body = src + "\nreturn {" + names.map((n) => `${n}: typeof ${n} !== "undefined" ? ${n} : undefined`).join(",") + "}"
  return new Function(body)()
}

export const OSR_EXPORTS = [
  "DAY_MS", "CardType", "Response", "DEFAULT_SETTINGS", "settingsFrom", "unsupportedReason",
  "formatDate", "parseDate", "todayMs", "addDays", "ClozeCrafter", "parse", "splitFrontmatter",
  "frontmatterFields", "contentTags", "splitQuestionText", "expand", "parseSchedules",
  "formatScheduleComment", "formatQuestion", "parseNote", "osrSchedule", "nextSchedule",
  "previewIntervals", "textInterval", "shortInterval", "applyReview", "buildIndex", "cardEntries",
  "deckTree", "counts", "pickNext", "upcoming", "formatNewCard", "validateNewCard", "appendCard",
  "buildHistogram", "noteIsIgnored", "CLOZE_ASK_OPEN", "CLOZE_ANS_OPEN", "deckMatches",
  "noteInitialEase", "removeScheduleInfo", "newNoteText", "questionSpan", "replaceQuestion", "verifyReview", "scheduleIsWritable", "splitKeepEol", "collapseBlankLines"
]

export const Osr = loadQmlJs("engine/Osr.js", OSR_EXPORTS)
