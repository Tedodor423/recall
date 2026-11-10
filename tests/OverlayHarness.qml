import QtQuick
import Quickshell
import qs.Commons
import qs.Commons as Commons
import ".." as Recall

// Offscreen walk through the overlay surface with tests/MockService.qml,
// hosted by tests/overlay-render.sh in a throwaway Quickshell config. Loads
// the current Omarchy theme, steps through review / add / stats / settings,
// drives the key handler, saves one PNG per step to $RECALL_OUT and prints
// PASS/FAIL lines for the behaviour checks.
Item {
  id: h

  readonly property string outDir: Quickshell.env("RECALL_OUT") || "/tmp"
  readonly property string only: Quickshell.env("RECALL_ONLY") || ""
  readonly property string themeDir: Quickshell.env("HOME") + "/.local/state/omarchy/current/theme"
  property int step: 0
  property int failures: 0

  function readFile(path) {
    try {
      var xhr = new XMLHttpRequest()
      xhr.open("GET", "file://" + path, false)
      xhr.send()
      return xhr.status === 200 || xhr.status === 0 ? xhr.responseText : ""
    } catch (e) { return "" }
  }

  function key(k, text, mods) {
    var ev = { key: k, text: text || "", modifiers: mods || 0, accepted: false }
    return surf.handleKey(ev)
  }

  function check(name, ok, detail) {
    if (!ok) h.failures++
    console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  " + detail : ""))
  }

  function lastCall() { return mock.calls.length ? mock.calls[mock.calls.length - 1] : "" }

  MockService {
    id: mock
    dataPath: Quickshell.env("RECALL_DATA")
  }

  // Something to dim: a stand-in desktop.
  Rectangle {
    anchors.fill: parent
    gradient: Gradient {
      GradientStop { position: 0; color: "#3b4261" }
      GradientStop { position: 1; color: "#1a1b26" }
    }
    Text { x: 40; y: 40; text: "~/obsidian $ nvim notes.md"; color: "#c0caf5"; font.family: "monospace"; font.pixelSize: 18 }
  }
  Rectangle {
    anchors.fill: parent
    color: Util.alpha(Commons.Color.background, 0.82)
  }

  Recall.UiSurface {
    id: surf
    anchors.centerIn: parent
    service: mock
    availableWidth: h.width
    availableHeight: h.height
  }

  // Each step: [name, setup function]. The shot is taken 600 ms after setup.
  readonly property var steps: [
    ["review-front", function() { mock.open("review"); mock.showCard(0) }],
    ["review-cloze-revealed", function() {
      check("space reveals", key(Qt.Key_Space, " ") && mock.revealed)
    }],
    ["review-image", function() {
      check("3 grades Good (response 1)", key(Qt.Key_3, "3") && lastCall() === "grade(1)", lastCall())
      mock.showCard(1); mock.reveal()
    }],
    ["review-drawing", function() { mock.showCard(2); mock.reveal() }],
    ["review-list", function() { mock.showCard(3); mock.reveal() }],
    ["review-long", function() { mock.showCard(5); mock.reveal() }],
    ["review-popup-strict", function() {
      mock.setConfig("strict", true); mock.popupMode = true; mock.sessionTarget = 3; mock.sessionDone = 1; mock.showCard(4)
      var before = mock.calls.length
      key(Qt.Key_Escape, "")
      check("esc does not skip a strict pop-up", mock.calls.length === before && mock.overlayOpen)
    }],
    ["review-snooze", function() {
      check("z opens the snooze menu", key(Qt.Key_Z, "z") && surf.children.length > 0)
    }],
    ["add", function() {
      check("2 in snooze menu snoozes 15 min", key(Qt.Key_2, "2") && mock.calls.indexOf("snooze(15)") !== -1, lastCall())
      mock.setConfig("strict", false); mock.popupMode = false; mock.sessionTarget = 0; mock.sessionDone = 0
      mock.open("add")
    }],
    ["add-filled", function() {
      var add = findByName(surf, "UiAdd")
      fill(add)
    }],
    ["add-draw", function() {
      var add = findByName(surf, "UiAdd")
      if (add) add.drawFront = true
    }],
    ["stats", function() { mock.open("stats") }],
    ["stats-filtered", function() { mock.setConfig("decks", [mock.deckList[1].key]) ; key(Qt.Key_2, "2") }],
    ["settings", function() { mock.setConfig("decks", [mock.deckList[2].key]); mock.open("settings") }],
    ["review-empty", function() { mock.open("review"); mock.current = null; mock.lastMessage = "" }],
    ["review-light", function() {
      Commons.Color.loadColors('foreground = "#4c4f69"\nbackground = "#eff1f5"\naccent = "#1e66f5"\nred = "#d20f39"\n')
      Commons.Color.loadShell("")
      mock.showCard(1); mock.reveal()
    }]
  ]

  function findByName(item, typeName) {
    if (!item) return null
    if (String(item).indexOf(typeName) === 0) return item
    for (var i = 0; i < item.children.length; i++) {
      var r = findByName(item.children[i], typeName)
      if (r) return r
    }
    return null
  }

  function fill(add) {
    if (!add) { check("found the add view", false); return }
    // Front/back text areas are the QQC TextAreas in the form.
    var areas = []
    function walk(it) {
      if (!it) return
      if (String(it).indexOf("UiTextArea") === 0 && areas.indexOf(it) === -1) areas.push(it)
      for (var i = 0; i < it.children.length; i++) walk(it.children[i])
      if (it.contentItem && it.contentItem !== it) walk(it.contentItem)
    }
    walk(add)
    check("two text areas", areas.length === 2, String(areas.length))
    if (areas.length === 2) {
      areas[0].text = "Which enzyme unwinds DNA ahead of the replication fork?"
      areas[1].text = "**Helicase** — breaks the H-bonds between bases\n- needs ATP\n- works with SSB proteins"
    }
    add.save()
    check("save calls addCard", lastCall().indexOf("addCard(") === 0, lastCall())
  }

  Timer {
    id: runner
    interval: 600
    repeat: false
    onTriggered: {
      var s = h.steps[h.step]
      h.grabToImage(function(r) {
        var file = h.outDir + "/overlay-" + s[0] + ".png"
        if (!h.only || s[0].indexOf(h.only) !== -1) r.saveToFile(file)
        h.step++
        if (h.step >= h.steps.length) {
          console.log("calls: " + mock.calls.join(" "))
          console.log(h.failures ? "FAILURES: " + h.failures : "all checks passed")
          Qt.quit()
          return
        }
        h.steps[h.step][1]()
        runner.start()
      })
    }
  }

  Component.onCompleted: {
    var colors = readFile(themeDir + "/colors.toml")
    if (colors) Commons.Color.loadColors(colors)
    Commons.Color.loadShell(readFile(themeDir + "/shell.toml"))
    h.steps[0][1]()
    runner.start()
  }
}
