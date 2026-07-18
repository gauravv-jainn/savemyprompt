import AppKit
import ApplicationServices
import Foundation

// hoverhelper — the native Accessibility side of SaveMyPrompt.
//
// Modes:
//   (default)            Human-readable discovery dump. Hover over ChatGPT /
//                        Claude messages and it prints the AX node under the
//                        cursor, its attributes, ancestry, and the detected
//                        message element. This is Phase 1's verification tool.
//   --json               NDJSON stream for the Electron shell (Phase 2+).
//                        Emits {kind:"hover"|"clear"|"status"|"captured"} lines.
//                        Reads "capture" / "quit" commands on stdin.
//   --check-permissions  Print Accessibility trust status and exit.
//   --once               Take a single sample and exit (works in either mode).
//   --interval <ms>      Polling interval (default 120ms).
//   --no-prompt          Do not open the System Settings permission prompt.

struct Options {
    var json = false
    var once = false
    var checkPermissions = false
    var prompt = true
    var interval: TimeInterval = 0.12
    var dumpTree = false
    var scan = false
    var delay: Double = 0
    var depth = 70

    static func parse(_ argv: [String]) -> Options {
        var o = Options()
        var i = 1
        while i < argv.count {
            switch argv[i] {
            case "--json": o.json = true
            case "--once": o.once = true
            case "--check-permissions": o.checkPermissions = true
            case "--no-prompt": o.prompt = false
            case "--interval":
                i += 1
                if i < argv.count, let ms = Double(argv[i]) { o.interval = ms / 1000.0 }
            case "--dump-tree": o.dumpTree = true
            case "--scan": o.scan = true
            case "--delay":
                i += 1
                if i < argv.count, let d = Double(argv[i]) { o.delay = d }
            case "--depth":
                i += 1
                if i < argv.count, let d = Int(argv[i]) { o.depth = d }
            case "--help", "-h":
                printUsage(); exit(0)
            default:
                FileHandle.standardError.write("unknown option: \(argv[i])\n".data(using: .utf8)!)
            }
            i += 1
        }
        return o
    }
}

func printUsage() {
    print("""
    hoverhelper — SaveMyPrompt accessibility helper

    usage: hoverhelper [--json] [--once] [--interval ms] [--no-prompt]
                       [--check-permissions]

    Run with no flags, focus ChatGPT or Claude desktop, and hover over
    messages to see how they surface in the accessibility tree.
    """)
}

func now() -> Double { Date().timeIntervalSince1970 }

func isTrusted(prompt: Bool) -> Bool {
    let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    let opts = [key: prompt] as CFDictionary
    return AXIsProcessTrustedWithOptions(opts)
}

// MARK: - JSON emission

