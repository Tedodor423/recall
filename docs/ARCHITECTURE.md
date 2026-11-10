# recall — architecture and contracts

Omarchy shell plugin (`theo.recall`) for spaced-repetition flashcards stored in the
user's Obsidian vault, in the exact format of the Obsidian **Spaced Repetition**
plugin v1.14.x (SM-2-OSR, scheduling in `<!--SR:...-->` comments). Cards pop up
every N minutes over a dimmed screen; cards can be added from anywhere, with
optional stylus drawings saved as Excalidraw files (the user's existing workflow).

This file is the contract between the parts. If you need to change an interface,
write the change here first and say so in your report.

## Reference setup (what this was built and tested against)

- Vault: `~/obsidian` by default (any path via `config.json`). The vault may live on an NTFS
  volume shared with Windows and be synced by another tool, which is why writes happen in place
  (see the helper). LF or CRLF line endings; non-ASCII text.
- SR plugin settings: `<vault>/.obsidian/plugins/obsidian-spaced-repetition/data.json`
  (reference setup: `flashcardTags: ["#flashnotes"]`, separators `::` `:::` `;;` `;;;`, highlights
  `==x==` are clozes, `dataStore: NOTES`, `cardCommentOnSameLine: false`, `baseEase 250`).
- Excalidraw plugin settings: `<vault>/.obsidian/plugins/obsidian-excalidraw-plugin/data.json`.
  Drawings live in the plugin's `folder` (reference setup: `Files/excalidraw/`), named
  `<note basename> YYYYMMDDHHmm.md` (no `.excalidraw` extension), embedded in cards as `![[<name>]]`,
  `compress: true`. Almost all elements in pen-drawn files are `freedraw` (pen strokes).
- Obsidian `app.json`: attachment folder and new-note folder (reference setup: `Files/attachments`, `Notes`).
- Hardware: a touchscreen with a stylus (Hyprland lists the pen as a tablet); mouse and touch work too.
- Omarchy 4.0.6, Quickshell 0.3.2, Qt 6.12, node 26, python 3.15, ripgrep.

## Hard rules for everyone

1. **Never write to a real vault.** Reading it is fine. All write testing happens on a copy:
   the tests use the synthetic vault committed in `tests/fixtures/vault` (SR tags `#flashnotes` +
   `#flashcards`) or, with `RECALL_TEST_VAULT=<dir>`, a temporary copy of a vault of your own.
2. While developing, point `vault` in `~/.local/state/omarchy/theo.recall/config.json` at a test
   vault and set `enabled: false` (no timed popups).
3. Do not edit `/usr/share/omarchy/**` (read it freely: `shell/Commons`, `shell/Ui`,
   `shell/plugins/**` are the reference for idioms and styling).
4. Do not touch other plugins, `~/.config/hypr/**`, or `~/.config/omarchy/shell.json` by hand.
   Agent A enables the plugin with `omarchy plugin enable theo.recall --yes` once `Service.qml`
   loads cleanly; keybindings are the lead's job. `keepLoaded` is false during development so
   saved QML hot-reloads.
5. Do not `git commit`; the lead commits. Only edit the files you own (table below).
6. Keep visible test windows/popups brief, prefer offscreen
   rendering (`QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qml file.qml` + `grabToImage`
   → PNG, then view the PNG). Avoid `omarchy restart shell` unless necessary.
7. Shell log: `qs log -p /usr/share/omarchy/shell -t 300 | grep -i recall`.
   Force plugin reload: `omarchy-shell shell rescanPlugins`.

## Files and owners

| File | Owner | What |
|------|-------|------|
| `manifest.json` | lead | kinds `service`, `bar-widget`, `overlay` |
| `engine/Osr.js` | lead (done) | SR-compatible parser, card expansion, SM-2-OSR, comment writer, index, stats |
| `tests/load.mjs`, `tests/vault-roundtrip.mjs` | lead | node loader for `.pragma library` files; read-only vault check |
| `helper/recall-io` | **A** | Python 3 stdlib CLI: scan / read / write / create / list assets |
| `Service.qml` | **A** | headless singleton: index, timer, actions, state, IPC |
| `BarWidget.qml` (+ its panel) | **A** | bar glyph, counts, countdown, quick controls |
| `engine/Markdown.js` | **B** | card text → render blocks (Qt RichText HTML + media) |
| `CardFace.qml` | **B** | renders one card side from blocks |
| `Overlay.qml` (+ sub-components `Ui*.qml` B creates) | **B** | dimmed screen + centred surface: review / add / stats / settings |
| `engine/Excalidraw.js` | **C** | lz-string, scene decode/encode, perfect-freehand outlines, colours |
| `Drawing.qml` | **C** | renders an Excalidraw file/scene |
| `DrawPad.qml` | **C** | stylus/touch/mouse drawing surface that exports Excalidraw |
| `tests/*.test.mjs` | owner of the code under test | node tests |

Engine JS files are QML `.pragma library` resources written in ES5-ish style (`var`,
functions; no `import`/`export`) so `tests/load.mjs` can load them under node. Use
`loadQmlJs("engine/X.js", [names])`.

## Engine API you can rely on (`engine/Osr.js`)

- `settingsFrom(dataJson)` → SR settings with defaults. `unsupportedReason(s)` → "" if writable.
- `buildIndex(files, settings, nowMs)` with `files = [{path, text, sha, mtime}]` (vault-relative
  paths) → `{notes, errors, histogram}`. A note: `{path, questions, noteDecks, initialEase, sha, mtime}`.
  A question: `{type, firstLine, lastLine, original, topic, actual, context:[headings], decks:[[...path]], cards}`.
  A card: `{idx, front, back, schedule: null | {dueMs, interval, ease}}`.
- `cardEntries(index, settings, nowMs)` → flat `[{key, noteIndex, questionIndex, cardIdx, path, deck, decks, state: "new"|"due"|"later"|"fsrs", interval, ease, dueMs}]`.
- `counts(entries)`, `deckTree(entries)` (`[{key, name, depth, total, due, fresh, later, mature}]`),
  `upcoming(entries, filters, nowMs, settings, days)`, `deckMatches(deck, filters)`.
- `pickNext(entries, filters, skipKeys, rand)` → due first (most overdue), then new; or null.
- `previewIntervals(card, note, settings, nowMs, histogram)` → `{0: easyDays, 1: good, 2: hard, 3: again}` (keys are `Response` values).
- `nextSchedule(card, note, response, settings, nowMs, histogram)` → `{dueMs, interval, ease}`.
- `applyReview(fileText, path, settings, {original, firstLine, cardIdx}, schedule)` →
  `{ok, text}` or `{ok:false, error}` — re-parses the current file text and refuses if the card moved/changed.
- `formatNewCard(front, back, settings, {cardTag, reversed})`, `validateNewCard(text, settings, reversed, front, back)`
  (returns "" or a user-facing reason; pass the typed front/back so a stray `::` inside a side is caught),
  `appendCard(fileText, cardText)`, `newNoteText(deckTag)`.
- `Response = {Easy:0, Good:1, Hard:2, Again:3}`; `shortInterval(days)`, `textInterval(days)`.
- Card `front`/`back` strings are raw Obsidian markdown. Cloze gaps are wrapped in private-use
  markers: asking `[...]`, revealed answer `answer`.

## helper/recall-io (A) — CLI contract

Python 3 stdlib only, executable, JSON on stdout, exit 0 even on handled errors (`{"ok":false,"error":...}`).
Every path argument is vault-relative; the helper resolves the vault with `realpath` and refuses
anything that escapes it, hidden components (except reading `.obsidian/plugins/*/data.json` and
`.obsidian/app.json`), or symlinked components inside the vault.

- `scan --vault V [--tag T ...]` → `{ok, vault: realpath, files:[{path, sha, mtime, text}], assets:[relpath...], sr: <data.json or null>, excalidraw: <data.json subset or null>, app: <app.json or null>, ms}`.
  `files` = `.md` files (outside `.trash` and dot-dirs) containing any of the tags (use `rg -l -F` when
  available, else Python). Without `--tag`, tags come from SR `flashcardTags`. `assets` = every
  non-hidden vault file path (for resolving `![[embeds]]` by basename).
- `read --vault V --path P` → `{ok, text, sha, mtime}`.
- `write --vault V --path P --expect-sha S` (new text on stdin) → `{ok, sha, mtime}` or
  `{ok:false, error:"conflict"}` when the file's current sha ≠ S. Atomic (temp in same dir + fsync +
  `os.replace`), preserves mode. Before the first write of a file each day, copies the original to
  `~/.local/state/omarchy/theo.recall/backups/YYYY-MM-DD/<path>`; prunes backups older than 30 days.
