# Recall

Spaced-repetition flashcards for the [Omarchy](https://omarchy.org) shell. Every few minutes a card from your
Obsidian vault pops up over a dimmed screen; you answer it, grade it and carry on. Cards stay in your notes, in
the exact format of the Obsidian [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition)
plugin, so reviews done here and in Obsidian share one schedule. New cards can include pen drawings, saved as
Excalidraw files.

> Screenshots: none yet. A shot of a card over the dimmed desktop belongs here.

## Features

- **Timed pop-ups.** One card every `intervalMinutes` (default 5), counted from when the previous pop-up closes,
  or several in a row with `cardsPerPopup`. Snooze a card for 5, 15 or 60 minutes, or pause and resume from the bar
  widget.
  Pop-ups wait while the focused window is fullscreen.
- **Decks from your tags.** Decks come from the Spaced Repetition plugin's flashcard tags, including nested ones
  like `#flashnotes/bio/cells`, per-note or per-card. Choose which decks may pop up in the settings screen.
- **Compatible scheduling.** A port of the plugin's SM-2-OSR scheduler (load balancing, per-note ease, its
  settings from `data.json`), written to the same `<!--SR:...-->` comments.
- **All the card types.** Single-line (`::`, `:::`), multi-line (`?`/`??` or your own separators) and cloze
  (highlights, bold or `{{curly}}`, as enabled in the plugin, with numbered groups and hints). Separators and
  cloze patterns are read from the plugin's settings.
- **Rich cards.** Headings, lists, tables, callouts, code, images, `[[links]]`, Excalidraw drawings and readable
  math (shown as text with sub/superscripts, not typeset).
- **Add cards from anywhere**, with a pen drawing pad for either side: pressure, eraser, undo, palm rejection,
  also usable with touch or a mouse. Drawings are saved as Excalidraw `.md` files using the Excalidraw plugin's
  folder and naming settings, so they open and edit normally in Obsidian.
- **Quiet hours** when no pop-ups fire, and **strict mode**, where a pop-up card cannot be skipped or closed
  (snoozing stays available).
- **Stats:** deck tree, due and new counts, a 7-day forecast, reviews today and streak.
- **Bar widget:** cards due and countdown to the next pop-up. Left click opens a quick panel, right click starts
  a review, middle click pauses for an hour or resumes.

### Keys in the overlay

| Key | Action |
| --- | --- |
| `space` / `enter` | reveal, then grade Good |
| `1` `2` `3` `4` | Again, Hard, Good, Easy |
| `j` `k` / arrows | scroll |
| `z` | snooze menu (then `1`/`2`/`3` for 5/15/60 min) |
| `o` | open the note in Obsidian |
| `a` `s` `,` | add card, stats, settings |
| `esc` | skip / back (not in a strict pop-up) |
| `ctrl+w` / `ctrl+q` | close |

## Requirements

- Omarchy with Hyprland and its Quickshell-based shell (built on Omarchy 4.0.6, Quickshell 0.3.2, Qt 6.12)
- An Obsidian vault with the Spaced Repetition plugin (format of v1.14.x), set to store schedules in notes
  (`dataStore: NOTES`) with the `SM-2-OSR` algorithm and `convertFoldersToDecks` off. Any other setup stays
  read-only: cards are shown but nothing is written.
- `/usr/bin/python3` (standard library only). `ripgrep` makes scans faster but is optional.
- The Excalidraw Obsidian plugin, only if you want to edit drawings in Obsidian
- `node`, only to run the tests

## Install

```sh
git clone <repo-url> ~/.config/omarchy/plugins/theo.recall
omarchy plugin enable theo.recall
```

Or `omarchy plugin add <repo-url> --enable`. The bar widget defaults to the right section; pick another with
`omarchy plugin enable theo.recall --section left`. After changing QML files, restart the shell with
`omarchy-restart-shell`.

Bindings go in `~/.config/hypr/bindings.lua`, for example:

```lua
o.bind("SUPER + ALT + R", "Flashcards: review", "omarchy-shell theo.recall review")
o.bind("SUPER + ALT + A", "Flashcards: add card", "omarchy-shell theo.recall add")
```

### Configuration

Settings live in `~/.local/state/omarchy/theo.recall/config.json`. Every key is optional, and most can be changed
in the settings screen.

