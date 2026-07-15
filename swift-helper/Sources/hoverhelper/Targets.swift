import AppKit
import ApplicationServices

// The two apps we support in v1. Matched by bundle id first, then by name as a
// fallback (bundle ids can drift across app versions / TestFlight builds).
struct TargetApp {
    let bundleId: String
    let displayName: String
    let nameMatches: [String]
}

enum Targets {
    static let all: [TargetApp] = [
        TargetApp(bundleId: "com.openai.chat",
                  displayName: "ChatGPT",
                  nameMatches: ["chatgpt"]),
        TargetApp(bundleId: "com.anthropic.claudefordesktop",
                  displayName: "Claude",
                  nameMatches: ["claude"]),
    ]

    /// Returns the matching TargetApp if `app` is one we support.
    static func match(_ app: NSRunningApplication) -> TargetApp? {
        let bid = app.bundleIdentifier?.lowercased() ?? ""
        let name = app.localizedName?.lowercased() ?? ""
        for t in all {
            if bid == t.bundleId.lowercased() { return t }
            if t.nameMatches.contains(where: { name == $0 || name.contains($0) }) {
                // Guard against unrelated apps that merely contain the word.
                if bid.contains("openai") || bid.contains("anthropic") || bid.contains("chatgpt") || bid.contains("claude") {
                    return t
                }
            }
        }
        return nil
    }

    /// Chromium/Electron apps expose their web-content accessibility tree lazily.
    /// Setting AXManualAccessibility (Chromium) / AXEnhancedUserInterface turns it
    /// on so message DOM nodes become readable AX elements.
    static func enableWebAccessibility(pid: pid_t) {
        let appEl = AXUIElementCreateApplication(pid)
        AX.setBool(appEl, "AXManualAccessibility", true)
        AX.setBool(appEl, "AXEnhancedUserInterface", true)
    }
}
