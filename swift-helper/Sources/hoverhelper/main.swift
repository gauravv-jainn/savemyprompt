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
