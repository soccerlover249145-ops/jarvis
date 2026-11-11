// JarvisHands: the mouse and keyboard for Jarvis's "take control" mode, with Apple's CGEvent API.
//
// Runs only while a task has control; Jarvis kills it the moment control ends.
// One JSON object per line on stdin, one answer per line on stdout:
//   {"id":1,"op":"click","x":512,"y":300,"button":"left","count":1,"flags":0}  ->  {"id":1,"ok":true}
// Ops: move, click, down, up, drag, scroll, type, key, hold, cursor, front, trusted, activate-under, release.
// Coordinates are global screen points (Jarvis maps Claude's screenshot pixels to points).
// It also watches the real mouse: if the owner moves it, it prints {"event":"user-input"} so
// Jarvis stops and hands control back. Its own events carry a marker so it can tell them apart.
//
// Needs Accessibility permission (System Settings > Privacy & Security > Accessibility > Jarvis).
// It never runs commands, opens files or reads the screen.

import AppKit
import ApplicationServices
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

let MARK: Int64 = 0x4A41_5256  // "JARV", stamped on every event we post
let source = CGEventSource(stateID: .privateState)
var leftHeld = false
var outLock = NSLock()

func reply(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
          let line = String(data: data, encoding: .utf8) else { return }
    outLock.lock(); print(line); fflush(stdout); outLock.unlock()
}

func post(_ e: CGEvent?) {
    guard let e = e else { return }
    e.setIntegerValueField(.eventSourceUserData, value: MARK)
    e.post(tap: .cghidEventTap)
}

func nap(_ s: Double) { usleep(useconds_t(max(0, s) * 1_000_000)) }

func here() -> CGPoint { CGEvent(source: nil)?.location ?? .zero }

func point(_ m: [String: Any]) -> CGPoint? {
    guard let x = (m["x"] as? NSNumber)?.doubleValue, let y = (m["y"] as? NSNumber)?.doubleValue else { return nil }
    return CGPoint(x: x, y: y)
}

func flagsOf(_ m: [String: Any], _ key: String = "flags") -> CGEventFlags {
    CGEventFlags(rawValue: UInt64((m[key] as? NSNumber)?.uint64Value ?? 0))
}

func buttonOf(_ name: String) -> (CGMouseButton, CGEventType, CGEventType) {
    switch name {
    case "right": return (.right, .rightMouseDown, .rightMouseUp)
    case "middle": return (.center, .otherMouseDown, .otherMouseUp)
    default: return (.left, .leftMouseDown, .leftMouseUp)
    }
}

func move(to p: CGPoint) {
    let type: CGEventType = leftHeld ? .leftMouseDragged : .mouseMoved
    post(CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: p, mouseButton: .left))
}

func click(at p: CGPoint, button: String, count: Int, flags: CGEventFlags) {
    move(to: p); nap(0.03)
    let (btn, downT, upT) = buttonOf(button)
    for i in 1...max(1, min(3, count)) {
        let d = CGEvent(mouseEventSource: source, mouseType: downT, mouseCursorPosition: p, mouseButton: btn)
        d?.setIntegerValueField(.mouseEventClickState, value: Int64(i)); d?.flags = flags; post(d)
        let u = CGEvent(mouseEventSource: source, mouseType: upT, mouseCursorPosition: p, mouseButton: btn)
        u?.setIntegerValueField(.mouseEventClickState, value: Int64(i)); u?.flags = flags; post(u)
        nap(0.05)
    }
}

func drag(from a: CGPoint, to b: CGPoint, flags: CGEventFlags) {
    move(to: a); nap(0.05)
    let d = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: a, mouseButton: .left); d?.flags = flags; post(d)
    leftHeld = true
    let steps = 16
    for i in 1...steps {
        let t = Double(i) / Double(steps)
        let p = CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
        let e = CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left); e?.flags = flags; post(e)
        nap(0.012)
    }
    let u = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: b, mouseButton: .left); u?.flags = flags; post(u)
    leftHeld = false
}

func key(code: CGKeyCode, flags: CGEventFlags, down: Bool) {
    let e = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)
    e?.flags = flags
    post(e)
}

