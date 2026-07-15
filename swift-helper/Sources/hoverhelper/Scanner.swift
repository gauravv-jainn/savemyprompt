import AppKit
import ApplicationServices

final class Scanner {

    let systemWide = AXUIElementCreateSystemWide()

    // Remember the last hovered message so we can re-sample its full context
    // when the shell asks us to `capture` (on save-button click).
    private var lastItem: AXUIElement?
    private var lastContainer: AXUIElement?
    private var lastHoverKey: String = ""
    private var lastAppPid: pid_t = 0
    private var enabledPids = Set<pid_t>()

    // MARK: - Frontmost target

    struct FocusedTarget {
        let app: NSRunningApplication
        let target: TargetApp
    }

    func frontmostTarget() -> FocusedTarget? {
        guard let app = NSWorkspace.shared.frontmostApplication,
              let t = Targets.match(app) else { return nil }
        // Turn on Chromium web-content AX once per process.
        if !enabledPids.contains(app.processIdentifier) {
            Targets.enableWebAccessibility(pid: app.processIdentifier)
            enabledPids.insert(app.processIdentifier)
        }
        return FocusedTarget(app: app, target: t)
    }

    // MARK: - Element under cursor

    func mouseLocation() -> CGPoint {
        // Global display coordinates, top-left origin — matches what
        // AXUIElementCopyElementAtPosition expects.
        return CGEvent(source: nil)?.location ?? .zero
    }

    func elementAt(_ p: CGPoint) -> AXUIElement? {
        var el: AXUIElement?
        let err = AXUIElementCopyElementAtPosition(systemWide, Float(p.x), Float(p.y), &el)
        return err == .success ? el : nil
    }

    // MARK: - Node info

    func rect(_ el: AXUIElement) -> Rect? {
        guard let f = AX.frame(el) else { return nil }
        return Rect(x: Double(f.origin.x), y: Double(f.origin.y),
                    w: Double(f.size.width), h: Double(f.size.height))
    }

    func domClassList(_ el: AXUIElement) -> [String]? {
        guard let v = AX.attr(el, "AXDOMClassList") else { return nil }
        return v as? [String]
    }

    func nodeInfo(_ el: AXUIElement, textLimit: Int = 4000) -> NodeInfo {
        var text = AX.collectText(el)
        if text.isEmpty { text = AX.text(el) }
        if text.count > textLimit { text = String(text.prefix(textLimit)) + "…" }
        return NodeInfo(
            role: AX.role(el),
            roleDescription: AX.string(el, kAXRoleDescriptionAttribute as String),
            subrole: AX.string(el, kAXSubroleAttribute as String),
            text: text,
            domClassList: domClassList(el),
            domIdentifier: AX.string(el, "AXDOMIdentifier"),
            frame: rect(el)
        )
    }

    // MARK: - Message heuristic

    /// Build the ancestor chain from `el` up to (but not including) the app root.
    func ancestry(of el: AXUIElement, max: Int = 16) -> [AXUIElement] {
        var chain: [AXUIElement] = [el]
        var cur = el
        for _ in 0..<max {
            guard let parent = AX.element(cur, kAXParentAttribute as String) else { break }
            // Stop at the application element.
            if AX.role(parent) == (kAXApplicationRole as String) { break }
            chain.append(parent)
            cur = parent
        }
        return chain
    }

    func textLength(_ el: AXUIElement) -> Int {
        AX.collectText(el).count
    }

