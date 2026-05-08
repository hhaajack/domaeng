// FILE: BridgeControlModels.swift
// Purpose: Defines the machine-readable bridge snapshot plus menu-bar-specific CLI/compatibility models.
// Layer: Companion app model
// Exports: bridge snapshot, runtime status, pairing payload, CLI availability, and compatibility helpers
// Depends on: Foundation

import Foundation

struct BridgeSnapshot: Codable, Equatable {
    let currentVersion: String
    let label: String
    let platform: String
    let installed: Bool
    let launchdLoaded: Bool
    let launchdPid: Int?
    let daemonConfig: BridgeDaemonConfig?
    let bridgeStatus: BridgeRuntimeStatus?
    let pairingSession: BridgePairingSession?
    let trustedDevices: [BridgeTrustedDevice]?
    let stdoutLogPath: String
    let stderrLogPath: String
    let tailscaleDNSName: String?
}

struct BridgeDaemonConfig: Codable, Equatable {
    let relayUrl: String?
    let pushServiceUrl: String?
    let codexEndpoint: String?
    let refreshEnabled: Bool?
}

struct BridgeRuntimeStatus: Codable, Equatable {
    let state: String?
    let connectionStatus: String?
    let pid: Int?
    let lastError: String?
    let updatedAt: String?
}

struct BridgePairingSession: Codable, Equatable {
    let createdAt: String?
    let pairingCode: String?
    let pairingPayload: BridgePairingPayload?
}

struct BridgePairingPayload: Codable, Equatable {
    let v: Int
    let relay: String
    let sessionId: String
    let macDeviceId: String
    let macIdentityPublicKey: String
    let expiresAt: Int64
}

struct BridgeTrustedDevice: Codable, Equatable, Identifiable {
    let id: String
    let displayName: String
    let kind: String?
    let fingerprint: String
    let trustedAt: String?
    let lastSeenAt: String?
    let disabledAt: String?
    let status: String?
}

enum BridgeClientCompatibility {
    static let supportedBridgeVersionInfoKey = "DomaengSupportedBridgeVersion"
    static let fallbackSupportedBridgeVersion = "1.5.1"

    static var supportedBridgeVersion: String {
        if let configuredVersion = (Bundle.main.object(
            forInfoDictionaryKey: supportedBridgeVersionInfoKey
        ) as? String)?.nonEmptyTrimmed {
            return configuredVersion
        }

        return fallbackSupportedBridgeVersion
    }
}

enum BridgeCLIAvailability: Equatable {
    case checking
    case available(version: String)
    case missing
    case broken(message: String)

    static var installCommand: String {
        "npm install -g domaeng@\(BridgeClientCompatibility.supportedBridgeVersion)"
    }

    var isAvailable: Bool {
        if case .available = self {
            return true
        }

        return false
    }

    var statusLabel: String {
        switch self {
        case .checking:
            return "Checking"
        case .available:
            return "CLI Ready"
        case .missing:
            return "CLI Missing"
        case .broken:
            return "CLI Error"
        }
    }

    var versionLabel: String? {
        guard case .available(let version) = self else {
            return nil
        }

        return version
    }

    var setupTitle: String {
        switch self {
        case .checking:
            return "Checking Global CLI"
        case .available:
            return "CLI Ready"
        case .missing:
            return "Global CLI Required"
        case .broken:
            return "CLI Needs Attention"
        }
    }

    var setupMessage: String {
        switch self {
        case .checking:
            return "Looking for a globally installed `domaeng` command before enabling the companion controls."
        case .available(let version):
            return "Detected the global Domaeng CLI (`\(version)`)."
        case .missing:
            return "This companion only works when the global `domaeng` CLI is installed and visible to the app shell environment."
        case .broken(let message):
            return "Found Domaeng, but the CLI could not be used. \(message)"
        }
    }
}

extension BridgeSnapshot {
    // Picks the most relevant relay for display, preferring persisted daemon config over the transient QR payload.
    var effectiveRelayURL: String {
        daemonConfig?.relayUrl?.nonEmptyTrimmed
        ?? pairingSession?.pairingPayload?.relay.nonEmptyTrimmed
        ?? ""
    }