func typeText(_ text: String) {
    // newlines and tabs as real keys; everything else as unicode, a few characters per event
    var chunk: [UniChar] = []
    func flush() {
        guard !chunk.isEmpty else { return }
        let d = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
        d?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk); post(d)
        let u = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
        u?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk); post(u)
        chunk.removeAll(); nap(0.012)
    }
    for ch in text {
        if ch == "\n" || ch == "\r\n" || ch == "\r" { flush(); key(code: 0x24, flags: [], down: true); key(code: 0x24, flags: [], down: false); nap(0.02); continue }
        if ch == "\t" { flush(); key(code: 0x30, flags: [], down: true); key(code: 0x30, flags: [], down: false); nap(0.02); continue }
        let units = Array(String(ch).utf16)
        if chunk.count + units.count > 16 { flush() }
        chunk.append(contentsOf: units)
    }
    flush()
}

func frontInfo() -> [String: Any] {
    var out: [String: Any] = [:]
    guard let app = NSWorkspace.shared.frontmostApplication else { return out }
    out["bundleId"] = app.bundleIdentifier ?? ""
    out["name"] = app.localizedName ?? ""
    out["pid"] = Int(app.processIdentifier)
    // the front window's title needs Screen Recording permission; without it the title is empty
    if let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
        for w in list {
            guard (w[kCGWindowOwnerPID as String] as? Int32) == app.processIdentifier,
                  (w[kCGWindowLayer as String] as? Int) == 0 else { continue }
            out["title"] = (w[kCGWindowName as String] as? String) ?? ""
            break
        }
    }
    return out
}

func handle(_ m: [String: Any]) {
    let id = m["id"] ?? NSNull()
    let op = m["op"] as? String ?? ""
    if !["trusted", "front", "cursor", "release", "activate-under"].contains(op) && !AXIsProcessTrusted() {
        reply(["id": id, "ok": false, "error": "Jarvis needs Accessibility permission: System Settings > Privacy & Security > Accessibility > Jarvis."])
        return
    }
    switch op {
    case "trusted":
        let prompt = (m["prompt"] as? Bool) ?? false
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
        reply(["id": id, "ok": true, "trusted": AXIsProcessTrustedWithOptions(opts)])
    case "move":
        guard let p = point(m) else { reply(["id": id, "ok": false, "error": "move needs x and y"]); return }
        move(to: p); reply(["id": id, "ok": true])
    case "click":
        let p = point(m) ?? here()
        click(at: p, button: m["button"] as? String ?? "left", count: (m["count"] as? NSNumber)?.intValue ?? 1, flags: flagsOf(m))
        reply(["id": id, "ok": true])
    case "down", "up":
        let p = here()
        let (btn, downT, upT) = buttonOf(m["button"] as? String ?? "left")
        post(CGEvent(mouseEventSource: source, mouseType: op == "down" ? downT : upT, mouseCursorPosition: p, mouseButton: btn))
        if btn == .left { leftHeld = (op == "down") }
        reply(["id": id, "ok": true])
    case "drag":
        guard let x0 = (m["x0"] as? NSNumber)?.doubleValue, let y0 = (m["y0"] as? NSNumber)?.doubleValue,
              let x1 = (m["x1"] as? NSNumber)?.doubleValue, let y1 = (m["y1"] as? NSNumber)?.doubleValue else {
            reply(["id": id, "ok": false, "error": "drag needs x0 y0 x1 y1"]); return
        }
        drag(from: CGPoint(x: x0, y: y0), to: CGPoint(x: x1, y: y1), flags: flagsOf(m)); reply(["id": id, "ok": true])
    case "scroll":
        if let p = point(m) { move(to: p); nap(0.03) }
        let dy = Int32((m["dy"] as? NSNumber)?.intValue ?? 0), dx = Int32((m["dx"] as? NSNumber)?.intValue ?? 0)
        let e = CGEvent(scrollWheelEvent2Source: source, units: .line, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0)
        e?.flags = flagsOf(m); post(e)
        reply(["id": id, "ok": true])
    case "type":
        typeText(m["text"] as? String ?? ""); reply(["id": id, "ok": true])
    case "key":
        let code = CGKeyCode((m["code"] as? NSNumber)?.uint16Value ?? 0), f = flagsOf(m)
        let n = max(1, min(100, (m["repeat"] as? NSNumber)?.intValue ?? 1))
        for _ in 0..<n { key(code: code, flags: f, down: true); key(code: code, flags: f, down: false); nap(0.03) }
        reply(["id": id, "ok": true])
    case "hold":
        let code = CGKeyCode((m["code"] as? NSNumber)?.uint16Value ?? 0), f = flagsOf(m)
        let secs = max(0.05, min(300, (m["seconds"] as? NSNumber)?.doubleValue ?? 1))
        key(code: code, flags: f, down: true); nap(secs); key(code: code, flags: f, down: false)
        reply(["id": id, "ok": true])
    case "cursor":
        let p = here(); reply(["id": id, "ok": true, "x": p.x, "y": p.y])
    case "front":
        var r = frontInfo(); r["id"] = id; r["ok"] = true; reply(r)
    case "activate-under":
        // give the keyboard back to the app whose window is frontmost below Jarvis's own
        let skip = Int32((m["excludePid"] as? NSNumber)?.intValue ?? -1)
        var done = false
        if let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
            for w in list {
                guard let pid = w[kCGWindowOwnerPID as String] as? Int32, pid != skip, pid != getpid(),
                      (w[kCGWindowLayer as String] as? Int) == 0,
                      let app = NSRunningApplication(processIdentifier: pid), app.activationPolicy == .regular else { continue }
                app.activate(options: [.activateAllWindows])
                done = true
                break
            }
        }
        reply(["id": id, "ok": true, "activated": done])
    case "release":
        if leftHeld { post(CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: here(), mouseButton: .left)); leftHeld = false }
        reply(["id": id, "ok": true])
    default:
        reply(["id": id, "ok": false, "error": "unknown op"])
    }
}

