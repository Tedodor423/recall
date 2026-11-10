import QtQuick
import QtTest
import ".."

// Real Qt pointer delivery into DrawPad's handlers (mouse, touch, Flickable parent):
//   QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner -input tests/tst_drawpad.qml
// (tablet/stylus events cannot be synthesized from QML; see tests/drawpad-manual.qml)
Item {
    id: root
    width: 700
    height: 900

    Flickable {
        id: flick
        anchors.fill: parent
        contentHeight: 2000
        DrawPad {
            id: pad
            x: 20
            y: 20
            width: 600
            height: 400
            foreground: "#cdd6f4"
        }
    }

    TestCase {
        name: "DrawPad"
        when: windowShown

        function drag(button, pts) {
            mousePress(pad, pts[0][0], pts[0][1], button)
            for (var i = 1; i < pts.length; i++) mouseMove(pad, pts[i][0], pts[i][1], -1, button)
            mouseRelease(pad, pts[pts.length - 1][0], pts[pts.length - 1][1], button)
        }

        function line(x0, y0, x1, y1, n) {
            var out = []
            for (var i = 0; i <= n; i++) out.push([x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n])
            return out
        }

        function init() {
            pad.clear()
            pad._penSeen = false
            pad.eraserMode = false
            flick.contentY = 0
        }

        function test_mouse_draws_with_simulated_pressure() {
            drag(Qt.LeftButton, line(100, 150, 300, 260, 20))
            compare(pad.strokeCount, 1)
            var el = pad.exportElements()[0]
            compare(el.simulatePressure, true)
            compare(el.pressures.length, 0)
            verify(el.points.length >= 15)
            verify(Math.abs(el.x - 100) < 1 && Math.abs(el.y - (150 - 36)) < 2, "origin " + el.x + "," + el.y)
            compare(flick.contentY, 0)
        }

        function test_right_button_and_eraser_mode_erase() {
            drag(Qt.LeftButton, line(100, 150, 300, 150, 10))
            drag(Qt.LeftButton, line(100, 250, 300, 250, 10))
            compare(pad.strokeCount, 2)
            drag(Qt.RightButton, line(200, 120, 200, 180, 6))
            compare(pad.strokeCount, 1)
            pad.eraserMode = true
            drag(Qt.LeftButton, line(150, 220, 160, 280, 6))
            compare(pad.strokeCount, 0)
            pad.undo()
            compare(pad.strokeCount, 1)
            pad.undo()
            compare(pad.strokeCount, 2)
            pad.redo()
            compare(pad.strokeCount, 1)
        }

        function test_touch_draws_until_a_pen_is_seen() {
            var t = touchEvent(pad)
            t.press(0, pad, 120, 200).commit()
            for (var i = 1; i <= 10; i++) t.move(0, pad, 120 + i * 15, 200 + i * 5).commit()
            t.release(0, pad, 270, 250).commit()
            compare(pad.strokeCount, 1)
            compare(pad.exportElements()[0].simulatePressure, true)
            compare(flick.contentY, 0)
            pad._penSeen = true          // what a stylus hover/press sets
            t = touchEvent(pad)
            t.press(0, pad, 120, 300).commit()
            for (i = 1; i <= 10; i++) t.move(0, pad, 120 + i * 15, 300 + i * 5).commit()
            t.release(0, pad, 270, 350).commit()
            compare(pad.strokeCount, 1, "palm/touch ignored after pen use")
        }

        function test_vertical_drags_do_not_scroll_the_parent_flickable() {
            drag(Qt.LeftButton, line(200, 380, 210, 80, 20))
            compare(pad.strokeCount, 1)
            compare(flick.contentY, 0)
            var t = touchEvent(pad)
            t.press(0, pad, 300, 380).commit()
            for (var i = 1; i <= 15; i++) t.move(0, pad, 300, 380 - i * 20).commit()
            t.release(0, pad, 300, 80).commit()
            wait(50)
            compare(pad.strokeCount, 2)
            compare(flick.contentY, 0)
        }

        function test_toolbar_and_keys() {
            drag(Qt.LeftButton, line(100, 150, 300, 150, 10))
            mouseClick(pad, 4 + 30 + 2 + 15, 18)          // eraser button
            compare(pad.eraserMode, true)
            mouseClick(pad, 4 + 15, 18)                   // pen button
            compare(pad.eraserMode, false)
            pad.forceActiveFocus()
            keyClick(Qt.Key_Z, Qt.ControlModifier)
            compare(pad.strokeCount, 0)
            keyClick(Qt.Key_Z, Qt.ControlModifier | Qt.ShiftModifier)
            compare(pad.strokeCount, 1)
            verify(pad.exportFile().indexOf("```compressed-json") > 0)
        }
    }
}
