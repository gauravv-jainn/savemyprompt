import AppKit
import ApplicationServices

// Thin, safe wrappers around the C Accessibility API.
enum AX {

    /// Copy a single attribute value, returning nil on any error.
    static func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        let err = AXUIElementCopyAttributeValue(el, name as CFString, &value)
        return err == .success ? value : nil
    }

    /// All attribute names exposed by an element (used for discovery dumps).
    static func attributeNames(_ el: AXUIElement) -> [String] {
        var names: CFArray?
        guard AXUIElementCopyAttributeNames(el, &names) == .success,
              let arr = names as? [String] else { return [] }
        return arr
    }

    static func string(_ el: AXUIElement, _ name: String) -> String? {
        guard let v = attr(el, name) else { return nil }
        if CFGetTypeID(v) == CFStringGetTypeID() { return (v as! CFString) as String }
        // Some attributes come back as NSNumber/NSValue; coerce for display.
        return stringify(v)
    }

    static func element(_ el: AXUIElement, _ name: String) -> AXUIElement? {
        guard let v = attr(el, name) else { return nil }
        guard CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
        return (v as! AXUIElement)
    }

    static func children(_ el: AXUIElement) -> [AXUIElement] {
        guard let v = attr(el, kAXChildrenAttribute as String) else { return [] }
        guard CFGetTypeID(v) == CFArrayGetTypeID() else { return [] }
        let arr = v as! CFArray
        let count = CFArrayGetCount(arr)
        var out: [AXUIElement] = []
        out.reserveCapacity(count)
        for i in 0..<count {
            let raw = CFArrayGetValueAtIndex(arr, i)
            let child = unsafeBitCast(raw, to: AXUIElement.self)
            out.append(child)
        }
        return out
    }

    static func point(_ el: AXUIElement, _ name: String) -> CGPoint? {
        guard let v = attr(el, name), CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
        let axv = v as! AXValue
        guard AXValueGetType(axv) == .cgPoint else { return nil }
        var p = CGPoint.zero
        return AXValueGetValue(axv, .cgPoint, &p) ? p : nil
    }

    static func size(_ el: AXUIElement, _ name: String) -> CGSize? {
        guard let v = attr(el, name), CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
        let axv = v as! AXValue
        guard AXValueGetType(axv) == .cgSize else { return nil }
        var s = CGSize.zero
        return AXValueGetValue(axv, .cgSize, &s) ? s : nil
    }

    /// Frame (screen coords, top-left origin) of an element.
    static func frame(_ el: AXUIElement) -> CGRect? {
        guard let p = point(el, kAXPositionAttribute as String),
              let s = size(el, kAXSizeAttribute as String) else { return nil }
        return CGRect(origin: p, size: s)
    }

    /// Best-effort text value for an element (value or title or description).
    static func text(_ el: AXUIElement) -> String {
        for key in [kAXValueAttribute as String,
                    kAXTitleAttribute as String,
                    kAXDescriptionAttribute as String] {
            if let s = string(el, key), !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return s
            }
        }
        return ""
    }

    static func role(_ el: AXUIElement) -> String {
        string(el, kAXRoleAttribute as String) ?? "?"
    }

    static func setBool(_ el: AXUIElement, _ name: String, _ value: Bool) {
        AXUIElementSetAttributeValue(el, name as CFString,
                                     (value ? kCFBooleanTrue : kCFBooleanFalse))
    }

    /// Recursively collect visible text under an element (depth-bounded).
    static func collectText(_ el: AXUIElement, maxDepth: Int = 12) -> String {
        var parts: [String] = []
        func walk(_ e: AXUIElement, _ depth: Int) {
            if depth > maxDepth { return }
            let r = role(e)
            if r == (kAXStaticTextRole as String) {
                let t = text(e)
                if !t.isEmpty { parts.append(t) }
            } else {
                // A group's own value can also hold text.
                let t = string(e, kAXValueAttribute as String) ?? ""
                if !t.isEmpty { parts.append(t) }
            }
            for c in children(e) { walk(c, depth + 1) }
        }
        walk(el, 0)
        return parts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Human-readable rendering of an arbitrary CF attribute value (for dumps).
    static func stringify(_ value: CFTypeRef, depth: Int = 0) -> String {
        let tid = CFGetTypeID(value)
        if tid == CFStringGetTypeID() {
            return "\"\((value as! CFString) as String)\""
        }
        if tid == CFBooleanGetTypeID() {
            return CFBooleanGetValue((value as! CFBoolean)) ? "true" : "false"
        }
        if tid == CFNumberGetTypeID() {
            return "\((value as! NSNumber))"
        }
        if tid == AXUIElementGetTypeID() {
            let el = value as! AXUIElement
            return "<AXUIElement role=\(role(el))>"
        }
        if tid == AXValueGetTypeID() {
            let axv = value as! AXValue
            switch AXValueGetType(axv) {
            case .cgPoint:
                var p = CGPoint.zero; AXValueGetValue(axv, .cgPoint, &p)
                return "point(\(Int(p.x)),\(Int(p.y)))"
            case .cgSize:
                var s = CGSize.zero; AXValueGetValue(axv, .cgSize, &s)
                return "size(\(Int(s.width))x\(Int(s.height)))"
            case .cgRect:
                var r = CGRect.zero; AXValueGetValue(axv, .cgRect, &r)
                return "rect(\(Int(r.origin.x)),\(Int(r.origin.y)) \(Int(r.width))x\(Int(r.height)))"
            case .cfRange:
                var rg = CFRange(); AXValueGetValue(axv, .cfRange, &rg)
                return "range(\(rg.location),\(rg.length))"
            default:
                return "<AXValue>"
            }
        }
        if tid == CFArrayGetTypeID() {
            let arr = value as! CFArray
            let n = CFArrayGetCount(arr)
            if depth > 0 { return "[\(n) items]" }
            // Shallow render arrays of strings/elements.
            if let strs = value as? [String] { return "[\(strs.prefix(8).joined(separator: ", "))\(n > 8 ? ", …" : "")]" }
            return "[\(n) items]"
        }
        return "\(value)"
    }
}