// Watch the real mouse. Our own events carry MARK; anything else that moves the pointer more
// than a few points is the owner taking back control. Listen-only: nothing is changed or blocked.
var watchTap: CFMachPort?
var moved: CGFloat = 0
var movedSince = Date()
let mask: CGEventMask = (1 << CGEventType.mouseMoved.rawValue) | (1 << CGEventType.leftMouseDown.rawValue) |
    (1 << CGEventType.rightMouseDown.rawValue) | (1 << CGEventType.scrollWheel.rawValue) | (1 << CGEventType.leftMouseDragged.rawValue)
let callback: CGEventTapCallBack = { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let t = watchTap { CGEvent.tapEnable(tap: t, enable: true) }   // macOS paused the watch: turn it back on
        return Unmanaged.passUnretained(event)
    }
    if event.getIntegerValueField(.eventSourceUserData) == MARK { return Unmanaged.passUnretained(event) }
    if type == .mouseMoved || type == .leftMouseDragged {
        let dx = CGFloat(event.getIntegerValueField(.mouseEventDeltaX)), dy = CGFloat(event.getIntegerValueField(.mouseEventDeltaY))
        if Date().timeIntervalSince(movedSince) > 0.6 { moved = 0; movedSince = Date() }
        moved += abs(dx) + abs(dy)
        if moved < 12 { return Unmanaged.passUnretained(event) }
    }
    moved = 0
    reply(["event": "user-input"])
    return Unmanaged.passUnretained(event)
}
if let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                               eventsOfInterest: mask, callback: callback, userInfo: nil) {
    watchTap = tap
    if let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) {
        CFRunLoopAddSource(CFRunLoopGetMain(), src, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
    }
} else {
    reply(["event": "no-watch"])  // cannot watch the mouse (no permission yet); Escape still stops
}

let work = DispatchQueue(label: "jarvis.hands")
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine(strippingNewline: true) {
        guard let data = line.data(using: .utf8),
              let m = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { continue }
        work.async { handle(m) }
    }
    // Jarvis closed the pipe: let go of anything held and leave
    work.sync {
        if leftHeld { post(CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: here(), mouseButton: .left)) }
    }
    exit(0)
}

RunLoop.main.run()
