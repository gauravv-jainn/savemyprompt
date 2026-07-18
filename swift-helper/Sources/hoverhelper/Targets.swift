import AppKit
import ApplicationServices

// v1 targets: the ChatGPT & Claude desktop apps, PLUS any browser showing
// chatgpt.com / claude.ai. Browsers are gated by the page URL so the app never
// fires on unrelated websites.
enum TargetKind { case desktop, browser }

struct TargetApp {
    let displayName: String
    let kind: TargetKind
}

enum Targets {
    // Desktop chat apps (Electron) — matched by bundle id.
    static let desktopBundles: [String: String] = [
        "com.openai.chat": "ChatGPT",
        "com.anthropic.claudefordesktop": "Claude",
    ]

    // Browsers — matched by bundle id (or Chrome PWA prefix). Gated by page URL.
    static let browserBundles: [String: String] = [
        "com.apple.safari": "Safari",
        "com.apple.safaritechnologypreview": "Safari",
        "com.google.chrome": "Chrome",
        "com.google.chrome.canary": "Chrome",
        "com.microsoft.edgemac": "Edge",
        "com.brave.browser": "Brave",
        "company.thebrowser.browser": "Arc",
        "org.mozilla.firefox": "Firefox",
        "com.vivaldi.vivaldi": "Vivaldi",
    ]

    static let aiHosts = ["claude.ai", "chatgpt.com", "chat.openai.com"]

    /// Returns the matching TargetApp if `app` is one we support.
    static func match(_ app: NSRunningApplication) -> TargetApp? {
        let bid = (app.bundleIdentifier ?? "").lowercased()
        if let name = desktopBundles[bid] {
            return TargetApp(displayName: name, kind: .desktop)
        }
        if let name = browserBundles[bid] {
            return TargetApp(displayName: name, kind: .browser)
        }
        // Chrome / Edge PWAs installed from a site run as com.google.Chrome.app.<id>.
        if bid.hasPrefix("com.google.chrome.app.") || bid.hasPrefix("com.microsoft.edgemac.app.") {
            return TargetApp(displayName: "Web App", kind: .browser)
        }
        // Name fallback for the desktop apps (bundle ids can drift).
        let name = (app.localizedName ?? "").lowercased()
        if (bid.contains("openai") || bid.contains("anthropic")) &&
           (name == "chatgpt" || name == "claude") {
            return TargetApp(displayName: app.localizedName ?? name, kind: .desktop)
        }
        return nil
    }

    static func isAIHost(_ host: String) -> Bool {
        let h = host.lowercased()
        return aiHosts.contains { h == $0 || h.hasSuffix("." + $0) }
    }

    /// Chromium/Electron/Safari expose web-content accessibility lazily. Turn it
    /// on so message DOM nodes and the page URL become readable.
    static func enableWebAccessibility(pid: pid_t) {
        let appEl = AXUIElementCreateApplication(pid)
        AX.setBool(appEl, "AXManualAccessibility", true)
        AX.setBool(appEl, "AXEnhancedUserInterface", true)
    }
}
