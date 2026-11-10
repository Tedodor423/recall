import QtQuick
import Quickshell
import Quickshell.Io
import "engine/Osr.js" as Osr
import "ServiceModel.js" as Model

// Headless singleton for theo.recall: the card index built from the vault,
// the pop-up timer, review/add actions and the overlay's state. All file
// access goes through helper/recall-io (scan / read / write / create); this
// file never writes into the vault itself. See docs/ARCHITECTURE.md.
Item {
  id: root

  property var shell: null
  property var manifest: null

  readonly property string pluginId: "theo.recall"
  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string stateDir: home + "/.local/state/omarchy/theo.recall"
  readonly property string helperPath: decodeURIComponent(String(Qt.resolvedUrl("helper/recall-io")).replace(/^file:\/\//, ""))
  // Explicit interpreter: the shell's PATH puts a mise shim first.
  readonly property string python: "/usr/bin/python3"

  // ------------------------------------------------------------ public state
  property bool ready: false
  property bool scanning: false
  property bool vaultOk: false
  property string error: ""
  property string readOnlyReason: ""
  // Problems with the settings files; the last good settings stay in use.
  property string configError: ""
  property string settingsWarning: ""
  property string vaultPath: ""
  readonly property string vaultName: Model.basename(vaultPath)

  property var srSettings: Osr.settingsFrom(null)
  property var index: ({ notes: [], errors: [], histogram: {} })
  property var entries: []
  property var stats: Osr.counts([])
  property var allStats: Osr.counts([])
  property var decks: []
  property var deckList: []
  property int notesCount: 0
  property int questionsCount: 0
  property var excalidraw: ({})
  property var obsidianApp: ({})
  property var assets: []

  // Pop-ups stay off until a config.json has been read successfully.
  property var cfg: Model.normalizeConfig({ enabled: false }, home, null)
  property double nextPopupAt: 0
  property double pausedUntil: 0
  readonly property bool paused: pausedUntil > 0 && pausedUntil > clock
  readonly property bool pausedForever: pausedUntil >= Model.PAUSE_FOREVER
  readonly property bool quiet: Model.inQuietHours(cfg.quietHours, new Date(clock))
  // "off" | "paused" | "quiet" | "open" | "scheduled" | "waiting"
  readonly property string timerState: !cfg.enabled ? "off"
    : paused ? "paused"
    : overlayOpen ? "open"
    : quiet ? "quiet"
    : nextPopupAt > 0 ? "scheduled" : "waiting"
  readonly property double nextPopupIn: nextPopupAt > 0 ? Math.max(0, nextPopupAt - clock) : -1
  property int todayReviewed: 0
  property int streakDays: 0
  property var forecast: [0, 0, 0, 0, 0, 0, 0]
  property string lastMessage: ""
  property double clock: Date.now()
  property bool busy: false

  // Overlay state
  property bool overlayOpen: false
  property string mode: "review"
  property bool popupMode: false
  property var current: null
  property bool revealed: false
  property int sessionDone: 0
  property int sessionTarget: 0

  signal addFinished(bool ok, string message)

  // Keeps countdowns exact right after a reschedule (clock ticks once a second).
  onNextPopupAtChanged: clock = Date.now()

  // Status text is transient: it clears itself after a few seconds.
  onLastMessageChanged: if (lastMessage !== "") messageTimer.restart()

  Timer {
    id: messageTimer
    interval: 6000
    onTriggered: root.lastMessage = ""
  }

  // ---------------------------------------------------------------- private
  property var _rawCfg: ({})
  property bool _cfgLoaded: false
  property var _currentRef: null
  property var _sessionSkip: ({})
  property var _recentSkips: ({})
  property var _unsafe: ({})
  property bool _sessionActive: false
  property bool _closing: false
  property bool _grading: false
  property bool _adding: false
  property bool _popupInFlight: false
  property bool _rescanQueued: false
  property var _afterScan: []
  property var _noteIdx: ({})
  property var _assetIdx: Model.assetIndex([])
  property var _taken: ({})
  property var _reviewDays: ({})
  property string _dayKey: ""
  property int _lostTicks: 0
  property double _snoozeUntil: 0
  property var _lastAdd: null
  // Last settings read successfully from the vault: {vault, sr, exc, app}.
  property var _good: ({})
  property string _excProblem: "Excalidraw settings not loaded yet"
  property string _appProblem: "Obsidian app.json not loaded yet"
  property int _settingsRetries: 0

  function _settingsErr(err) {
    if (err === "missing") return "not found"
    return "unreadable (" + String(err || "unknown").replace(/^unreadable: /, "") + ")"
  }

  Timer {
    id: settingsRetry
    interval: 5000
    onTriggered: root.rescan()
  }

  // ------------------------------------------------------------- processes

  Component {
    id: jobComponent

    Process {
      id: job
      property var onDone: null
      property bool raw: false
      property string input: ""
      property bool feed: false
      property bool finished: false
      property int timeoutMs: 30000
      property string label: ""

      stdinEnabled: feed
      stdout: StdioCollector { id: jobOut; waitForEnd: true }
      stderr: StdioCollector { id: jobErr; waitForEnd: true }

      onStarted: {
        if (feed) {
          write(input)
          input = ""
          // Closing stdin ends the document for the helper.
          stdinEnabled = false
        }
      }
      onExited: function(code, status) { Qt.callLater(function() { job.complete(code) }) }

      function complete(code) {
        if (finished) return
        finished = true
        var out = jobOut.text || ""
        var res
        if (raw) {
          res = { ok: code === 0, text: out, code: code }
        } else {
          try { res = JSON.parse(out) } catch (e) {
            res = { ok: false, error: "helper", message: "Helper failed (exit " + code + "): " + String(jobErr.text || out).slice(0, 300) }
          }
        }
        var cb = onDone
        onDone = null
        Qt.callLater(function() { job.destroy() })
        if (cb) {
          try { cb(res) } catch (e) { console.warn("theo.recall: callback failed: " + e + "\n" + (e.stack || "")) }
        }
      }

      property Timer watchdog: Timer {
        interval: job.timeoutMs
        running: true
        onTriggered: {
          if (job.finished) return
          console.warn("theo.recall: process timed out: " + job.label)
          if (job.running) job.signal(15)
          job.complete(-1)
        }
      }
    }
  }

  function _spawn(command, input, cb, raw, timeoutMs) {
    var feed = input !== null && input !== undefined
    var j = jobComponent.createObject(root, {
      command: command, input: feed ? String(input) : "", feed: feed, onDone: cb, raw: !!raw,
      timeoutMs: timeoutMs || 30000, label: command.slice(0, 5).join(" ")
    })
    if (!j) {
      cb({ ok: false, error: "helper", message: "Could not start " + command[0] })
      return
    }
    j.running = true
  }

  function runHelper(args, input, cb, timeoutMs) {
    _spawn([root.python, "-I", root.helperPath].concat(args), input, cb, false, timeoutMs)
  }

  // ----------------------------------------------------------------- config

  FileView {
    id: configFile
    path: root.stateDir + "/config.json"
    watchChanges: true
    atomicWrites: true
    printErrors: false
    onLoaded: root._applyConfigText(text(), false)
    onLoadFailed: function(err) {
      if (err === FileViewError.FileNotFound) root._applyConfigText("", true)
      else root._configUnreadable(FileViewError.toString(err))
    }
    onFileChanged: reload()
  }

  FileView {
    id: reviewsFile
    path: root.stateDir + "/reviews.jsonl"
    printErrors: false
    onLoaded: root._applyReviews(text())
    onLoadFailed: function(err) { root._applyReviews("") }
  }

  // config.json is only trusted when it parses (or, on the very first load,
  // does not exist yet: then the defaults apply). An empty or broken file is
  // never replaced by defaults - that would point the plugin at the real vault
  // with pop-ups on - and is never saved over; the last good settings stay.
  function _applyConfigText(text, missing) {
    var raw
    if (missing) {
      if (root._cfgLoaded) {
        root._configUnreadable("the file disappeared")
        return
      }
      raw = {}
    } else {
      if (!text || !text.trim()) { root._configUnreadable("the file is empty"); return }
      try { raw = JSON.parse(text) } catch (e) { root._configUnreadable("not valid JSON (" + e + ")"); return }
      if (!Model.isObj(raw)) { root._configUnreadable("not a JSON object"); return }
    }
    var first = !root._cfgLoaded
    root._cfgLoaded = true
    root.configError = ""
    if (root.error.indexOf("config.json") === 0) root.error = ""
    root._rawCfg = raw
    root._applyConfig(first)
  }

  function _configUnreadable(why) {
    root.configError = "config.json could not be read: " + why +
      (root._cfgLoaded ? "; keeping the previous settings" : "; fix or delete it")
    console.warn("theo.recall: " + root.configError)
    if (!root._cfgLoaded) root.error = root.configError
  }

  function _applyConfig(first) {
    var prev = root.cfg
    var next = Model.normalizeConfig(root._rawCfg, root.home, root.obsidianApp)
    root.cfg = next
    root.pausedUntil = next.pausedUntil
    if (first || prev.vault !== next.vault || JSON.stringify(prev.tags) !== JSON.stringify(next.tags)) {
      root.rescan()
    } else if (JSON.stringify(prev.decks) !== JSON.stringify(next.decks)) {
      root._refreshEntries(Date.now())
    }
    if (!next.enabled) {
      root.nextPopupAt = 0
    } else if (!first && (prev.intervalMinutes !== next.intervalMinutes || !prev.enabled) && !root.overlayOpen) {
      root.nextPopupAt = root.paused ? 0 : Date.now() + next.intervalMinutes * 60000
    }
  }

  function _saveConfig() {
    configFile.setText(JSON.stringify(root._rawCfg, null, 2) + "\n")
  }

  // Persists one config.json key (value null/undefined removes it, which
  // restores the default). Refused while config.json is unreadable.
  function setConfig(key, value) {
    if (!root._cfgLoaded || root.configError) {
      root.lastMessage = "Settings not saved: " + (root.configError || "config.json is not loaded yet")
      return false
    }
    key = String(key)
    var raw = JSON.parse(JSON.stringify(root._rawCfg || {}))
    if (value === undefined || value === null) delete raw[key]
    else raw[key] = JSON.parse(JSON.stringify(value))
    root._rawCfg = raw
    root._applyConfig(false)
    root._saveConfig()
    return true
  }

  function _applyReviews(text) {
    root._reviewDays = Model.reviewDays(text)
    root._updateReviewCounts()
  }

  function _updateReviewCounts() {
    var now = Date.now()
    root.todayReviewed = root._reviewDays[Model.dayKey(now)] || 0
    root.streakDays = Model.streak(root._reviewDays, now)
  }

  // ---------------------------------------------------------------- scanning

  function rescan() {
    if (root.scanning) { root._rescanQueued = true; return }
    root.scanning = true
    var args = ["scan", "--vault", root.cfg.vault]
    if (root.cfg.tags) root.cfg.tags.forEach(function(t) { args.push("--tag", t) })
    // If SR's data.json cannot be read this time, scan for the last good tags.
    if (root._good.sr && root._good.vault === root.vaultPath)
      Osr.settingsFrom(root._good.sr).flashcardTags.forEach(function(t) { args.push("--fallback-tag", t) })
    runHelper(args, null, function(res) {
      root.scanning = false
      if (res.ok) {
        root._applyScan(res)
      } else {
        root.vaultOk = false
        root.error = res.message || res.error || "Scan failed"
        console.warn("theo.recall: scan failed: " + root.error)
      }
      if (root._rescanQueued) {
        root._rescanQueued = false
        root.rescan()
        return
      }
      var waiting = root._afterScan
      root._afterScan = []
      waiting.forEach(function(fn) {
        try { fn() } catch (e) { console.warn("theo.recall: after-scan step failed: " + e) }
      })
    }, 120000)
  }

  // Runs fn once the index is current (immediately if no scan is running).
  function _whenScanned(fn, forceRescan) {
    if (!root.scanning && !forceRescan && root.ready) { fn(); return }
    var list = root._afterScan.slice()
    list.push(fn)
    root._afterScan = list
    if (!root.scanning) root.rescan()
  }

  // Plugin settings files can be caught mid-rewrite by Obsidian. A setting
  // that cannot be read is never replaced by defaults: the last good copy
  // (from this vault) stays in use, and without one the feature that needs it
  // is switched off (no grading without SR settings, no drawings without
  // Excalidraw settings, no new notes/attachments without app.json).
  function _applyScan(res) {
    var t0 = Date.now()
    var good = root._good.vault === res.vault ? root._good : { vault: res.vault }
    var next = { vault: res.vault, sr: good.sr, exc: good.exc, app: good.app }
    var warnings = []
    var srProblem = ""
    if (!res.sr_error && Model.isObj(res.sr)) next.sr = res.sr
    else if (good.sr) warnings.push("Spaced Repetition settings " + root._settingsErr(res.sr_error) + "; using the last good copy")
    else srProblem = "Spaced Repetition settings " + root._settingsErr(res.sr_error)
    if (!res.excalidraw_error && Model.isObj(res.excalidraw)) next.exc = res.excalidraw
    else if (good.exc) warnings.push("Excalidraw settings " + root._settingsErr(res.excalidraw_error) + "; using the last good copy")
    if (!res.app_error && Model.isObj(res.app)) next.app = res.app
    else if (res.app_error === "missing" && !good.app) next.app = {}
    else if (good.app) warnings.push("Obsidian app.json " + root._settingsErr(res.app_error) + "; using the last good copy")
    root._good = next
    root._excProblem = next.exc ? "" : "Excalidraw settings " + root._settingsErr(res.excalidraw_error)
    root._appProblem = next.app ? "" : "Obsidian app.json " + root._settingsErr(res.app_error)
    root.settingsWarning = warnings.join("; ")
    if (warnings.length) console.warn("theo.recall: " + root.settingsWarning)
    // A torn read heals on the next try; do not wait for the next pop-up.
    if (/^unreadable/.test(res.sr_error || "") || /^unreadable/.test(res.excalidraw_error || "") || /^unreadable/.test(res.app_error || "")) {
      if (root._settingsRetries < 3) { root._settingsRetries++; settingsRetry.restart() }
    } else {
      root._settingsRetries = 0
    }

    var settings = Osr.settingsFrom(next.sr || null)
    if (root.cfg.tags) settings.flashcardTags = root.cfg.tags.slice()
    root.srSettings = settings
    root.readOnlyReason = srProblem ? srProblem + " — reviewing is read-only" : Osr.unsupportedReason(settings)
    root.vaultPath = res.vault
    root.excalidraw = next.exc || null
    var appChanged = JSON.stringify(next.app || {}) !== JSON.stringify(root.obsidianApp || {})
    root.obsidianApp = next.app || {}
    if (appChanged) root.cfg = Model.normalizeConfig(root._rawCfg, root.home, root.obsidianApp)
    root.assets = res.assets || []
    root._assetIdx = Model.assetIndex(root.assets)
    var taken = {}
    root.assets.forEach(function(p) { taken[p.toLowerCase()] = true })
    root._taken = taken

    var idx = Osr.buildIndex(res.files || [], settings, t0)
    var texts = {}
    ;(res.files || []).forEach(function(f) { texts[f.path] = f.text })
    var map = {}
    idx.notes.forEach(function(n, i) {
      n.tailDeck = Model.tailDeck(Osr, n.path, texts[n.path], settings)
      Model.annotateStartLines(Osr, n, texts[n.path])
      map[n.path] = i
    })
    root._noteIdx = map
    root.index = idx
    root.vaultOk = true
    var problems = idx.errors.slice()
    ;(res.errors || []).forEach(function(e) { problems.push(e.path + ": " + e.message) })
    root.error = problems.length ? problems.length + " note(s) could not be read: " + problems[0] : ""
    if (problems.length) console.warn("theo.recall: " + problems.join("; "))
    root._refreshEntries(t0)
    root.ready = true
    console.log("theo.recall: scanned " + idx.notes.length + " notes, " + root.allStats.total + " cards (" +
                root.allStats.due + " due, " + root.allStats.fresh + " new) in " + res.ms + " ms + " + (Date.now() - t0) + " ms")
  }

  function _refreshEntries(now) {
    var s = root.srSettings
    var all = Osr.cardEntries(root.index, s, now)
    var filters = root.cfg.decks
    root.entries = all
    root.allStats = Osr.counts(all)
    root.stats = Osr.counts(all.filter(function(e) { return Osr.deckMatches(e.deck, filters) }))
    var tree = Osr.deckTree(all)
    root.decks = tree
    var list = {}
    tree.forEach(function(d) {
      list[d.key] = { tag: "#" + d.key, key: d.key, name: d.name, depth: d.depth, total: d.total, due: d.due, fresh: d.fresh }
    })
    // Decks that only exist as note tags (no cards yet) are valid targets too.
    root.index.notes.forEach(function(n) {
      n.noteDecks.forEach(function(p) {
        for (var i = 1; i <= p.length; i++) {
          var k = p.slice(0, i).join("/")
          if (!list[k]) list[k] = { tag: "#" + k, key: k, name: p[i - 1], depth: i - 1, total: 0, due: 0, fresh: 0 }
        }
      })
    })
    root.deckList = Object.keys(list).sort().map(function(k) { return list[k] })
    root.forecast = Osr.upcoming(all, filters, now, s, 7)
    root.notesCount = root.index.notes.length
    var qn = 0
    root.index.notes.forEach(function(n) { qn += n.questions.length })
    root.questionsCount = qn
    root._dayKey = Model.dayKey(Osr.todayMs(now, s))
  }

  // Re-parses one note after a write and swaps it into the index.
  function _reparseNote(path, text, sha, mtime) {
    var s = root.srSettings
    var n = Osr.parseNote(path, text, s)
    if (!n) n = { path: path, questions: [], noteDecks: [], noteEase: null, lineEnding: "\n", initialEase: null }
    n.sha = sha
    n.mtime = mtime
    n.tailDeck = Model.tailDeck(Osr, path, text, s)
    Model.annotateStartLines(Osr, n, text)
    var notes = root.index.notes.slice()
    var map = {}
    for (var k in root._noteIdx) map[k] = root._noteIdx[k]
    if (map[path] !== undefined) notes[map[path]] = n
    else { map[path] = notes.length; notes.push(n) }
    root._noteIdx = map
    root.index = { notes: notes, errors: root.index.errors, builtAt: root.index.builtAt, histogram: root.index.histogram }
    root._refreshEntries(Date.now())
  }

  // -------------------------------------------------------------- sessions

  function _skipSet(includeRecent) {
    var s = {}
    for (var k in root._sessionSkip) s[k] = true
    if (includeRecent) {
      var now = Date.now()
      for (var r in root._recentSkips) if (now - root._recentSkips[r] < 3600000) s[r] = true
    }
    // Cards the engine refused to rewrite stay out until their note changes.
    for (var u in root._unsafe) {
      var i = root._noteIdx[root._unsafe[u].path]
      if (i !== undefined && root.index.notes[i].sha === root._unsafe[u].sha) s[u] = true
    }
    return s
  }

  function _cardView(e) {
    var note = root.index.notes[e.noteIndex]
    var q = note.questions[e.questionIndex]
    var card = q.cards[e.cardIdx]
    var iv = Osr.previewIntervals(card, note, root.srSettings, Date.now(), root.index.histogram)
    var labels = {}
    for (var r in iv) labels[r] = Osr.shortInterval(iv[r])
    root._currentRef = { key: e.key, path: e.path, noteIndex: e.noteIndex, questionIndex: e.questionIndex,
                         cardIdx: e.cardIdx, original: q.original, firstLine: q.firstLine, deck: e.deck }
    return {
      key: e.key,
      path: e.path,
      noteTitle: Model.noteTitle(e.path),
      deck: e.deck,
      tag: "#" + e.deck,
      context: q.context,
      type: Osr.CARD_TYPE_NAMES[q.type],
      front: card.front,
      back: card.back,
      isNew: !card.schedule,
      interval: e.interval,
      ease: e.ease,
      dueMs: e.dueMs,
      intervals: iv,
      intervalLabels: labels,
      line: (q.startLine !== undefined ? q.startLine : q.firstLine) + 1
    }
  }

  function _loadNext() {
    root.revealed = false
    if (root.sessionTarget > 0 && root.sessionDone >= root.sessionTarget) { root.close(); return }
    var e = Osr.pickNext(root.entries, root.cfg.decks, root._skipSet(root.popupMode))
    if (!e) {
      root.current = null
      root._currentRef = null
      if (root.popupMode) { root.close(); return }
      root.lastMessage = root.sessionDone > 0 ? "All done for now" : "Nothing due"
      return
    }
    root.current = root._cardView(e)
  }

  function _beginSession(mode, popup) {
    root.mode = mode
    root.popupMode = popup
    root.sessionDone = 0
    root.sessionTarget = popup ? root.cfg.cardsPerPopup : 0
    root._sessionSkip = ({})
    root.current = null
    root._currentRef = null
    root.revealed = false
    root._snoozeUntil = 0
    root._sessionActive = true
  }

  // Shows the overlay plugin. Its own open()/close() must not call back into
  // open(); close() below is re-entrancy safe.
  function _show() {
    root.overlayOpen = true
    root.nextPopupAt = 0
    root._lostTicks = 0
    var payload = JSON.stringify({ mode: root.mode, popup: root.popupMode })
    var ok = false
    try {
      if (root.shell && typeof root.shell.isPluginOpen === "function" && root.shell.isPluginOpen(root.pluginId)) return true
      ok = !!(root.shell && typeof root.shell.summon === "function" && root.shell.summon(root.pluginId, payload))
    } catch (e) {
      console.warn("theo.recall: summon threw: " + e)
    }
    if (!ok) {
      console.warn("theo.recall: could not show the overlay (summon failed); session kept headless")
      root.overlayOpen = false
      root.lastMessage = "Could not open the overlay"
      if (root.cfg.enabled && !root.paused) root.nextPopupAt = Date.now() + root.cfg.intervalMinutes * 60000
    }
    return ok
  }

  function open(mode) {
    mode = Model.validMode(mode)
    var continuing = root._sessionActive && root.current !== null
    if (!root._sessionActive) root._beginSession(mode, false)
    root.mode = mode
    root.popupMode = false
    root.sessionTarget = 0
    root.lastMessage = ""
    if (mode === "review" && !continuing) {
      root._whenScanned(function() { if (root._sessionActive && root.mode === "review" && !root.current) root._loadNext() })
    }
    root._show()
  }

  function openPopup() {
    if (root.overlayOpen) return false
    root._whenScanned(function() {
      if (root.overlayOpen) return
      root._beginSession("review", true)
      root._loadNext()
      if (!root.current) {
        root._sessionActive = false
        root.popupMode = false
        root.lastMessage = "No cards due"
        root._scheduleNext(root.cfg.intervalMinutes * 60000)
        return
      }
      root._show()
    })
    return true
  }

  function close() {
    if (root._closing) return
    if (!root._sessionActive && !root.overlayOpen) return
    root._closing = true
    root.lastMessage = ""
    var wasOpen = root.overlayOpen
    root._sessionActive = false
    root.overlayOpen = false
    root.popupMode = false
    root.current = null
    root._currentRef = null
    root.revealed = false
    root.sessionTarget = 0
    if (wasOpen) {
      try {
        if (root.shell && typeof root.shell.hide === "function") root.shell.hide(root.pluginId)
      } catch (e) { console.warn("theo.recall: hide threw: " + e) }
    }
    root._closing = false
    if (root._snoozeUntil > 0) {
      root.nextPopupAt = root.cfg.enabled && !root.paused ? root._snoozeUntil : 0
      root._snoozeUntil = 0
    } else {
      root._scheduleNext(root.cfg.intervalMinutes * 60000)
    }
  }

  function _scheduleNext(ms) {
    root.nextPopupAt = root.cfg.enabled && !root.paused ? Date.now() + ms : 0
  }

  function reveal() {
    if (root.current) root.revealed = true
  }

  function skip() {
    if (!root.current) return
    var s = {}
    for (var k in root._sessionSkip) s[k] = true
    s[root.current.key] = true
    root._sessionSkip = s
    var r = {}
    for (var k2 in root._recentSkips) r[k2] = root._recentSkips[k2]
    r[root.current.key] = Date.now()
    root._recentSkips = r
    if (root.popupMode) root.sessionDone++
    root._loadNext()
  }

  function snooze(minutes) {
    var m = Math.max(1, Math.round(Number(minutes) || root.cfg.intervalMinutes))
    if (!root._sessionActive && !root.overlayOpen) {
      root._scheduleNext(m * 60000)
      return
    }
    root._snoozeUntil = Date.now() + m * 60000
    root.close()
  }

  function pause(minutes) {
    var m = Math.round(Number(minutes) || 0)
    var until = m > 0 ? Date.now() + m * 60000 : Model.PAUSE_FOREVER
    root.pausedUntil = until
    root.nextPopupAt = 0
    root.setConfig("pausedUntil", until)
    root.lastMessage = m > 0 ? "Paused until " + Model.clockTime(until) : "Paused"
  }

  function resume() {
    root.pausedUntil = 0
    root.setConfig("pausedUntil", null)
    root._scheduleNext(root.cfg.intervalMinutes * 60000)
    root.lastMessage = ""
  }

  // ----------------------------------------------------------------- grading

  function grade(response) {
    var r = parseInt(response)
    if (!(r >= 0 && r <= 3)) return "bad response"
    if (!root.current || !root._currentRef) return "no card"
    if (root._grading) return "busy"
    if (root.readOnlyReason) { root.lastMessage = "Read-only: " + root.readOnlyReason; return "read-only" }
    var ref = root._currentRef
    // Everything this grade touches is fixed now: a rescan or a config change
    // while it runs must not redirect it to another vault or other settings.
    var ctx = { vault: root.vaultPath, s: root.srSettings, histogram: root.index.histogram }
    root._grading = true
    root.busy = true
    function done(msg, advance, rescanFirst) {
      root._grading = false
      root.busy = root._adding
      if (msg) root.lastMessage = msg
      if (!advance) return
      if (rescanFirst) {
        root._whenScanned(function() { if (root._sessionActive && root.current && root.current.key === ref.key) root._loadNext() }, true)
      } else if (root._sessionActive && root.current && root.current.key === ref.key) {
        root._loadNext()
      }
    }
    runHelper(["read", "--vault", ctx.vault, "--path", ref.path], null, function(rd) {
      if (!rd.ok) { done("Could not read the note: " + (rd.message || rd.error), false); return }
      // Schedule from what is on disk now, not from the (possibly older) index:
      // find the question the way applyReview will.
      var note = Osr.parseNote(ref.path, rd.text, ctx.s)
      var q = null
      if (note) {
        var same = note.questions.filter(function(x) { return x.original === ref.original })
        q = same.filter(function(x) { return x.firstLine === ref.firstLine })[0] || (same.length === 1 ? same[0] : null)
      }
      var card = q ? q.cards[ref.cardIdx] : null
      if (!card) {
        root._markSkipped(ref.key)
        done("The card changed in the note since it was loaded — reloaded the vault", true, true)
        return
      }
      var now = Date.now()
      var sched = Osr.nextSchedule(card, note, r, ctx.s, now, ctx.histogram)
      var applied = Osr.applyReview(rd.text, ref.path, ctx.s,
                                    { original: ref.original, firstLine: ref.firstLine, cardIdx: ref.cardIdx }, sched)
      if (!applied.ok) {
        // The card is there but the engine will not rewrite it (malformed
        // comment, text after it, FSRS, ...). Retrying cannot help.
        console.warn("theo.recall: not updating " + ref.path + ":" + (q.firstLine + 1) + ": " + applied.error)
        root._markSkipped(ref.key)
        var un = {}
        for (var uk in root._unsafe) un[uk] = root._unsafe[uk]
        un[ref.key] = { path: ref.path, sha: rd.sha }
        root._unsafe = un
        done(/can't be updated safely/.test(applied.error) ? applied.error
             : "This card can't be updated safely (" + applied.error + ") — edit it in Obsidian", true, false)
        return
      }
      var log = {
        ts: now, path: ref.path, deck: ref.deck, cardIdx: ref.cardIdx, response: r,
        interval: sched.interval, prevInterval: card.schedule && !card.schedule.fsrs ? card.schedule.interval : 0,
        isNew: !card.schedule
      }
      runHelper(["write", "--vault", ctx.vault, "--path", ref.path, "--expect-sha", rd.sha,
                 "--max-change", String(Model.reviewBudget(q.original)), "--log", JSON.stringify(log)]
                .concat(root._integrity(applied.text)), applied.text, function(w) {
        if (!w.ok) {
          if (w.error === "conflict") {
            root._markSkipped(ref.key)
            done("The note changed while saving — reloaded, nothing written", true, true)
          } else {
            root._markSkipped(ref.key)
            done("Could not save: " + (w.message || w.error), true, false)
          }
          return
        }
        if (root.vaultPath !== ctx.vault) { done("Saved", true, true); return }
        // Load-balancing histogram, as the plugin's sequencer updates it.
        var h = ctx.histogram
        if (card.schedule && !card.schedule.fsrs) {
          var old = Math.ceil((card.schedule.dueMs - now) / Osr.DAY_MS)
          if (old === 0) old = 0
          if (h[old] > 0) h[old]--
        }
        h[sched.interval] = (h[sched.interval] || 0) + 1
        root._reparseNote(ref.path, applied.text, w.sha, w.mtime)
        var days = {}
        for (var d in root._reviewDays) days[d] = root._reviewDays[d]
        days[Model.dayKey(now)] = (days[Model.dayKey(now)] || 0) + 1
        root._reviewDays = days
        root._updateReviewCounts()
        root._markSkipped(ref.key)
        if (ctx.s.burySiblingCards) {
          root.entries.forEach(function(e) {
            if (e.path === ref.path && e.questionIndex === ref.questionIndex) root._markSkipped(e.key)
          })
        }
        if (root.current && root.current.key === ref.key) root.sessionDone++
        done("Saved · next " + Osr.textInterval(sched.interval), true, false)
      })
    })
    return "ok"
  }

  // --length/--md5 for a helper write: the helper refuses input that does not
  // arrive complete and unchanged.
  function _integrity(text) {
    return ["--length", String(Model.utf8Length(text)), "--md5", Qt.md5(text)]
  }

  function _markSkipped(key) {
    var s = {}
    for (var k in root._sessionSkip) s[k] = true
    s[key] = true
    root._sessionSkip = s
  }

  // ------------------------------------------------------------------ adding

  function _notesForPlanning() {
    return root.index.notes.filter(function(n) { return !!n.tailDeck })
  }

  function planAdd(deckTag) {
    var key = Model.deckKey(deckTag || root.cfg.lastDeck)
    if (!root.ready || !root.vaultOk)
      return { notePath: "", noteTitle: "", cardTag: "", createsNote: false, error: root.scanning || !root.ready ? "Loading the vault…" : "The vault is not loaded" }
    return Model.planAdd(root._notesForPlanning(), key, root.cfg.lastNoteByDeck, root.cfg.newNoteFolder, root._taken)
  }

  function _planForNote(notePath, key) {
    var i = root._noteIdx[notePath]
    var n = i !== undefined ? root.index.notes[i] : null
    if (!n) return { notePath: notePath, noteTitle: Model.noteTitle(notePath), cardTag: "", createsNote: true, error: "" }
    if (!n.tailDeck) return { notePath: notePath, noteTitle: Model.noteTitle(notePath), cardTag: "", createsNote: false,
                              error: "Cards cannot be appended to that note (it ends inside an unclosed code block, comment or math block)" }
    return { notePath: notePath, noteTitle: Model.noteTitle(notePath), cardTag: n.tailDeck === key ? "" : "#" + key,
             createsNote: false, error: "" }
  }

  // opts: {front, back, reversed, deckTag, notePath, frontDrawing, backDrawing}
  //
  // Order of work: plan the note, read it, build and check the final note
  // text (with the drawing names it will embed), and only then create the
  // drawing files and write the note (append-only). If the note write fails
  // after drawings were created, the message names the files left behind.
  function addCard(opts) {
    opts = opts || {}
    var created = []
    function fail(msg) {
      if (created.length) msg += " — drawing file(s) left in the vault: " + created.join(", ")
      root._adding = false
      root.busy = root._grading
      root.lastMessage = msg
      root._lastAdd = { ok: false, message: msg, drawingsLeft: created.slice() }
      console.log("theo.recall: add refused: " + msg)
      root.addFinished(false, msg)
    }
    if (root._adding) { root.addFinished(false, "Still saving the previous card"); return }
    if (!root.ready || !root.vaultOk) { fail("The vault is not loaded"); return }
    if (root.readOnlyReason) { fail("Read-only: " + root.readOnlyReason); return }
    // Fixed for the whole operation (see grade()).
    var ctx = { vault: root.vaultPath, s: root.srSettings, exc: root.excalidraw, app: root.obsidianApp }
    var s = ctx.s
    var key = Model.deckKey(opts.deckTag || root.cfg.lastDeck)
    if (!key) { fail("Pick a deck"); return }
    var tag = "#" + key
    var underTag = s.flashcardTags.some(function(t) { return tag === t || tag.indexOf(t + "/") === 0 })
    if (!underTag) { fail("The deck must be under " + s.flashcardTags.join(" or ")); return }
    var front = String(opts.front || ""), back = String(opts.back || "")
    var fd = String(opts.frontDrawing || ""), bd = String(opts.backDrawing || "")
    var reversed = !!opts.reversed
    if (!front.trim() && !fd) { fail("The front is empty"); return }
    if (!back.trim() && !bd) { fail("The back is empty"); return }
    if ((fd && fd.indexOf("excalidraw-plugin") === -1) || (bd && bd.indexOf("excalidraw-plugin") === -1)) {
      fail("The drawing is not an Excalidraw file"); return
    }
    if ((fd || bd) && !ctx.exc) { fail("Can't save drawings: " + root._excProblem); return }
    if ((fd || bd) && ctx.exc.embedUseExcalidrawFolder === false && root._appProblem) {
      fail("Can't save drawings: " + root._appProblem); return
    }
    var plan = opts.notePath ? root._planForNote(String(opts.notePath), key) : root.planAdd(tag)
    if (plan.error) { fail(plan.error); return }
    if (plan.createsNote && root._appProblem && !root._rawCfg.newNoteFolder) {
      fail("Can't create a new note: " + root._appProblem); return
    }

    // Quick shape check with stand-in embed names before any I/O.
    var pf = Model.withEmbed(front, fd ? "x 1" : ""), pb = Model.withEmbed(back, bd ? "x 2" : "")
    var why = Osr.validateNewCard(Osr.formatNewCard(pf, pb, s, { cardTag: plan.cardTag, reversed: reversed }), s, reversed, pf, pb)
    if (why) { fail(why); return }

    root._adding = true
    root.busy = true
    var target = Model.drawingTarget(ctx.exc, ctx.app, plan.notePath, new Date())
    var taken = {}
    for (var tk in root._taken) taken[tk] = true
    var names = { f: "", b: "" }
    var collisions = 0
    function reserve(side) {
      names[side] = Model.uniquePath(target.folder, target.base, target.ext, taken, 0)
      taken[names[side].toLowerCase()] = true
    }
    if (fd) reserve("f")
    if (bd) reserve("b")

    // The final note text for `base` with the current drawing names.
    function build(base) {
      var open = base ? Model.openBlockAtEnd(base) : ""
      if (open) return { error: plan.noteTitle + " ends inside an unclosed " + root._blockName(open) + "; pick another note" }
      var F = Model.withEmbed(front, names.f ? Model.embedName(names.f) : "")
      var B = Model.withEmbed(back, names.b ? Model.embedName(names.b) : "")
      var c = root._composeCard(plan, key, base, F, B, reversed, s)
      if (!c.error) { c.F = F; c.B = B }
      return c
    }

    function saveDrawings(base, i, cb) {
      var sides = ["f", "b"], texts = { f: fd, b: bd }
      if (i >= sides.length) { cb(build(base)); return }
      var side = sides[i]
      if (!texts[side]) { saveDrawings(base, i + 1, cb); return }
      runHelper(["create", "--vault", ctx.vault, "--path", names[side]].concat(root._integrity(texts[side])), texts[side], function(res) {
        if (res.ok) {
          created.push(names[side])
          root._noteTaken(names[side])
          saveDrawings(base, i + 1, cb)
        } else if (res.error === "exists" && collisions++ < 50) {
          root._noteTaken(names[side])
          reserve(side)
          // The embed name changed: the note text is rebuilt (and re-checked).
          var again = build(base)
          if (again.error) { cb(again); return }
          saveDrawings(base, i, cb)
        } else {
          cb({ error: "Could not save the drawing: " + (res.message || res.error) })
        }
      })
    }

    function finish(msg, c) {
      root._adding = false
      root.busy = root._grading
      if (root.vaultPath === ctx.vault) {
        var lnbd = {}
        for (var k in root.cfg.lastNoteByDeck) lnbd[k] = root.cfg.lastNoteByDeck[k]
        lnbd[key] = plan.notePath
        root.setConfig("lastNoteByDeck", lnbd)
        root.setConfig("lastDeck", tag)
      }
      root.lastMessage = msg
      root._lastAdd = { ok: true, message: msg, notePath: plan.notePath, front: c.F, back: c.B, drawings: created.slice() }
      root.addFinished(true, msg)
    }

    function writeNote(base, sha, c, tries) {
      if (plan.createsNote) {
        runHelper(["create", "--vault", ctx.vault, "--path", plan.notePath].concat(root._integrity(c.text)), c.text, function(res) {
          if (!res.ok) { fail("Could not create " + plan.notePath + ": " + (res.message || res.error)); return }
          if (root.vaultPath === ctx.vault) {
            root._noteTaken(plan.notePath)
            root._reparseNote(plan.notePath, c.text, res.sha, res.mtime)
          }
          finish("Added to new note " + plan.noteTitle, c)
        })
        return
      }
      runHelper(["write", "--vault", ctx.vault, "--path", plan.notePath, "--expect-sha", sha, "--append-only"]
                .concat(root._integrity(c.text)), c.text, function(w) {
        if (w.ok) {
          if (root.vaultPath === ctx.vault) root._reparseNote(plan.notePath, c.text, w.sha, w.mtime)
          finish("Added to " + plan.noteTitle, c)
          return
        }
        if (w.error === "conflict" && tries < 2) {
          // Edited meanwhile: rebuild on the current text (names stay).
          runHelper(["read", "--vault", ctx.vault, "--path", plan.notePath], null, function(rd) {
            if (!rd.ok) { fail("Could not read " + plan.noteTitle + ": " + (rd.message || rd.error)); return }
            var c2 = build(rd.text)
            if (c2.error) { fail(c2.error); return }
            writeNote(rd.text, rd.sha, c2, tries + 1)
          })
          return
        }
        fail("Could not save the card to " + plan.noteTitle + ": " + (w.message || w.error))
      })
    }

    function withBase(cb) {
      if (plan.createsNote) { cb(Osr.newNoteText(tag), ""); return }
      runHelper(["read", "--vault", ctx.vault, "--path", plan.notePath], null, function(rd) {
        if (!rd.ok) { fail("Could not read " + plan.noteTitle + ": " + (rd.message || rd.error)); return }
        cb(rd.text, rd.sha)
      })
    }

    withBase(function(base, sha) {
      var c = build(base)
      if (c.error) { fail(c.error); return }
      saveDrawings(base, 0, function(c2) {
        if (c2.error) { fail(c2.error); return }
        writeNote(base, sha, c2, 0)
      })
    })
  }

  function _blockName(kind) {
    return { code: "code block", comment: "%% comment", math: "$$ math block", html: "<!-- comment" }[kind] || kind
  }

  function _noteTaken(p) {
    var t = {}
    for (var k in root._taken) t[k] = true
    t[p.toLowerCase()] = true
    root._taken = t
    if (root.assets.indexOf(p) === -1) {
      var a = root.assets.slice()
      a.push(p)
      root.assets = a
      root._assetIdx = Model.assetIndex(a)
    }
  }

  // The note text with the card appended, checked by parsing it the way the
  // SR plugin will: exactly one new question, in deck `key`, with the right
  // number of cards. Adds a card-level tag when the note's deck differs.
  function _composeCard(plan, key, baseText, F, B, reversed, s) {
    function compose(cardTag) {
      var cardText = Osr.formatNewCard(F, B, s, { cardTag: cardTag, reversed: reversed })
      var why = Osr.validateNewCard(cardText, s, reversed, F, B)
      if (why) return { error: why }
      var text = Osr.appendCard(baseText, cardText)
      var before = baseText ? Osr.parseNote(plan.notePath, baseText, s) : null
      var after = Osr.parseNote(plan.notePath, text, s)
      var nb = before ? before.questions.length : 0
      if (!after || after.questions.length !== nb + 1) return { error: "The card would not parse as one new card in that note" }
      var q = after.questions[after.questions.length - 1]
      var deckOk = q.decks && q.decks.length && q.decks[0].join("/") === key
      return { text: text, deckOk: deckOk, cards: q.cards.length }
    }
    var c = compose(plan.cardTag)
    if (!c.error && !c.deckOk && !plan.cardTag) c = compose("#" + key)
    if (c.error) return c
    if (!c.deckOk) return { error: "The card would not land in #" + key }
    if (c.cards !== (reversed ? 2 : 1)) return { error: "The card would not parse as expected" }
    return c
  }

  // -------------------------------------------------------------- utilities

  function resolveEmbed(name, fromPath) {
    if (!root.vaultPath) return ""
    var rel = Model.resolveLink(root._assetIdx, name, fromPath || "")
    return rel ? root.vaultPath + "/" + rel : ""
  }

  function openInObsidian(path) {
    if (!root.vaultName || !path) return
    Qt.openUrlExternally("obsidian://open?vault=" + encodeURIComponent(root.vaultName) + "&file=" + encodeURIComponent(path))
  }

  function statusObject() {
    return {
      ready: root.ready, scanning: root.scanning, vaultOk: root.vaultOk, error: root.error,
      readOnlyReason: root.readOnlyReason, configError: root.configError, settingsWarning: root.settingsWarning,
      vault: root.vaultPath, notes: root.notesCount,
      questions: root.questionsCount, cards: root.allStats.total, due: root.allStats.due, new: root.allStats.fresh,
      later: root.allStats.later, popupDecks: root.cfg.decks, popupDue: root.stats.due, popupNew: root.stats.fresh,
      enabled: root.cfg.enabled, intervalMinutes: root.cfg.intervalMinutes, timer: root.timerState,
      nextPopupAt: root.nextPopupAt, nextPopupInSec: root.nextPopupIn < 0 ? -1 : Math.round(root.nextPopupIn / 1000),
      pausedUntil: root.pausedUntil, overlayOpen: root.overlayOpen, mode: root.mode, popupMode: root.popupMode,
      current: root.current ? { key: root.current.key.split("\u0000").join(":"), path: root.current.path, deck: root.current.deck,
                                type: root.current.type, isNew: root.current.isNew, intervals: root.current.intervals } : null,
      revealed: root.revealed, sessionDone: root.sessionDone, sessionTarget: root.sessionTarget,
      todayReviewed: root.todayReviewed, streakDays: root.streakDays, forecast: root.forecast,
      busy: root.busy, lastMessage: root.lastMessage
    }
  }

  // --------------------------------------------------------------- the timer

  function _tryPopup() {
    if (root._popupInFlight) return
    var now = Date.now()
    function retry(why) {
      root._popupInFlight = false
      root.nextPopupAt = Date.now() + 60000
      console.log("theo.recall: popup postponed 1 min: " + why)
    }
    if (!root.cfg.enabled) { root.nextPopupAt = 0; return }
    if (root.paused) { root.nextPopupAt = 0; return }
    // Woke from sleep long after the due time: give the user a minute.
    if (now - root.nextPopupAt > 5 * 60000) { retry("resumed from sleep"); return }
    root._popupInFlight = true
    if (Model.inQuietHours(root.cfg.quietHours, new Date(now))) { retry("quiet hours"); return }
    if (root.overlayOpen) { retry("overlay already open"); return }
    var proceed = function() {
      root._whenScanned(function() {
        root._popupInFlight = false
        if (!root.vaultOk) { retry("vault unavailable"); return }
        if (root.overlayOpen || !root.cfg.enabled || root.paused) return
        root.openPopup()
      }, true)
    }
    if (!root.cfg.skipWhenFullscreen) { proceed(); return }
    _spawn(["hyprctl", "activewindow", "-j"], null, function(res) {
      var win = null
      try { win = JSON.parse(res.text || "null") } catch (e) { win = null }
      if (Model.isFullscreenWindow(win)) { retry("fullscreen window"); return }
      proceed()
    }, true, 5000)
  }

  Timer {
    interval: 1000
    running: true
    repeat: true
    triggeredOnStart: false
    onTriggered: {
      var now = Date.now()
      root.clock = now
      if (root.pausedUntil > 0 && root.pausedUntil <= now) root.resume()
      if (root.ready && Model.dayKey(Osr.todayMs(now, root.srSettings)) !== root._dayKey) {
        root._refreshEntries(now)
        root._updateReviewCounts()
      }
      if (root.overlayOpen && root.shell && typeof root.shell.isPluginOpen === "function") {
        root._lostTicks = root.shell.isPluginOpen(root.pluginId) ? 0 : root._lostTicks + 1
        if (root._lostTicks >= 3) {
          // Summoned but nothing is on screen (Overlay.qml failed to load, or
          // the shell dropped it): end the session so pop-ups keep working.
          console.warn("theo.recall: the overlay is not open (failed to load?); closing the session")
          root._lostTicks = 0
          root.close()
          root.mode = "review"
          root.lastMessage = "The card window could not be shown (see the shell log)"
        }
      }
      if (!root._cfgLoaded) return
      if (!root.cfg.enabled || root.paused) {
        root.nextPopupAt = 0
        return
      }
      if (root.nextPopupAt === 0 && !root.overlayOpen && !root._popupInFlight)
        root.nextPopupAt = now + root.cfg.intervalMinutes * 60000
      else if (root.nextPopupAt > 0 && now >= root.nextPopupAt && !root._popupInFlight)
        root._tryPopup()
    }
  }

  Component.onCompleted: {
    Quickshell.execDetached(["mkdir", "-p", root.stateDir])
  }

  // ------------------------------------------------------------------- IPC

  IpcHandler {
    target: "theo.recall"

    function review(): void { root.open("review") }
    function add(): void { root.open("add") }
    function stats(): void { root.open("stats") }
    function settings(): void { root.open("settings") }
    function popup(): void { root.openPopup() }
    function pause(minutes: int): void { root.pause(minutes) }
    function resume(): void { root.resume() }
    function rescan(): void { root.rescan() }
    function status(): string { return JSON.stringify(root.statusObject()) }

    // Extras for testing and keybindings.
    function close(): void { root.close() }
    function reveal(): void { root.reveal() }
    function grade(response: int): string { return root.grade(response) }
    function skip(): void { root.skip() }
    function snooze(minutes: int): void { root.snooze(minutes) }
    function tryPopup(): void { root.nextPopupAt = Date.now(); root._tryPopup() }
    function card(): string { return JSON.stringify(root.current) }
    function plan(deckTag: string): string { return JSON.stringify(root.planAdd(deckTag)) }
    function addJson(json: string): string {
      var o
      try { o = JSON.parse(json) } catch (e) { return "bad json: " + e }
      root.addCard(o)
      return "started"
    }
    function lastAdd(): string { return JSON.stringify(root._lastAdd) }
    function setConfig(key: string, valueJson: string): string {
      var v
      try { v = JSON.parse(valueJson) } catch (e) { return "bad json: " + e }
      root.setConfig(key, v)
      return JSON.stringify(root.cfg)
    }
    function config(): string { return JSON.stringify(root.cfg) }
    function resolve(name: string, fromPath: string): string { return root.resolveEmbed(name, fromPath) }
  }
}
