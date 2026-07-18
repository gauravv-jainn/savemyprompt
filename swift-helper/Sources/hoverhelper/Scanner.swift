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
        messageText(el).count
    }

    // MARK: - Chrome-aware message text

    /// AX roles that are UI chrome, never message content. Their subtrees are
    /// skipped entirely when collecting a message's text.
    static let chromeRoles: Set<String> = [
        "AXButton", "AXPopUpButton", "AXMenuButton", "AXRadioButton", "AXCheckBox",
        "AXTextField", "AXTextArea", "AXComboBox", "AXSearchField",
        "AXToolbar", "AXMenu", "AXMenuBar", "AXMenuItem", "AXTabGroup", "AXSlider",
    ]

    /// Exact lines (lowercased) that are app chrome, not message text.
    static let chromeLines: Set<String> = [
        "write a message…", "write a message...", "reply to claude…", "reply to claude...",
        "message chatgpt", "message claude", "send message", "send", "stop",
        "chat mode", "type / for commands", "effort:", "extra", "medium", "high", "low",
        "claude is ai and can make mistakes. please double-check responses.",
        "chatgpt can make mistakes. check important info.",
        "claude finished the response", "copy", "edit", "edited", "a file", "retry",
        "good response", "bad response", "share", "regenerate",
    ]

    /// Line prefixes (lowercased) that mark status/announcer chrome.
    static let chromePrefixes: [String] = [
        "claude responded:", "claude finished", "chatgpt said:", "you said:",
        "effort:", "thought for", "reasoned for", "searched",
    ]

    /// Collect a message's text: walk only content (AXStaticText / groups),
    /// skipping chrome-role subtrees, dropping chrome lines, and de-duplicating
    /// consecutive repeats (Chromium often exposes a value + a label twice).
    func messageText(_ el: AXUIElement, limit: Int = 8000, maxDepth: Int = 22) -> String {
        var parts: [String] = []
        func walk(_ e: AXUIElement, _ depth: Int) {
            if depth > maxDepth { return }
            let r = AX.role(e)
            if Scanner.chromeRoles.contains(r) { return } // skip toolbars/inputs/buttons
            if r == (kAXStaticTextRole as String) {
                let t = AX.text(e).trimmingCharacters(in: .whitespacesAndNewlines)
                if !t.isEmpty { parts.append(t) }
                return
            }
            // A group can carry its own value text too.
            if let own = AX.string(e, kAXValueAttribute as String) {
                let t = own.trimmingCharacters(in: .whitespacesAndNewlines)
                if !t.isEmpty { parts.append(t) }
            }
            for c in AX.children(e) { walk(c, depth + 1) }
        }
        walk(el, 0)

        var out: [String] = []
        for p in parts {
            let low = p.lowercased()
            if Scanner.chromeLines.contains(low) { continue }
            if Scanner.chromePrefixes.contains(where: { low.hasPrefix($0) }) { continue }
            if low.count <= 3, low.allSatisfy({ $0.isNumber }) { continue } // stray counters
            if out.last == p { continue }                                   // consecutive dup
            out.append(p)
        }
        var text = out.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        if text.count > limit { text = String(text.prefix(limit)) + "…" }
        return text
    }

    // MARK: - Message identification by DOM class

    /// Class-name fragments that mark a real message turn / content in the two
    /// supported apps. Used to snap to the correct element instead of guessing.
    static let messageMarkers: [String] = [
        "font-claude-message", "font-user-message", "font-claude-response",
        "user-query", "agent-turn", "message-content", "markdown", "prose",
        "whitespace-pre-wrap", "user-message-bubble",
    ]

    func matchesMessageMarker(_ el: AXUIElement) -> Bool {
        let cls = (domClassList(el) ?? []).joined(separator: " ").lowercased()
        if cls.isEmpty { return false }
        return Scanner.messageMarkers.contains { cls.contains($0) }
    }

    /// Is the cursor inside the message composer (input box)? If so, we never
    /// offer to save — that's chrome, not a saved prompt.
    func isInComposer(_ target: AXUIElement) -> Bool {
        var cur = target
        for _ in 0..<8 {
            let r = AX.role(cur)
            if r == "AXTextArea" || r == "AXTextField" || r == "AXSearchField" { return true }
            let cls = (domClassList(cur) ?? []).joined(separator: " ").lowercased()
            if cls.contains("composer") || cls.contains("ProseMirror".lowercased()) { return true }
            guard let p = AX.element(cur, kAXParentAttribute as String) else { break }
            cur = p
        }
        return false
    }

    /// Walk up to the nearest ancestor that is a real message turn (by DOM class).
    /// Returns (container, item) where container holds sibling turns for context.
    func messageByDOM(from target: AXUIElement) -> (container: AXUIElement, item: AXUIElement)? {
        var cur = target
        var item: AXUIElement?
        for _ in 0..<24 {
            if matchesMessageMarker(cur) { item = cur; break }
            guard let p = AX.element(cur, kAXParentAttribute as String),
                  AX.role(p) != (kAXApplicationRole as String) else { break }
            cur = p
        }
        guard let msg = item else { return nil }
        // Container = nearest ancestor that has >= 2 message-marked descendants,
        // else the message's parent.
        var c = AX.element(msg, kAXParentAttribute as String) ?? msg
        for _ in 0..<6 {
            let markedKids = AX.children(c).filter { descendantHasMarker($0, depth: 4) }
            if markedKids.count >= 2 { break }
            guard let p = AX.element(c, kAXParentAttribute as String),
                  AX.role(p) != (kAXApplicationRole as String) else { break }
            c = p
        }
        return (c, msg)
    }

    private func descendantHasMarker(_ el: AXUIElement, depth: Int) -> Bool {
        if matchesMessageMarker(el) { return true }
        if depth <= 0 { return false }
        for c in AX.children(el) where descendantHasMarker(c, depth: depth - 1) { return true }
        return false
    }

    /// Given the element under the cursor, find (conversationContainer, messageItem).
    /// The container is the lowest ancestor whose children look like sibling
    /// conversation turns (>= 2 children each holding a meaningful chunk of text);
    /// the item is the child of that container on our path.
    func messageContainerAndItem(from target: AXUIElement) -> (container: AXUIElement, item: AXUIElement)? {
        // Never treat the composer/input as a message.
        if isInComposer(target) { return nil }
        // Prefer snapping to a real message turn by its DOM class.
        if let dom = messageByDOM(from: target) { return dom }
        // Fallback heuristic (chrome-aware textLength now excludes buttons/inputs).
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
        let text = messageText(item, limit: textLimit)
        return MessageInfo(
            author: author(of: item),
            text: text,
            frame: rect(item),
            role: AX.role(item),
            domClass: domClassList(item)
        )
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

    func pidOf(_ el: AXUIElement) -> pid_t {
        var p: pid_t = 0
        AXUIElementGetPid(el, &p)
        return p
    }

    /// For browsers: is the hovered element inside a chatgpt.com / claude.ai page?
    /// Reads the enclosing web area's URL (precise); falls back to the window title.
    func isOnAIChat(from el: AXUIElement) -> Bool {
        var cur = el
        var windowTitle: String?
        for _ in 0..<60 {
            let role = AX.role(cur)
            if role == "AXWebArea",
               let u = AX.attr(cur, "AXURL"),
               let host = (u as? NSURL)?.host {
                return Targets.isAIHost(host)
            }
            if role == (kAXWindowRole as String) {
                windowTitle = AX.string(cur, kAXTitleAttribute as String)
            }
            guard let p = AX.element(cur, kAXParentAttribute as String) else { break }
            cur = p
        }
        if let t = windowTitle?.lowercased() {
            return t.contains("claude") || t.contains("chatgpt")
        }
        return false
    }

    /// Sample once. Returns a HoverResult if a message is under the cursor.
    func sampleHover() -> HoverResult? {
        guard let focus = frontmostTarget() else { return nil }
        let mouse = mouseLocation()
        guard let target = elementAt(mouse) else { return nil }
        // Validity gate depends on the surface:
        switch focus.target.kind {
        case .desktop:
            // The element must belong to the ChatGPT/Claude process — not our own
            // always-on-top panel or any other window under the pointer.
            let ownerPid = pidOf(target)
            guard ownerPid == focus.app.processIdentifier, ownerPid != getpid() else { return nil }
        case .browser:
            // Only fire when the browser is actually on an AI-chat page.
            guard isOnAIChat(from: target) else { return nil }
        }
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
