import QtQuick
import "../engine/Osr.js" as Osr

// Stand-in for Service.qml with the contract's properties and methods, fed
// from tests/out/mock-mock.json (tests/mock-mock.mjs). Nothing is written:
// grades and adds only move the fake state along. Pure QtQuick; reads the
// JSON with XMLHttpRequest, so run with QML_XHR_ALLOW_FILE_READ=1.
Item {
  id: root

  property string dataPath: ""
  property var mock: ({ cards: [], entries: [], decks: [], deckList: [], assets: {} })

  // ----------------------------------------------------------- contract
  property bool ready: true
  property bool scanning: false
  property bool vaultOk: true
  property string error: ""
  property string readOnlyReason: ""
  property string vaultPath: mock.vaultPath || "/vault"
  property var srSettings: mock.srSettings || Osr.settingsFrom(null)
  property var index: ({ notes: [], errors: [], histogram: {} })
  property var entries: mock.entries || []
  property var stats: Osr.counts(entries.filter(function(e) { return Osr.deckMatches(e.deck, root.cfg.decks) }))
  property var allStats: mock.allStats || Osr.counts(entries)
  property var decks: mock.decks || []
  property var deckList: mock.deckList || []
  property var excalidraw: mock.excalidraw || ({})
  property int notesCount: mock.notesCount || 0
  property var cfg: ({
    vault: "/vault", enabled: false, intervalMinutes: 5, cardsPerPopup: 1, decks: [], tags: null,
    quietHours: { enabled: false, start: "22:00", end: "08:00" }, skipWhenFullscreen: true, strict: false,
    lastDeck: "#flashnotes/bio", lastNoteByDeck: {}, newNoteFolder: "Notes", pausedUntil: 0
  })
  property double nextPopupAt: Date.now() + 4 * 60000
  property double pausedUntil: 0
  property int todayReviewed: 12
  property int streakDays: 4
  property var forecast: mock.forecast || [0, 0, 0, 0, 0, 0, 0]
  property string lastMessage: ""
  property bool busy: false

  property bool overlayOpen: false
  property string mode: "review"
  property bool popupMode: false
  property var current: null
  property bool revealed: false
  property int sessionDone: 0
  property int sessionTarget: 0
  property int cardIndex: 0

  signal addFinished(bool ok, string message)

  // Record of calls, for the harness to assert on.
  property var calls: []
  function log(name, args) { var c = calls.slice(); c.push(name + "(" + (args === undefined ? "" : JSON.stringify(args)) + ")"); calls = c }

  function load() {
    if (!dataPath) return
    var xhr = new XMLHttpRequest()
    xhr.open("GET", "file://" + dataPath, false)
    xhr.send()
    root.mock = JSON.parse(xhr.responseText)
  }

  function showCard(i) {
    root.cardIndex = i
    root.current = mock.cards.length ? mock.cards[i % mock.cards.length] : null
    root.revealed = false
  }

  function open(mode) { log("open", mode); root.mode = mode || "review"; root.popupMode = false; root.overlayOpen = true; if (!root.current && root.mode === "review") showCard(0) }
  function openPopup() { log("openPopup"); root.mode = "review"; root.popupMode = true; root.sessionTarget = cfg.cardsPerPopup; root.overlayOpen = true; showCard(0) }
  function close() { log("close"); root.overlayOpen = false; root.current = null; root.revealed = false; root.popupMode = false }
  function rescan() { log("rescan") }
  function reveal() { log("reveal"); if (root.current) root.revealed = true }
  function grade(r) {
    log("grade", r)
    if (!root.current || !root.revealed) return "no card"
    root.sessionDone++
    root.todayReviewed++
    root.lastMessage = "Saved · next " + Osr.textInterval(root.current.intervals[r])
    if (root.sessionTarget > 0 && root.sessionDone >= root.sessionTarget) { close(); return "ok" }
    showCard(root.cardIndex + 1)
    return "ok"
  }
  function skip() { log("skip"); if (root.popupMode) { close(); return } showCard(root.cardIndex + 1) }
  function snooze(m) { log("snooze", m); close() }
  function pause(m) { log("pause", m) }
  function resume() { log("resume") }
  function setConfig(key, value) {
    log("setConfig", [key, value])
    var c = JSON.parse(JSON.stringify(root.cfg))
    if (value === null || value === undefined) delete c[key]
    else c[key] = JSON.parse(JSON.stringify(value))
    if (key === "tags" && (value === null || value === undefined)) c.tags = null
    root.cfg = c
  }
  function planAdd(deckTag) {
    var key = String(deckTag || "").replace(/^#/, "")
    if (!key) return { notePath: "", noteTitle: "", cardTag: "", createsNote: false, error: "Pick a deck" }
    var exists = deckList.some(function(d) { return d.key === key })
    if (!exists) return { notePath: "Notes/" + key.split("/").pop() + ".md", noteTitle: key.split("/").pop(), cardTag: "", createsNote: true, error: "" }
    return { notePath: "Notes/" + key.split("/").pop() + " flashnotes.md", noteTitle: key.split("/").pop() + " flashnotes", cardTag: key.split("/").length > 2 ? "#" + key : "", createsNote: false, error: "" }
  }
  function addCard(opts) {
    log("addCard", opts)
    root.busy = true
    addTimer.ok = !!(opts.front && opts.back)
    addTimer.message = addTimer.ok ? "Added to " + planAdd(opts.deckTag).noteTitle : (opts.front ? "The back is empty" : "The front is empty")
    addTimer.start()
  }
  function resolveEmbed(name, fromPath) {
    var a = mock.assets || {}
    return a[name] || a[name + ".md"] || ""
  }
  function openInObsidian(path) { log("openInObsidian", path) }

  Timer {
    id: addTimer
    property bool ok: true
    property string message: ""
    interval: 150
    onTriggered: { root.busy = false; root.lastMessage = message; root.addFinished(ok, message) }
  }

  onDataPathChanged: load()
}
