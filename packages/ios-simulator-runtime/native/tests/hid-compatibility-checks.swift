import Foundation

// Executed by Vitest against the same Swift source linked into the helper.
private final class LegacyScreen: NSObject {}
private final class Screen: NSObject {
    @objc var screen: NSObject?
}
private final class ConnectedScreen: NSObject {
    @objc var screenProperties: NSObject?
}
private final class Properties: NSObject {
    @objc var screenID: UInt32 = 1
    @objc var screenType: UInt = 0
}

@main
struct HIDCompatibilityChecks {
    static func main() throws {
        var passed: [String] = []
        func check(_ name: String, _ body: () throws -> Bool) throws {
            guard try body() else { throw NSError(domain: name, code: 1) }
            passed.append(name)
        }
        func rejectsTarget(_ screen: NSObject?, _ id: UInt32? = 1) -> Bool {
            do {
                _ = try nativeHIDTarget(screenClass: Screen.self, screen: screen, expectedScreenID: id)
                return false
            } catch NativeHIDError.targetUnavailable { return true }
            catch { return false }
        }
        let screen = Screen()
        let connected = ConnectedScreen()
        let properties = Properties()
        screen.screen = connected
        connected.screenProperties = properties
        try check("legacy target") {
            try nativeHIDTarget(screenClass: LegacyScreen.self, screen: nil, expectedScreenID: nil) == 0x32
        }
        try check("screen 1 target") {
            try nativeHIDTarget(screenClass: Screen.self, screen: screen, expectedScreenID: 1) == 0x40000001
        }
        properties.screenID = 7
        try check("non-default screen target") {
            try nativeHIDTarget(screenClass: Screen.self, screen: screen, expectedScreenID: 7) == 0x40000007
        }
        try check("screen identity mismatch") { rejectsTarget(screen) }
        properties.screenID = 0x40000000
        try check("screen ID flag collision") { rejectsTarget(screen, 0x40000000) }
        properties.screenID = 1
        for screenType: UInt in [1, 2] {
            properties.screenType = screenType
            try check("indirect screen \(screenType)") {
                try nativeHIDTarget(screenClass: Screen.self, screen: screen, expectedScreenID: 1) == 1
            }
        }
        try check("missing screen") { rejectsTarget(nil) }
        try check("missing binding") { rejectsTarget(screen, nil) }
        screen.screen = nil
        try check("disconnected screen") { rejectsTarget(screen) }
        screen.screen = connected
        connected.screenProperties = NSObject()
        try check("incomplete screen properties") { rejectsTarget(screen) }
        let success = PendingHIDDelivery()
        DispatchQueue.global().async { success.complete(error: nil) }
        try success.wait()
        passed.append("asynchronous completion")
        let failure = PendingHIDDelivery()
        failure.complete(error: NSError(domain: "private-framework-detail", code: 99))
        do {
            try failure.wait()
            throw NSError(domain: "expected delivery failure", code: 1)
        } catch NativeHIDError.deliveryFailed {
            passed.append("delivery error propagation")
        }
        let timeout = PendingHIDDelivery()
        do {
            try timeout.wait(timeout: 0.001)
            throw NSError(domain: "expected delivery timeout", code: 1)
        } catch NativeHIDError.deliveryTimedOut {
            passed.append("bounded completion timeout")
        }
        // Framework callbacks may arrive after the caller has timed out.
        timeout.complete(error: nil)
        timeout.complete(error: NSError(domain: "duplicate", code: 1))
        try timeout.wait()
        passed.append("late and duplicate completion")
        let json = try JSONSerialization.data(withJSONObject: passed)
        print(String(decoding: json, as: UTF8.self))
    }
}