| Key | Default | Meaning |
| --- | --- | --- |
| `vault` | `~/obsidian` | path to the vault |
| `enabled` | `true` | timed pop-ups on or off |
| `intervalMinutes` | `5` | minutes between pop-ups (1 to 1440) |
| `cardsPerPopup` | `1` | cards per pop-up (1 to 100) |
| `decks` | `[]` | decks that may pop up, e.g. `["flashnotes/bio"]`; empty means all |
| `tags` | `null` | flashcard tags to use instead of the plugin's `flashcardTags` |
| `quietHours` | `{"enabled": false, "start": "22:00", "end": "08:00"}` | no pop-ups during this window |
| `skipWhenFullscreen` | `true` | hold pop-ups while the focused window is fullscreen |
| `strict` | `false` | pop-up cards cannot be skipped or closed |
| `newNoteFolder` | Obsidian's new-note folder, else `01 - Main` | where notes for new decks are created |

The plugin also stores `lastDeck`, `lastNoteByDeck` and `pausedUntil` there. If the file is missing the defaults
apply, so set `vault` first if yours is not at `~/obsidian`. A broken file is never overwritten; the plugin reports
it and keeps the last good settings.

### IPC

All calls go through `omarchy-shell theo.recall <method> [args]`:

| Method | Effect |
| --- | --- |
| `review`, `add`, `stats`, `settings` | open the overlay in that mode |
| `popup` | show a pop-up now |
| `tryPopup` | run the pop-up checks now (quiet hours, fullscreen, ...) |
| `pause <minutes>`, `resume` | pause pop-ups (`0` = until resumed) |
| `snooze <minutes>` | close the pop-up, next one in that many minutes |
| `rescan` | re-read the vault |
| `status`, `config`, `card` | current state as JSON |
| `reveal`, `grade <n>`, `skip`, `close` | drive the current card (`grade`: 0 Easy, 1 Good, 2 Hard, 3 Again) |
| `setConfig <key> <json>` | change a setting |
| `plan <deckTag>`, `addJson <json>`, `lastAdd` | plan and add a card from a script |
| `resolve <name> <fromPath>` | resolve an embed the way Obsidian would |

## Safety: how it writes to your vault

This plugin edits your notes, so all vault access goes through one small helper, `helper/recall-io`, which is
deliberately strict:

- **Backups first.** Before any write whose content differs from the newest backup of that note, the note is
  copied to `~/.local/state/omarchy/theo.recall/backups/YYYY-MM-DD/`. Backups are pruned after 30 days. If the
  backup fails, the write does not happen.
- **Change budget.** A review may only change a small region around its card: the card's size plus 2 KiB, between
  4 and 64 KiB. Adding a card must be append-only and keep the existing text as a prefix. Anything else is refused.
- **No lost edits.** Writes are a compare-and-swap on the note's SHA-256, under an `flock` in the state directory.
  If the note changed since it was read, for example in Obsidian, the write is refused and the vault is rescanned.
- **No truncated writes.** The text must arrive with exactly the declared length and MD5.
- **Confined paths.** Paths must stay inside the vault, with no hidden components or symlinks, and only `.md` files
  are ever written.
- **Bytes preserved.** Line endings and everything outside the edit are left untouched. Notes are rewritten in
  place, and new files never replace an existing one.
- **Refuses what it cannot do safely.** Cards with malformed schedule comments, or text after their comment, are
  not updated.

Keep your own backup or sync of the vault as well.

## Tests

```sh
node --test tests/
```

The tests run on a small synthetic vault in `tests/fixtures/vault`. Tests that write do so on a temporary copy.
They need `python3`; the DrawPad test also needs `/usr/lib/qt6/bin/qml` and is skipped without it.

To also run them against your own data, read-only, set `RECALL_TEST_VAULT=/path/to/vault`. The scripts
`tests/vault-roundtrip.mjs` and `tests/markdown-sweep.mjs` use the same variable and report how a vault parses and
renders. The contract between the parts is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

[MIT](LICENSE), Copyright (c) 2026 Tedodor423.

Includes ports of code under the MIT license:
[obsidian-spaced-repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) and clozecraft (parser and
scheduler), [lz-string](https://github.com/pieroxy/lz-string) (c) 2013 Pieroxy, and
[perfect-freehand](https://github.com/steveruizok/perfect-freehand) (c) 2021 Stephen Ruiz. Their full license texts are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
