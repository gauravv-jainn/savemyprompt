import Foundation

// JSON contract shared with the Electron shell (Phase 2+).
// One HoverEvent is emitted per line (NDJSON) on stdout in --json mode.

struct Rect: Codable {
    var x: Double
    var y: Double
    var w: Double
    var h: Double
}

struct NodeInfo: Codable {
    var role: String
    var roleDescription: String?
    var subrole: String?
    var text: String
    var domClassList: [String]?
    var domIdentifier: String?
    var frame: Rect?
}

/// A single message extracted from the conversation, with its author when known.
struct MessageInfo: Codable {
    var author: String?          // "user" | "assistant" | nil
    var text: String
    var frame: Rect?
}

enum EventKind: String, Codable {
    case status          // helper lifecycle / permission / app-focus changes
    case hover           // a message is under the cursor -> show save button
    case clear           // nothing hoverable -> hide save button
    case captured        // full context captured on demand (--capture / IPC request)
}

struct AppInfo: Codable {
    var bundleId: String
    var name: String
    var pid: Int32
}

struct HoverEvent: Codable {
    var kind: EventKind
    var timestamp: Double
    var message: String?         // human-readable note for `status`
    var app: AppInfo?
    var mouse: [String: Double]? // {"x":, "y":} top-left origin, global
    // For `hover`: the message directly under the cursor + its anchor rect.
    var hovered: MessageInfo?
    var anchor: Rect?            // where to place the floating save button
    // For `captured`: hovered message + surrounding conversation for the model.
    var context: [MessageInfo]?
    var permissionGranted: Bool?
}