    /// Given the element under the cursor, find (conversationContainer, messageItem).
    /// The container is the lowest ancestor whose children look like sibling
    /// conversation turns (>= 2 children each holding a meaningful chunk of text);
    /// the item is the child of that container on our path.
    func messageContainerAndItem(from target: AXUIElement) -> (container: AXUIElement, item: AXUIElement)? {
        let chain = ancestry(of: target)
        for i in 0..<max(0, chain.count - 1) {
            let item = chain[i]
            let container = chain[i + 1]
            let kids = AX.children(container)
            guard kids.count >= 2 else { continue }
            let textyKids = kids.filter { k in
                let n = textLength(k)
                return n >= 20 && n <= 40000
            }
            if textyKids.count >= 2 {
                let itemLen = textLength(item)
                if itemLen >= 1 && itemLen <= 40000 {
                    return (container, item)
                }
            }
        }
        // Fallback: the ancestor with the most text under a sane cap.
        var best: AXUIElement?
        var bestLen = 0
        for e in chain {
            let n = textLength(e)
            if n > bestLen && n <= 40000 { bestLen = n; best = e }
        }
        if let b = best, bestLen >= 20 {
            let parent = AX.element(b, kAXParentAttribute as String) ?? b
            return (parent, b)
        }
        return nil
    }

    /// Best-effort author from DOM classes / role description / leading text.
    func author(of item: AXUIElement) -> String? {
        let hay = [
            (domClassList(item) ?? []).joined(separator: " "),
            AX.string(item, "AXDOMIdentifier") ?? "",
            AX.string(item, kAXRoleDescriptionAttribute as String) ?? "",
            AX.string(item, kAXDescriptionAttribute as String) ?? "",
        ].joined(separator: " ").lowercased()

        if hay.contains("assistant") || hay.contains("chatgpt said") || hay.contains("claude") || hay.contains("agent-turn") {
            return "assistant"
        }
        if hay.contains("user") || hay.contains("you said") || hay.contains("human") {
            return "user"
        }
        return nil
    }

    func messageInfo(_ item: AXUIElement, textLimit: Int = 8000) -> MessageInfo {
        var text = AX.collectText(item)
        if text.count > textLimit { text = String(text.prefix(textLimit)) + "…" }
        return MessageInfo(author: author(of: item), text: text, frame: rect(item))
    }

    // MARK: - Hover sampling

    struct HoverResult {
        let app: NSRunningApplication
        let mouse: CGPoint
        let item: AXUIElement
        let container: AXUIElement
        let message: MessageInfo
        let anchor: Rect
        let key: String
    }

    /// Sample once. Returns a HoverResult if a message is under the cursor.
    func sampleHover() -> HoverResult? {
        guard let focus = frontmostTarget() else { return nil }
        let mouse = mouseLocation()
        guard let target = elementAt(mouse) else { return nil }
        guard let (container, item) = messageContainerAndItem(from: target) else { return nil }
        let msg = messageInfo(item)
        guard !msg.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        guard let f = rect(item) else { return nil }
        // Anchor the save button just outside the top-right corner of the bubble.
        let anchor = Rect(x: f.x + f.w, y: f.y, w: 0, h: 0)
        let key = "\(Int(f.x)),\(Int(f.y)),\(Int(f.w))x\(Int(f.h))|\(msg.text.prefix(48))"
        lastItem = item
        lastContainer = container
        lastHoverKey = key
        lastAppPid = focus.app.processIdentifier
        return HoverResult(app: focus.app, mouse: mouse, item: item, container: container,
                           message: msg, anchor: anchor, key: key)
    }

    /// Re-sample the surrounding conversation for the last hovered message.
    /// Returns the hovered message plus up to `window` neighbouring turns in order.
    func captureContext(window: Int = 10) -> (app: NSRunningApplication, hovered: MessageInfo, context: [MessageInfo])? {
        guard let item = lastItem, let container = lastContainer,
              let app = NSRunningApplication(processIdentifier: lastAppPid) else { return nil }
        let kids = AX.children(container)
        // Find hovered item's index among the container's children by identity.
        var idx = -1
        for (i, k) in kids.enumerated() where CFEqual(k, item) { idx = i; break }
        let turns: [AXUIElement]
        if idx >= 0 {
            let lo = max(0, idx - window)
            let hi = min(kids.count - 1, idx + 2) // a little following context too
            turns = Array(kids[lo...hi])
        } else {
            turns = [item]
        }
        let context = turns
            .map { messageInfo($0) }
            .filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        return (app, messageInfo(item), context)
    }

    var currentHoverKey: String { lastHoverKey }
}
