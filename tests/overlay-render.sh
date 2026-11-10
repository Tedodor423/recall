#!/bin/bash
# Offscreen render of the overlay surface with the mock service:
#   tests/overlay-render.sh [vault]      (default: $RECALL_TEST_VAULT, else the fixture vault)
# Builds a throwaway Quickshell config in $RECALL_OUT/qsroot (qs.Commons / qs.Ui
# symlinked from /usr/share/omarchy/shell), runs tests/OverlayHarness.qml with
# QT_QPA_PLATFORM=offscreen and leaves $RECALL_OUT/overlay-*.png. Read-only.
# Output lives outside the plugin tree: Quickshell watches the imported
# directories and would reload the harness when a PNG lands in them.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out="${RECALL_OUT:-$HOME/.cache/theo.recall-dev/b-shots}"
root="$out/qsroot"
mkdir -p "$root"
ln -sfn /usr/share/omarchy/shell/Commons "$root/Commons"
ln -sfn /usr/share/omarchy/shell/Ui "$root/Ui"
node "$here/mock-data.mjs" "$@" > "$out/mock-data.json"
cat > "$root/shell.qml" <<QML
//@ pragma OmarchyLoadPatch
import QtQuick
import Quickshell
import "file:$here" as T

ShellRoot {
  FloatingWindow {
    implicitWidth: ${RECALL_W:-1400}
    implicitHeight: ${RECALL_H:-900}
    color: "black"
    T.OverlayHarness { anchors.fill: parent }
  }
}
QML
RECALL_OUT="$out" RECALL_DATA="$out/mock-data.json" QT_QPA_PLATFORM=offscreen QML_XHR_ALLOW_FILE_READ=1 \
  QT_FORCE_STDERR_LOGGING=1 timeout 120 qs -p "$root" 2>&1 \
  | sed -e 's/\x1b\[[0-9;]*m//g' | grep -v -E 'WAYLAND_DISPLAY|--- WARNING|actually running wayland|window masks|Launching config|Shell ID|Saving logs|Configuration Loaded'
ls "$out"/overlay-*.png