let encoder = JSONEncoder()
func emit(_ event: HoverEvent) {
    guard let data = try? encoder.encode(event),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

func rectFrom(_ f: CGRect) -> Rect {
    Rect(x: Double(f.origin.x), y: Double(f.origin.y),
         w: Double(f.size.width), h: Double(f.size.height))
}

// MARK: - Human-readable dump

func printDump(_ scanner: Scanner) {
    guard let focus = scanner.frontmostTarget() else {
        FileHandle.standardError.write("… waiting: focus ChatGPT or Claude desktop and hover a message\n".data(using: .utf8)!)
        return
    }
    let mouse = scanner.mouseLocation()
    guard let target = scanner.elementAt(mouse) else {
        FileHandle.standardError.write("… no AX element under cursor at (\(Int(mouse.x)),\(Int(mouse.y)))\n".data(using: .utf8)!)
        return
    }

    var out = ""
    out += "──────────────────────────────────────────────────────────────\n"
    out += "app        \(focus.target.displayName)  [\(focus.app.bundleIdentifier ?? "?")]  pid \(focus.app.processIdentifier)\n"
    out += "cursor     (\(Int(mouse.x)), \(Int(mouse.y)))\n"

    let ti = scanner.nodeInfo(target, textLimit: 200)
    out += "target     role=\(ti.role)"
    if let sr = ti.subrole { out += " subrole=\(sr)" }
    if let rd = ti.roleDescription { out += " desc=\"\(rd)\"" }
    if let f = ti.frame { out += " frame=(\(Int(f.x)),\(Int(f.y)) \(Int(f.w))x\(Int(f.h)))" }
    out += "\n"
    if let cl = ti.domClassList, !cl.isEmpty { out += "  domClass \(cl.prefix(6).joined(separator: " "))\n" }
    if let id = ti.domIdentifier { out += "  domId    \(id)\n" }
    if !ti.text.isEmpty { out += "  text     \"\(ti.text.replacingOccurrences(of: "\n", with: " ⏎ "))\"\n" }

    // All attribute names — reveals Chromium DOM attrs useful for discovery.
    let names = AX.attributeNames(target)
    out += "  attrs    \(names.joined(separator: ", "))\n"

    // Ancestry chain.
    out += "ancestry (cursor → up):\n"
    let chain = scanner.ancestry(of: target)
    for (i, el) in chain.enumerated() {
        let r = AX.role(el)
        let f = AX.frame(el)
        let len = AX.collectText(el).count
        let cl = scanner.domClassList(el)?.prefix(3).joined(separator: " ") ?? ""
        let frameStr = f.map { "(\(Int($0.origin.x)),\(Int($0.origin.y)) \(Int($0.width))x\(Int($0.height)))" } ?? "-"
        out += String(format: "  %2d  %-16@ %@ textlen=%d %@\n",
                      i, r as NSString, frameStr as NSString, len, cl as NSString)
    }

    // Detected message element.
    if let (container, item) = scanner.messageContainerAndItem(from: target) {
        let msg = scanner.messageInfo(item, textLimit: 240)
        out += "MESSAGE ✓\n"
        out += "  container role=\(AX.role(container)) children=\(AX.children(container).count)\n"
        out += "  item      role=\(AX.role(item)) author=\(msg.author ?? "?")"
        if let f = msg.frame { out += " frame=(\(Int(f.x)),\(Int(f.y)) \(Int(f.w))x\(Int(f.h)))" }
        out += "\n"
        out += "  preview   \"\(msg.text.replacingOccurrences(of: "\n", with: " ⏎ "))\"\n"
    } else {
        out += "MESSAGE ✗  (no clean message node detected here)\n"
    }
    print(out, terminator: "")
    fflush(stdout)
}

// MARK: - Run

let opts = Options.parse(CommandLine.arguments)

if opts.checkPermissions {
    let trusted = isTrusted(prompt: false)
    print("accessibility: \(trusted ? "GRANTED" : "NOT GRANTED")")
    exit(trusted ? 0 : 1)
}

// Ensure we are trusted; poll until granted so the user can flip the switch
// live in System Settings without restarting the helper.
if !isTrusted(prompt: opts.prompt) {
    if opts.json {
        emit(HoverEvent(kind: .status, timestamp: now(),
                        message: "Accessibility permission not granted. Grant it in System Settings ▸ Privacy & Security ▸ Accessibility.",
                        app: nil, mouse: nil, hovered: nil, anchor: nil, context: nil,
                        permissionGranted: false))
    } else {
        FileHandle.standardError.write("""
        ⚠️  Accessibility permission not granted.
            System Settings ▸ Privacy & Security ▸ Accessibility → enable this tool
            (or your terminal, while testing). Waiting for it to be granted…\n
        """.data(using: .utf8)!)
    }
    if opts.once { exit(1) }
    // Block until granted.
    while !isTrusted(prompt: false) { usleep(500_000) }
}

if opts.json {
    emit(HoverEvent(kind: .status, timestamp: now(),
                    message: "hoverhelper ready", app: nil, mouse: nil,
                    hovered: nil, anchor: nil, context: nil, permissionGranted: true))
}

let scanner = Scanner()

func runningTarget() -> (app: NSRunningApplication, target: TargetApp)? {
    var picked: (app: NSRunningApplication, target: TargetApp)?
    for app in NSWorkspace.shared.runningApplications {
        if let t = Targets.match(app) { picked = (app, t); if app.isActive { break } }
    }
    return picked
}

func targetWindowBounds(pid: pid_t) -> CGRect? {
    guard let list = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
    var best: CGRect?
    var bestArea: CGFloat = 0
    for w in list {
        guard (w[kCGWindowOwnerPID as String] as? pid_t) == pid else { continue }
        let layer = (w[kCGWindowLayer as String] as? Int) ?? 0
        if layer != 0 { continue }
        guard let bdict = w[kCGWindowBounds as String] as? [String: Any],
              let r = CGRect(dictionaryRepresentation: bdict as CFDictionary) else { continue }
        let area = r.width * r.height
        if area > bestArea { bestArea = area; best = r }
    }
    return best
}

func escNL(_ s: String) -> String {
    s.replacingOccurrences(of: "\n", with: "⏎").replacingOccurrences(of: "\t", with: " ")
}

// MARK: - Scan (diagnostic via hit-testing, which works where top-down doesn't).
// Hit-tests a grid over the Claude/ChatGPT window, finds the conversation
// container, dumps its real subtree + a summary of detected message turns.
if opts.scan {
    if opts.delay > 0 {
        FileHandle.standardError.write("waiting \(opts.delay)s — bring Claude/ChatGPT to the front now…\n".data(using: .utf8)!)
        usleep(useconds_t(opts.delay * 1_000_000))
    }
    guard let focus = runningTarget() else {
        FileHandle.standardError.write("no running ChatGPT or Claude desktop found — open one first\n".data(using: .utf8)!)
        exit(1)
    }
    let pid = focus.app.processIdentifier
    Targets.enableWebAccessibility(pid: pid)
    usleep(500_000)

    // Scan a grid over every active display; keep only hits that belong to the
    // target process (so we don't need its window bounds, which Electron hides).
    func pidOf(_ el: AXUIElement) -> pid_t { var p: pid_t = 0; AXUIElementGetPid(el, &p); return p }
    var displays: [CGRect] = []
    var dcount: UInt32 = 0
    CGGetActiveDisplayList(0, nil, &dcount)
    if dcount > 0 {
        var ids = [CGDirectDisplayID](repeating: 0, count: Int(dcount))
        CGGetActiveDisplayList(dcount, &ids, &dcount)
        displays = ids.map { CGDisplayBounds($0) }
    }
    if displays.isEmpty { displays = [CGRect(x: 0, y: 0, width: 1440, height: 900)] }
    FileHandle.standardError.write("scanning \(displays.count) display(s) for \(focus.target.displayName) (pid \(pid))…\n".data(using: .utf8)!)

    var bestContainer: AXUIElement?
    var bestChildCount = 0
    var items: [(y: Int, el: AXUIElement)] = []
    var seenY = Set<Int>()
    var totalEls = 0
    var pidCounts: [pid_t: Int] = [:]
    for disp in displays {
        let xs = [disp.minX + disp.width * 0.25, disp.minX + disp.width * 0.40,
                  disp.midX, disp.minX + disp.width * 0.60, disp.minX + disp.width * 0.75]
        var y = disp.minY + 40
        while y < disp.maxY - 40 {
            for x in xs {
                guard let el = scanner.elementAt(CGPoint(x: x, y: y)) else { continue }
                totalEls += 1
                pidCounts[pidOf(el), default: 0] += 1
                // No pid filter: Electron web content lives in a renderer pid.
                // Rely on the message heuristic to keep only conversation hits.
                guard let (container, item) = scanner.messageContainerAndItem(from: el) else { continue }
                let txt = AX.collectText(item)
                if txt.count < 15 { continue }
                let cc = AX.children(container).count
                if cc > bestChildCount { bestChildCount = cc; bestContainer = container }
                if let f = AX.frame(item) {
                    let key = Int(f.origin.y / 8)
                    if !seenY.contains(key) { seenY.insert(key); items.append((Int(f.origin.y), item)) }
                }
            }
            y += 16
        }
    }
    let pidReport = pidCounts.sorted { $0.value > $1.value }.prefix(6)
        .map { "pid \($0.key)=\($0.value)" }.joined(separator: ", ")
    FileHandle.standardError.write("elements hit: \(totalEls) across pids [\(pidReport)]  (app pid \(pid))\n".data(using: .utf8)!)

    var out = ""
    // 1) The current heuristic's picks (what the app would grab).
    out += "===== DETECTED MESSAGE ITEMS (current heuristic) =====\n"
    for it in items.sorted(by: { $0.y < $1.y }) {
        let m = scanner.messageInfo(it.el, textLimit: 120)
        let dom = scanner.domClassList(it.el)?.prefix(4).joined(separator: ".") ?? ""
        let f = m.frame
        out += "y=\(it.y) author=\(m.author ?? "?") role=\(AX.role(it.el)) dom=\(dom) len=\(m.text.count)"
        if let f = f { out += " frame=(\(Int(f.x)),\(Int(f.y)) \(Int(f.w))x\(Int(f.h)))" }
        out += "\n   “\(escNL(String(m.text.prefix(120))))”\n"
    }

    // 2) The conversation container's real subtree (structure ground-truth).
    if let c = bestContainer {
        out += "\n===== CONVERSATION CONTAINER SUBTREE (\(bestChildCount) direct children) =====\n"
        var nodes = 0
        func walk(_ el: AXUIElement, _ d: Int) {
            if d > opts.depth || nodes >= 4000 { return }
            nodes += 1
            let role = AX.role(el)
            let sub = AX.string(el, kAXSubroleAttribute as String)
            let rd = AX.string(el, kAXRoleDescriptionAttribute as String)
            let dom = scanner.domClassList(el)?.prefix(5).joined(separator: ".") ?? ""
            let domId = AX.string(el, "AXDOMIdentifier") ?? ""
            let full = AX.collectText(el)
            var line = String(repeating: "  ", count: d) + "[\(role)"
            if let s = sub { line += "/\(s)" }
            line += "]"
            if let rd = rd, !rd.isEmpty { line += " desc=\"\(escNL(rd))\"" }
            if !dom.isEmpty { line += " dom=\(dom)" }
            if !domId.isEmpty { line += " id=\(domId)" }
            line += " len=\(full.count)"
            if role == (kAXStaticTextRole as String) || d >= opts.depth {
                let snip = escNL(String(full.prefix(70)))
                if !snip.isEmpty { line += "  “\(snip)”" }
            }
            out += line + "\n"
            for ch in AX.children(el) { walk(ch, d + 1) }
        }
        walk(c, 0)
    } else {
        out += "\n(no conversation container found by hit-testing — window may be empty)\n"
    }
    print(out, terminator: "")
    FileHandle.standardError.write("scan complete — \(items.count) message items detected\n".data(using: .utf8)!)
    exit(0)
}

// MARK: - Full-tree dump (diagnostic). Focus Claude/ChatGPT with a conversation
// visible, run `hoverhelper --dump-tree > tree.txt`, to see how messages are
// laid out in the accessibility tree.
if opts.dumpTree {
    // Find a running ChatGPT/Claude app — no need for it to be frontmost, so the
    // user can run this straight from a terminal.
    var picked: (app: NSRunningApplication, target: TargetApp)?
    for app in NSWorkspace.shared.runningApplications {
        if let t = Targets.match(app) { picked = (app, t); if app.isActive { break } }
    }
    guard let focus = picked else {
        FileHandle.standardError.write("no running ChatGPT or Claude desktop found — open one first\n".data(using: .utf8)!)
        exit(1)
    }
    let appEl = AXUIElementCreateApplication(focus.app.processIdentifier)
    // Chromium builds its a11y tree lazily. Set the enable attributes and poll
    // (re-setting each round) until windows/children appear.
    var roots: [AXUIElement] = []
    for attempt in 0..<24 { // up to ~6s
        Targets.enableWebAccessibility(pid: focus.app.processIdentifier)
        var found = AX.children(appEl)
        if found.isEmpty, let v = AX.attr(appEl, kAXWindowsAttribute as String),
           CFGetTypeID(v) == CFArrayGetTypeID(), let arr = v as? [AXUIElement] {
            found = arr
        }
        if !found.isEmpty { roots = found; break }
        if attempt == 0 {
            FileHandle.standardError.write("waiting for Claude/ChatGPT a11y tree to build…\n".data(using: .utf8)!)
        }
        usleep(250_000)
    }
    if roots.isEmpty {
        FileHandle.standardError.write("a11y tree never populated — is a conversation window open and visible?\n".data(using: .utf8)!)
        exit(2)
    }
    FileHandle.standardError.write("dumping AX tree for \(focus.target.displayName) — \(roots.count) window(s), depth \(opts.depth)…\n".data(using: .utf8)!)

    var out = ""
    var nodes = 0
    let cap = 6000
    func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "\n", with: "⏎").replacingOccurrences(of: "\t", with: " ")
    }
    func walk(_ el: AXUIElement, _ d: Int) {
        if d > opts.depth || nodes >= cap { return }
        nodes += 1
        let role = AX.role(el)
        let sub = AX.string(el, kAXSubroleAttribute as String)
        let rd = AX.string(el, kAXRoleDescriptionAttribute as String)
        let dom = scanner.domClassList(el)?.prefix(5).joined(separator: ".") ?? ""
        let domId = AX.string(el, "AXDOMIdentifier") ?? ""
        let own = AX.string(el, kAXValueAttribute as String) ?? AX.text(el)
        let full = AX.collectText(el)
        let indent = String(repeating: "  ", count: d)
        var line = "\(indent)[\(role)"
        if let s = sub { line += "/\(s)" }
        line += "]"
        if let rd = rd, !rd.isEmpty { line += " desc=\"\(esc(rd))\"" }
        if !dom.isEmpty { line += " dom=\(dom)" }
        if !domId.isEmpty { line += " id=\(domId)" }
        line += " len=\(full.count)"
        let snip = esc(String((own.isEmpty ? full : own).prefix(80)))
        if !snip.isEmpty { line += "  “\(snip)”" }
        out += line + "\n"
        for c in AX.children(el) { walk(c, d + 1) }
    }
    for r in roots { walk(r, 0) }
    if nodes >= cap { out += "… (truncated at \(cap) nodes)\n" }
    print(out, terminator: "")
    FileHandle.standardError.write("done — \(nodes) nodes\n".data(using: .utf8)!)
    exit(0)
}