    var statusHeadline: String {
        if let connectionStatus = bridgeStatus?.connectionStatus?.nonEmptyTrimmed {
            return connectionStatus.capitalized
        }

        if launchdLoaded {
            return "Running"
        }

        return "Stopped"
    }

    var statusFootnote: String {
        if let updatedAt = bridgeStatus?.updatedDate {
            return Self.relativeFormatter.localizedString(for: updatedAt, relativeTo: Date())
        }

        return launchdLoaded ? "Service loaded" : "Service not loaded"
    }

    var lastErrorMessage: String {
        bridgeStatus?.lastError?.nonEmptyTrimmed ?? ""
    }

    var trustedDeviceList: [BridgeTrustedDevice] {
        trustedDevices ?? []
    }

    var stateDirectoryPath: String {
        let stderrURL = URL(fileURLWithPath: stderrLogPath)
        return stderrURL.deletingLastPathComponent().deletingLastPathComponent().path
    }

    var relayKindLabel: String {
        classifyRelay(effectiveRelayURL)
    }

    var tailscaleRelayURL: String {
        if classifyRelay(effectiveRelayURL) != "Local" {
            return effectiveRelayURL
        }

        guard let host = tailscaleDNSName?.nonEmptyTrimmed else {
            return ""
        }

        return "wss://\(host)/relay"
    }

    var tailscaleWebAppURL: String {
        webAppURL(fromRelayURL: tailscaleRelayURL) ?? ""
    }

    var localLANRelayURL: String {
        "ws://\(Self.localLANHostName):9000/relay"
    }

    var localLANWebAppURL: String {
        "http://\(Self.localLANHostName):9000/app/"
    }

    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter
    }()

    private static var localLANHostName: String {
        let hostName = ProcessInfo.processInfo.hostName
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !hostName.isEmpty else {
            return "localhost"
        }

        let normalized = hostName
            .replacingOccurrences(of: " ", with: "-")
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
        guard !normalized.isEmpty else {
            return "localhost"
        }

        return normalized.contains(".") ? normalized : "\(normalized).local"
    }
}

extension BridgeRuntimeStatus {
    var updatedDate: Date? {
        updatedAt.flatMap(bridgeISO8601Formatter.date)
    }
}

extension BridgePairingSession {
    var createdDate: Date? {
        createdAt.flatMap(bridgeISO8601Formatter.date)
    }
}

extension BridgePairingPayload {
    var expiryDate: Date {
        Date(timeIntervalSince1970: TimeInterval(expiresAt) / 1000)
    }

    var isExpired: Bool {
        isExpired(at: Date())
    }

    func isExpired(at date: Date) -> Bool {
        expiryDate <= date
    }

    func stateLabel(at date: Date) -> String {
        isExpired(at: date) ? "Expired" : "Ready"
    }
}

private extension String {
    var nonEmptyTrimmed: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

private func classifyRelay(_ relayURL: String) -> String {
    guard let components = URLComponents(string: relayURL),
          let host = components.host?.lowercased(),
          !host.isEmpty else {
        return "Unconfigured"
    }

    if host == "localhost"
        || host == "127.0.0.1"
        || host == "::1"
        || host.hasSuffix(".local")
        || host.hasPrefix("10.")
        || host.hasPrefix("192.168.")
        || isPrivate172Address(host) {
        return "Local"
    }

    return "Remote"
}

private func webAppURL(fromRelayURL relayURL: String) -> String? {
    guard !relayURL.isEmpty,
          var components = URLComponents(string: relayURL) else {
        return nil
    }

    switch components.scheme?.lowercased() {
    case "wss":
        components.scheme = "https"
    case "ws":
        components.scheme = "http"
    case "https", "http":
        break
    default:
        return nil
    }

    var pathParts = components.path
        .split(separator: "/")
        .map(String.init)
    if pathParts.last == "relay" {
        pathParts.removeLast()
    }
    pathParts.append("app")
    components.path = "/" + pathParts.joined(separator: "/") + "/"
    components.query = nil
    components.fragment = nil
    return components.string
}

private let bridgeISO8601Formatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

private func isPrivate172Address(_ host: String) -> Bool {
    let parts = host.split(separator: ".")
    guard parts.count == 4,
          parts[0] == "172",
          let secondOctet = Int(parts[1]) else {
        return false
    }

    return (16...31).contains(secondOctet)
}