- `create --vault V --path P` (text on stdin) → refuses if the file exists; creates parent dirs.
- `sha` = sha256 hex of the file bytes. Text is UTF-8; do not alter line endings.

## Service.qml (A) — API consumed by Overlay (B) and BarWidget (A)

Found by `shell.serviceFor("theo.recall")` (see `alltopafi.break-timer` for the idiom).

State persisted in `~/.local/state/omarchy/theo.recall/`: `config.json` (below), `reviews.jsonl`
(one line per grade: `{ts, path, deck, cardIdx, response, interval, prevInterval, isNew}`).

`config.json` keys (all optional; defaults in brackets): `vault` [`~/obsidian`], `enabled` [true],
`intervalMinutes` [5], `cardsPerPopup` [1], `decks` [[] = all], `tags` [null = SR's flashcardTags],
`quietHours` [{enabled:false, start:"22:00", end:"08:00"}], `skipWhenFullscreen` [true],
`strict` [false — when true, Esc cannot dismiss a popup card], `lastDeck` [""], `lastNoteByDeck` [{}],
`newNoteFolder` [Obsidian `newFileFolderPath` or "01 - Main"].

Properties (read-only unless noted):
- `ready`, `scanning`, `vaultOk`, `error` (string), `readOnlyReason` (string), `vaultPath`
- `srSettings`, `index`, `entries`, `stats` (`counts()` of popup-deck entries), `allStats`,
  `decks` (deckTree of all entries), `deckList` (`[{tag:"#a/b", key:"a/b", total, due, fresh}]`)
- `cfg` (current config object), `nextPopupAt` (ms, 0 if none), `pausedUntil` (ms), `todayReviewed`,
  `streakDays`, `forecast` (7-day `upcoming()`), `lastMessage` (short status text, may be "")
- Overlay state: `overlayOpen` (bool), `mode` (`"review"|"add"|"stats"|"settings"`),
  `popupMode` (true when opened by the timer), `current` (null or card view below), `revealed` (bool),
  `sessionDone` (int cards graded this opening), `sessionTarget` (int; 0 = unlimited)

`current` card view: `{key, path, noteTitle, deck, tag, context:[...], type, front, back, isNew,
interval, ease, dueMs, intervals:{0,1,2,3}, intervalLabels:{0,1,2,3}, line}`.

Methods:
- `open(mode)` — show overlay (`"review"` picks a card; unlimited session); `openPopup()` — timer
  path (1 card unless `cardsPerPopup`); `close()`; `rescan()`
- `reveal()`, `grade(response)` (writes the note, logs, advances or closes), `skip()` (no write; card
  not repeated this session), `snooze(minutes)` (close popup, next popup in N min), `pause(minutes)`
  (0 = until resumed), `resume()`
- `setConfig(key, value)` (persists), `planAdd(deckTag)` → `{notePath, noteTitle, cardTag, createsNote}`
- `addCard({front, back, reversed, deckTag, notePath (optional override), frontDrawing, backDrawing})`
  where drawings are Excalidraw file texts from `DrawPad.exportFile()` or "". Saves drawings into the
  Excalidraw folder with the Excalidraw naming rule, appends `![[name]]` to that side, appends the card.
  Result via signal `addFinished(bool ok, string message)`.
- `resolveEmbed(name, fromPath)` → absolute path or "" (Obsidian basename resolution, `name` may lack
  extension, may carry `|width` or `#section`).
- `openInObsidian(path)` — `obsidian://open?vault=<name>&file=<path>`.
- IPC target `theo.recall`: `review()`, `add()`, `stats()`, `settings()`, `popup()`, `pause(minutes)`,
  `resume()`, `rescan()`, `status()` (JSON string).

Popup rules: fire when `cfg.enabled`, not paused, not in quiet hours, vault readable, a card is
available in `cfg.decks`, no overlay already open, and (if `skipWhenFullscreen`) the focused
window is not fullscreen (`hyprctl activewindow -j`) — otherwise retry in 1 min. The next popup
is scheduled `intervalMinutes` after the previous popup closes. Rescan before each popup.

## Rendering (B): `engine/Markdown.js` + `CardFace.qml`

`Markdown.blocks(text, ctx)` → `[{kind:"html", html} | {kind:"image", path, width} | {kind:"drawing", path} |
{kind:"file", name, path}]`. `ctx = {resolve(name) → abs path|"", palette:{text, muted, accent, cloze,
clozeAnswer, highlight, code, codeBg, link, border}}`. HTML must be Qt RichText-safe (escape all
note text; never load remote resources). Supports at least: paragraphs/line breaks, headings, bold,
italic, strike, `==highlight==`, cloze markers, inline + fenced code, nested lists (tabs and spaces),
task lists, GFM tables, blockquotes/callouts, `[[wikilink|alias]]`, `[md](links)`, `$math$`/`$$math$$`
(shown monospace), `<br>`, horizontal rules. Embeds `![[x.png|300]]`, `![](path)`; `.md` embeds whose
file is an Excalidraw drawing → `drawing`; PDFs/other → `file` chip.

`CardFace.qml` props: `text`, `resolve` (function), `palette`, `fontFamily`, `fontSize`, `maxWidth`,
`maxImageHeight`, `dark` (bool). Lays the blocks out vertically; `drawing` blocks use C's `Drawing.qml`.

## Drawing (C): `engine/Excalidraw.js`, `Drawing.qml`, `DrawPad.qml`

- `Excalidraw.isDrawingFile(text)`, `Excalidraw.decodeFile(text)` → `{elements, appState, files}`
  (handles `compressed-json` and `json` blocks), `Excalidraw.renderList(scene, {dark, foreground})` →
  draw ops in scene coordinates with bounds, `Excalidraw.strokeOutline(points, pressures, opts)`
  (port of perfect-freehand `getStroke` with Excalidraw's freedraw options),
  `Excalidraw.encodeFile(elements, {compress})` → full `.md` file text in the Excalidraw plugin format
  (must decode back identically, and open in the Obsidian Excalidraw plugin).
- `Drawing.qml` props: `source` (abs path) or `sceneText`, `maxWidth`, `maxHeight`, `dark`,
  `foreground`; `implicitWidth/Height` from the scene's aspect ratio.
- `DrawPad.qml` props: `strokeColor`, `strokeWidth`, `foreground`, `background`; pen pressure,
  eraser end / eraser mode, undo, clear, palm rejection (ignore touch while a pen is in proximity);
  `isEmpty`, `exportFile()` → Excalidraw file text, `exportElements()`, signal `edited()`.

## Visual language

Omarchy: everything from `qs.Commons` (`Color`, `Style`, `Util`, `Border`) and `qs.Ui` components
(Button, TextField, Toggle, PanelSlider, SearchableDropdown, PanelSectionHeader, …), monospace
`Style.font.family`, small-caps section labels, keyboard hints in a footer (`space reveal · 1–4 grade ·
esc skip`), theme-following colours (no hard-coded colours except as fallbacks). The popup dims all
screens (`Util.alpha(Color.background, ~0.8)` scrim) and shows the card centred on the focused screen.
Reference implementations: the `alltopafi.break-timer` plugin (service + overlay + bar widget triad)
and the `yamz8.omanki` flashcard plugin (MIT; good reference for overlay/panel styling, key handling,
Process stdin gotchas).

## As built (deviations and additions accepted by the lead)

- **Reload:** this Quickshell build does not clear the QML component cache on hot reload; changed or
  added QML only takes effect after `omarchy-restart-shell`. Any file change in the plugin dir recreates
  the service (keepLoaded false) — fine for a finished install, disruptive while editing.
- **helper/recall-io:** extra `assets` command; `write`/`create` accept `.md` only; `write --log <json>`
  appends to `reviews.jsonl` only after a successful write; `--state-dir` / `RECALL_STATE_DIR`; refuses
  empty files and shrinking a >1 KiB file below half (`--allow-shrink`); errors are
  `{ok:false, error:<code>, message}`; temp files `.recall-*.recall~`. Run as `/usr/bin/python3 -I`.
- **Service:** pure logic lives in `ServiceModel.js` (node-tested). Extra properties `busy, paused,
  pausedForever, quiet, timerState, nextPopupIn, clock, vaultName, notesCount, questionsCount, excalidraw,
  obsidianApp, assets`. Overlay summon payload `{mode, popup}`. If the overlay is not actually open ~3 s
  after a summon the session is reset with a message. `lastMessage` clears after 6 s and on close.
  Timer: no card → retry a full interval later; >5 min overdue (sleep) → wait 1 min; any overlay close
  restarts the countdown; skipped cards stay out of pop-ups for 60 min. Extra IPC: `close, reveal,
  grade <n>, skip, snooze <min>, tryPopup, card, plan <tag>, addJson <json>, lastAdd, setConfig <key>
  <json>, config, resolve <name> <from>`; panel target `theo.recall.panel`. Bar: right-click = review,
  middle-click = pause 1 h / resume. Decks for new cards must sit under SR's flashcardTags.
- **Rendering:** `CardFace` uses `override property var palette` (+ `isDrawing`, `drawingComponent`,
  `fileActivated(path)`, `empty`). Markdown ctx also takes `fontSize, charWidth, fontFamily,
  isDrawing(path, name)`. Clozes reveal in place (as the SR plugin does); other cards show the back
  under an "answer" rule. Math is rendered as readable text (sub/superscripts, Greek, fractions).
- **Overlay keys:** space/enter reveal, then grade Good (400 ms guard); 1–4 grade; j/k/arrows scroll;
  z snooze (1/2/3 = 5/15/60 min); o open in Obsidian (closes overlay); a/s/, modes; esc skip/back;
  ctrl+w/q close. Strict mode hides skip/close but keeps snooze. Stats: 1–4 depth, f pop-up/all decks.
- **Hotkeys (lead):** Super+Alt+R review, Super+Alt+A add card (`~/.config/hypr/bindings.lua`,
  between `-- BEGIN recall` / `-- END recall`).