if opts.once {
    if opts.json {
        if let r = scanner.sampleHover() {
            emit(HoverEvent(kind: .hover, timestamp: now(),
                            message: nil,
                            app: AppInfo(bundleId: r.app.bundleIdentifier ?? "",
                                         name: r.app.localizedName ?? "",
                                         pid: r.app.processIdentifier),
                            mouse: ["x": Double(r.mouse.x), "y": Double(r.mouse.y)],
                            hovered: r.message, anchor: r.anchor, context: nil,
                            permissionGranted: true))
        } else {
            emit(HoverEvent(kind: .clear, timestamp: now(), message: nil, app: nil,
                            mouse: nil, hovered: nil, anchor: nil, context: nil,
                            permissionGranted: true))
        }
    } else {
        printDump(scanner)
    }
    exit(0)
}

// JSON mode: accept stdin commands ("capture", "quit").
if opts.json {
    let stdin = FileHandle.standardInput
    var buffer = Data()
    stdin.readabilityHandler = { handle in
        let chunk = handle.availableData
        if chunk.isEmpty { return }
        buffer.append(chunk)
        while let nl = buffer.firstIndex(of: 0x0A) {
            let lineData = buffer.subdata(in: buffer.startIndex..<nl)
            buffer.removeSubrange(buffer.startIndex...nl)
            let cmd = String(data: lineData, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            switch cmd {
            case "capture":
                if let cap = scanner.captureContext() {
                    emit(HoverEvent(kind: .captured, timestamp: now(), message: nil,
                                    app: AppInfo(bundleId: cap.app.bundleIdentifier ?? "",
                                                 name: cap.app.localizedName ?? "",
                                                 pid: cap.app.processIdentifier),
                                    mouse: nil, hovered: cap.hovered, anchor: nil,
                                    context: cap.context, permissionGranted: true))
                } else {
                    emit(HoverEvent(kind: .status, timestamp: now(),
                                    message: "nothing to capture", app: nil, mouse: nil,
                                    hovered: nil, anchor: nil, context: nil,
                                    permissionGranted: true))
                }
            case "quit":
                exit(0)
            default:
                break
            }
        }
    }
}

// Poll loop.
var hadHover = false
var lastKey = ""
var lastFocusName: String? = nil

let timer = Timer(timeInterval: opts.interval, repeats: true) { _ in
    if opts.json {
        // Emit focus changes as status events.
        let focusName = scanner.frontmostTarget()?.target.displayName
        if focusName != lastFocusName {
            lastFocusName = focusName
            emit(HoverEvent(kind: .status, timestamp: now(),
                            message: focusName != nil ? "focus:\(focusName!)" : "focus:none",
                            app: nil, mouse: nil, hovered: nil, anchor: nil, context: nil,
                            permissionGranted: true))
        }
        if let r = scanner.sampleHover() {
            if r.key != lastKey {
                lastKey = r.key
                hadHover = true
                emit(HoverEvent(kind: .hover, timestamp: now(), message: nil,
                                app: AppInfo(bundleId: r.app.bundleIdentifier ?? "",
                                             name: r.app.localizedName ?? "",
                                             pid: r.app.processIdentifier),
                                mouse: ["x": Double(r.mouse.x), "y": Double(r.mouse.y)],
                                hovered: r.message, anchor: r.anchor, context: nil,
                                permissionGranted: true))
            }
        } else if hadHover {
            hadHover = false
            lastKey = ""
            emit(HoverEvent(kind: .clear, timestamp: now(), message: nil, app: nil,
                            mouse: nil, hovered: nil, anchor: nil, context: nil,
                            permissionGranted: true))
        }
    } else {
        // Human-readable: reprint only when the hovered message changes.
        if scanner.sampleHover() != nil {
            if scanner.currentHoverKey != lastKey {
                lastKey = scanner.currentHoverKey
                printDump(scanner)
            }
        }
    }
}
RunLoop.main.add(timer, forMode: .common)

if !opts.json {
    FileHandle.standardError.write("hoverhelper running — focus ChatGPT/Claude and hover over messages (Ctrl-C to stop)\n".data(using: .utf8)!)
}
RunLoop.main.run()
