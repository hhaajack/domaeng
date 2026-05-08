// FILE: BridgeControlService.swift
// Purpose: Wraps the existing Domaeng shell commands so the menu bar app can detect the global CLI and control the bridge.
// Layer: Companion app service
// Exports: BridgeControlService, ShellCommandRunner
// Depends on: CryptoKit, Darwin, Foundation, BridgeControlModels

import CryptoKit
import Darwin
import Foundation

struct BridgeCLIInvocation {
    let nodePath: String
    let cliPath: String

    // Executes the actual CLI entrypoint via an absolute Node binary so GUI PATH drift does not break nvm installs.
    func command(_ arguments: [String]) -> String {
        ([shellQuoted(nodePath), shellQuoted(cliPath)] + arguments).joined(separator: " ")
    }
}

struct ShellCommandResult {
    let stdout: String
    let stderr: String
    let exitCode: Int32
}

enum BridgeControlError: LocalizedError {
    case commandFailed(command: String, message: String)
    case invalidSnapshot(String)

    var errorDescription: String? {
        switch self {
        case .commandFailed(_, let message):
            return message
        case .invalidSnapshot(let message):
            return message
        }
    }
}

final class ShellCommandRunner {
    // Runs a login shell so Homebrew, nvm, asdf, and other user PATH customizations resolve naturally.
    func run(command: String, environment: [String: String] = [:]) async throws -> ShellCommandResult {
        try await Task.detached(priority: .userInitiated) {
            let process = Process()
            let stdoutPipe = Pipe()
            let stderrPipe = Pipe()
            let stdoutReader = Task.detached(priority: .userInitiated) {
                stdoutPipe.fileHandleForReading.readDataToEndOfFile()
            }
            let stderrReader = Task.detached(priority: .userInitiated) {
                stderrPipe.fileHandleForReading.readDataToEndOfFile()
            }

            process.executableURL = URL(fileURLWithPath: "/bin/zsh")
            process.arguments = ["-lc", self.wrappedShellCommand(command)]
            process.currentDirectoryURL = URL(fileURLWithPath: NSHomeDirectory())
            process.environment = ProcessInfo.processInfo.environment.merging(environment) { _, override in
                override
            }
            process.standardOutput = stdoutPipe
            process.standardError = stderrPipe

            try process.run()
            process.waitUntilExit()

            let stdout = String(data: await stdoutReader.value, encoding: .utf8) ?? ""
            let stderr = String(data: await stderrReader.value, encoding: .utf8) ?? ""
            let result = ShellCommandResult(
                stdout: stdout.trimmingCharacters(in: .whitespacesAndNewlines),
                stderr: stderr.trimmingCharacters(in: .whitespacesAndNewlines),
                exitCode: process.terminationStatus
            )

            guard result.exitCode == 0 else {
                let message = result.stderr.isEmpty ? result.stdout : result.stderr
                throw BridgeControlError.commandFailed(
                    command: command,
                    message: message.isEmpty ? "Command failed: \(command)" : message
                )
            }

            return result
        }.value
    }

    // Runs a known executable directly for local control-plane reads that do not need shell PATH setup.
    func runExecutable(
        _ executablePath: String,
        arguments: [String],
        environment: [String: String] = [:]
    ) async throws -> ShellCommandResult {
        try await Task.detached(priority: .userInitiated) {
            let process = Process()
            let stdoutPipe = Pipe()
            let stderrPipe = Pipe()
            let stdoutReader = Task.detached(priority: .userInitiated) {
                stdoutPipe.fileHandleForReading.readDataToEndOfFile()
            }
            let stderrReader = Task.detached(priority: .userInitiated) {
                stderrPipe.fileHandleForReading.readDataToEndOfFile()
            }

            process.executableURL = URL(fileURLWithPath: executablePath)
            process.arguments = arguments
            process.currentDirectoryURL = URL(fileURLWithPath: NSHomeDirectory())
            process.environment = ProcessInfo.processInfo.environment.merging(environment) { _, override in
                override
            }
            process.standardOutput = stdoutPipe
            process.standardError = stderrPipe

            try process.run()
            process.waitUntilExit()

            let stdout = String(data: await stdoutReader.value, encoding: .utf8) ?? ""
            let stderr = String(data: await stderrReader.value, encoding: .utf8) ?? ""
            let result = ShellCommandResult(
                stdout: stdout.trimmingCharacters(in: .whitespacesAndNewlines),
                stderr: stderr.trimmingCharacters(in: .whitespacesAndNewlines),
                exitCode: process.terminationStatus
            )

            guard result.exitCode == 0 else {
                let message = result.stderr.isEmpty ? result.stdout : result.stderr
                throw BridgeControlError.commandFailed(
                    command: ([executablePath] + arguments).joined(separator: " "),
                    message: message.isEmpty ? "Command failed: \(executablePath)" : message
                )
            }

            return result
        }.value
    }

    // Silently loads interactive zsh PATH customizations so GUI-launched commands see the same global CLI install as Terminal.
    private nonisolated func wrappedShellCommand(_ command: String) -> String {
        [
            "export TERM=dumb",
            "source ~/.zshrc >/dev/null 2>/dev/null || true",
            command,
        ].joined(separator: "; ")
    }
}

final class BridgeControlService {
    private let runner: ShellCommandRunner
    private let decoder = JSONDecoder()
    private let fileManager = FileManager.default
    private let defaultStateDirectory = URL(fileURLWithPath: NSHomeDirectory())
        .appendingPathComponent(".remodex", isDirectory: true)
    private let launchAgentPlistURL = URL(fileURLWithPath: NSHomeDirectory())
        .appendingPathComponent("Library", isDirectory: true)
        .appendingPathComponent("LaunchAgents", isDirectory: true)
        .appendingPathComponent("com.remodex.bridge.plist")
    private let cliCacheTTL: TimeInterval = 60
    private var cachedInvocation: BridgeCLIInvocation?
    private var cachedAvailability: (availability: BridgeCLIAvailability, checkedAt: Date)?
    private var cachedTailscaleDNSName: (value: String, checkedAt: Date)?

    init(runner: ShellCommandRunner = ShellCommandRunner()) {
        self.runner = runner
    }

    // Confirms the product contract for this companion: the global Domaeng CLI must be runnable first.
    func detectCLIAvailability(forceRefresh: Bool = false) async -> BridgeCLIAvailability {
        if !forceRefresh,
           let cachedAvailability,
           Date().timeIntervalSince(cachedAvailability.checkedAt) < cliCacheTTL {
            return cachedAvailability.availability
        }

        do {
            let invocation = try await resolveCLIInvocation(forceRefresh: forceRefresh)
            let result = try await runner.run(command: invocation.command(["--version"]))
            guard let version = parseVersion(result.stdout) else {
                let availability: BridgeCLIAvailability = .broken(message: "The installed CLI returned an unreadable version.")
                cachedAvailability = (availability, Date())
                return availability
            }

            let availability: BridgeCLIAvailability = .available(version: version)
            cachedAvailability = (availability, Date())
            return availability
        } catch {
            cachedInvocation = nil
            let availability = classifyCLIAvailability(from: error)
            cachedAvailability = (availability, Date())
            return availability
        }
    }

    // Loads the daemon snapshot from local state first, avoiding a full shell + Node CLI round-trip on every refresh.
    func loadSnapshot(relayOverride: String?) async throws -> BridgeSnapshot {
        let currentVersion = cachedVersionLabel ?? BridgeClientCompatibility.fallbackSupportedBridgeVersion
        if let snapshot = await loadLocalSnapshot(currentVersion: currentVersion) {
            return snapshot
        }

        let invocation = try await resolveCLIInvocation()
        let result = try await runner.run(
            command: invocation.command(["status", "--json"]),
            environment: commandEnvironment(relayOverride: relayOverride)
        )
        guard let data = result.stdout.data(using: .utf8) else {
            throw BridgeControlError.invalidSnapshot("Bridge status returned invalid UTF-8.")
        }

        do {
            return try decoder.decode(BridgeSnapshot.self, from: data)
        } catch {
            return try await loadFallbackSnapshot(from: result.stdout, invocation: invocation)
        }
    }

    func startBridge(relayOverride: String?) async throws {
        let invocation = try await resolveCLIInvocation()
        _ = try await runner.run(
            command: invocation.command(["start"]),
            environment: commandEnvironment(relayOverride: relayOverride)
        )
    }

    func stopBridge(relayOverride: String?) async throws {
        let invocation = try await resolveCLIInvocation()
        _ = try await runner.run(
            command: invocation.command(["stop"]),
            environment: commandEnvironment(relayOverride: relayOverride)
        )
    }

    func resumeLastThread(relayOverride: String?) async throws {
        let invocation = try await resolveCLIInvocation()
        _ = try await runner.run(
            command: invocation.command(["resume"]),
            environment: commandEnvironment(relayOverride: relayOverride)
        )
    }

    func resetPairing(relayOverride: String?) async throws {
        let invocation = try await resolveCLIInvocation()
        _ = try await runner.run(
            command: invocation.command(["reset-pairing"]),
            environment: commandEnvironment(relayOverride: relayOverride)
        )
    }

    func renewPairing(relayOverride: String?) async throws {
        let invocation = try await resolveCLIInvocation()
        _ = try await runner.run(
            command: invocation.command(["renew-pairing", "--json"]),
            environment: commandEnvironment(relayOverride: relayOverride)
        )
    }

    func setTrustedDevice(_ deviceId: String, enabled: Bool, relayOverride: String?) async throws {
        let invocation = try await resolveCLIInvocation()
        _ = try await runner.run(
            command: invocation.command(["trusted-device", enabled ? "enable" : "disable", deviceId, "--json"]),
            environment: commandEnvironment(relayOverride: relayOverride)
        )
    }

    func revokeTrustedDevice(_ deviceId: String, relayOverride: String?) async throws {
        let invocation = try await resolveCLIInvocation()
        _ = try await runner.run(
            command: invocation.command(["trusted-device", "revoke", deviceId, "--json"]),
            environment: commandEnvironment(relayOverride: relayOverride)
        )
    }

    private func parseVersion(_ output: String) -> String? {
        guard !output.isEmpty else {
            return nil
        }

        if let data = output.data(using: .utf8),
           let stringValue = try? decoder.decode(String.self, from: data),
           !stringValue.isEmpty {
            return stringValue
        }

        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    // Falls back to the daemon-state files when the global CLI still prints human-readable status output.
    private func loadFallbackSnapshot(
        from statusOutput: String,
        invocation: BridgeCLIInvocation
    ) async throws -> BridgeSnapshot {
        let statusLines = parseStatusLines(statusOutput)
        guard !statusLines.isEmpty else {
            throw BridgeControlError.invalidSnapshot("Bridge status returned malformed JSON.")
        }

        let versionResult = try await runner.run(command: invocation.command(["--version"]))
        guard let currentVersion = parseVersion(versionResult.stdout) else {
            throw BridgeControlError.invalidSnapshot("Bridge status returned an unreadable CLI version.")
        }

        let stateDirectory = resolveStateDirectory(statusLines: statusLines)
        let daemonConfig: BridgeDaemonConfig? = readStateFile(named: "daemon-config.json", in: stateDirectory)
        let bridgeStatus: BridgeRuntimeStatus? = readStateFile(named: "bridge-status.json", in: stateDirectory)
        let pairingSession: BridgePairingSession? = readStateFile(named: "pairing-session.json", in: stateDirectory)
        let stdoutLogPath = statusLines["stdout log"] ?? stateDirectory.appendingPathComponent("logs/bridge.stdout.log").path
        let stderrLogPath = statusLines["stderr log"] ?? stateDirectory.appendingPathComponent("logs/bridge.stderr.log").path
        let launchdPid = parsePid(statusLines["pid"])
        let launchdLoaded = parseYesNo(statusLines["launchd loaded"]) ?? false
        let installed = parseYesNo(statusLines["installed"]) ?? fileManager.fileExists(atPath: launchAgentPlistURL.path)

        return BridgeSnapshot(
            currentVersion: currentVersion,
            label: statusLines["service label"] ?? "com.remodex.bridge",
            platform: "darwin",
            installed: installed,
            launchdLoaded: launchdLoaded,
            launchdPid: launchdPid,
            daemonConfig: daemonConfig,
            bridgeStatus: bridgeStatus,
            pairingSession: pairingSession,
            trustedDevices: [],
            stdoutLogPath: stdoutLogPath,
            stderrLogPath: stderrLogPath,
            tailscaleDNSName: await tailscaleDNSName()
        )
    }

    private func loadLocalSnapshot(currentVersion: String) async -> BridgeSnapshot? {
        let stateDirectory = resolveStateDirectory(statusLines: [:])
        let launchdState = await readLaunchAgentState()
        let daemonConfig: BridgeDaemonConfig? = readStateFile(named: "daemon-config.json", in: stateDirectory)
        let bridgeStatus: BridgeRuntimeStatus? = readStateFile(named: "bridge-status.json", in: stateDirectory)
        let pairingSession: BridgePairingSession? = readStateFile(named: "pairing-session.json", in: stateDirectory)
        let trustedDevices = readTrustedDevices(in: stateDirectory)

        return BridgeSnapshot(
            currentVersion: currentVersion,
            label: "com.remodex.bridge",
            platform: "darwin",
            installed: fileManager.fileExists(atPath: launchAgentPlistURL.path),
            launchdLoaded: launchdState.loaded,
            launchdPid: launchdState.pid,
            daemonConfig: daemonConfig,
            bridgeStatus: bridgeStatus,
            pairingSession: pairingSession,
            trustedDevices: trustedDevices,
            stdoutLogPath: stateDirectory.appendingPathComponent("logs/bridge.stdout.log").path,
            stderrLogPath: stateDirectory.appendingPathComponent("logs/bridge.stderr.log").path,
            tailscaleDNSName: await tailscaleDNSName()
        )
    }

    private func tailscaleDNSName() async -> String? {
        if let cachedTailscaleDNSName,
           Date().timeIntervalSince(cachedTailscaleDNSName.checkedAt) < cliCacheTTL {
            return nonEmptyTrimmed(cachedTailscaleDNSName.value)
        }

        let detectedDNSName: String?
        if let cliDNSName = await tailscaleDNSNameFromCLI() {
            detectedDNSName = cliDNSName
        } else if let defaultsDNSName = await tailscaleDNSNameFromDefaults() {
            detectedDNSName = defaultsDNSName
        } else {
            detectedDNSName = tailscaleDNSNameFromCachedProfile()
        }

        if let dnsName = detectedDNSName {
            let normalized = normalizeTailscaleDNSName(dnsName)
            cachedTailscaleDNSName = (normalized, Date())
            return nonEmptyTrimmed(normalized)
        }

        cachedTailscaleDNSName = ("", Date())
        return nil
    }

    private func tailscaleDNSNameFromCLI() async -> String? {
        do {
            let result = try await runner.run(command: "tailscale status --json")
            guard let data = result.stdout.data(using: .utf8),
                  let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let selfObject = object["Self"] as? [String: Any],
                  let dnsName = selfObject["DNSName"] as? String else {
                return nil
            }

            return nonEmptyTrimmed(dnsName)
        } catch {
            return nil
        }
    }

    private func tailscaleDNSNameFromDefaults() async -> String? {
        do {
            let result = try await runner.runExecutable(
                "/usr/bin/defaults",
                arguments: ["export", "io.tailscale.ipn.macos", "-"]
            )
            guard let plistData = result.stdout.data(using: .utf8),
                  let magicDNSName = tailscaleMagicDNSName(fromPlistData: plistData) else {
                return nil
            }

            return "\(tailscaleNodeName()).\(magicDNSName)"
        } catch {
            return nil
        }
    }

    private func tailscaleDNSNameFromCachedProfile() -> String? {
        let preferencesURL = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Preferences", isDirectory: true)
            .appendingPathComponent("io.tailscale.ipn.macos.plist")

        guard let plistData = try? Data(contentsOf: preferencesURL),
              let magicDNSName = tailscaleMagicDNSName(fromPlistData: plistData) else {
            return nil
        }

        let nodeName = tailscaleNodeName()
        return "\(nodeName).\(magicDNSName)"
    }

    private func tailscaleMagicDNSName(fromPlistData plistData: Data) -> String? {
        let profileKey = "com.tailscale.cached.currentProfile"
        var format = PropertyListSerialization.PropertyListFormat.xml
        guard let plist = try? PropertyListSerialization.propertyList(from: plistData, format: &format) as? [String: Any],
              let profileData = plist[profileKey] as? Data else {
            return nil
        }

        return tailscaleMagicDNSName(fromProfileData: profileData)
    }

    private func tailscaleMagicDNSName(fromProfileData profileData: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: profileData) as? [String: Any],
              let networkProfile = object["NetworkProfile"] as? [String: Any],
              let magicDNSName = networkProfile["MagicDNSName"] as? String else {
            return nil
        }

        return nonEmptyTrimmed(normalizeTailscaleDNSName(magicDNSName))
    }

    private func tailscaleNodeName() -> String {
        let hostName = ProcessInfo.processInfo.hostName
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
            .replacingOccurrences(of: " ", with: "-")
            .lowercased()
        let withoutLocalSuffix = hostName.hasSuffix(".local")
            ? String(hostName.dropLast(".local".count))
            : hostName

        guard !withoutLocalSuffix.isEmpty else {
            return "localhost"
        }

        return withoutLocalSuffix
    }

    private func normalizeTailscaleDNSName(_ dnsName: String) -> String {
        dnsName
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
    }

    private func nonEmptyTrimmed(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func readLaunchAgentState() async -> (loaded: Bool, pid: Int?) {
        let labelDomain = "gui/\(getuid())/com.remodex.bridge"
        do {
            let result = try await runner.runExecutable(
                "/bin/launchctl",
                arguments: ["print", labelDomain]
            )
            return (true, parseLaunchdPid(result.stdout))
        } catch {
            return (false, nil)
        }
    }

    private func parseLaunchdPid(_ output: String) -> Int? {
        guard let regex = try? NSRegularExpression(pattern: "\\bpid = (\\d+)") else {
            return nil
        }

        let range = NSRange(output.startIndex..<output.endIndex, in: output)
        guard let match = regex.firstMatch(in: output, range: range),
              match.numberOfRanges > 1,
              let pidRange = Range(match.range(at: 1), in: output) else {
            return nil
        }

        return Int(output[pidRange])
    }

    private func readTrustedDevices(in stateDirectory: URL) -> [BridgeTrustedDevice] {
        let deviceStateURL = stateDirectory.appendingPathComponent("device-state.json")
        guard let data = try? Data(contentsOf: deviceStateURL),
              let state = try? decoder.decode(BridgeDeviceStateFile.self, from: data) else {
            return []
        }

        return (state.trustedPhones ?? [:])
            .map { deviceId, publicKey in
                trustedDeviceSnapshot(
                    deviceId: deviceId,
                    publicKey: publicKey,
                    metadata: state.trustedPhoneMetadata?[deviceId]
                )
            }
            .sorted(by: compareTrustedDevices)
    }

    private func trustedDeviceSnapshot(
        deviceId: String,
        publicKey: String,
        metadata: BridgeTrustedPhoneMetadata?
    ) -> BridgeTrustedDevice {
        let fingerprint = trustedDeviceFingerprint(publicKey)
        let kind = normalizeDeviceKind(metadata?.deviceKind) ?? inferTrustedDeviceKind(deviceId)
        let displayName = normalizeDisplayName(metadata?.displayName)
            ?? defaultTrustedDeviceDisplayName(kind: kind, fingerprint: fingerprint)
        let disabledAt = normalizeDateString(metadata?.disabledAt)

        return BridgeTrustedDevice(
            id: trustedDeviceRecordId(deviceId: deviceId, publicKey: publicKey),
            displayName: displayName,
            kind: kind,
            fingerprint: fingerprint,
            trustedAt: normalizeDateString(metadata?.trustedAt),
            lastSeenAt: normalizeDateString(metadata?.lastSeenAt),
            disabledAt: disabledAt,
            status: disabledAt == nil ? "enabled" : "disabled"
        )
    }

    private func compareTrustedDevices(_ lhs: BridgeTrustedDevice, _ rhs: BridgeTrustedDevice) -> Bool {
        let lhsTime = Date.parseBridgeControlDate(lhs.lastSeenAt ?? lhs.trustedAt ?? "")?.timeIntervalSince1970 ?? 0
        let rhsTime = Date.parseBridgeControlDate(rhs.lastSeenAt ?? rhs.trustedAt ?? "")?.timeIntervalSince1970 ?? 0
        if lhsTime != rhsTime {
            return lhsTime > rhsTime
        }
        return lhs.displayName.localizedCompare(rhs.displayName) == .orderedAscending
    }

    private func trustedDeviceRecordId(deviceId: String, publicKey: String) -> String {
        let input = "\(deviceId)\u{0}\(publicKey)"
        return "dev_" + String(sha256Hex(Data(input.utf8)).prefix(12))
    }

    private func trustedDeviceFingerprint(_ publicKey: String) -> String {
        let normalizedPublicKey = publicKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let inputData = Data(base64Encoded: normalizedPublicKey) ?? Data(normalizedPublicKey.utf8)
        let digest = sha256Hex(inputData).prefix(8).uppercased()
        guard digest.count == 8 else {
            return digest
        }
        let splitIndex = digest.index(digest.startIndex, offsetBy: 4)
        return "\(digest[..<splitIndex]) \(digest[splitIndex...])"
    }

    // Resolves both the CLI script and the Node runtime from stable absolute paths before the menu bar invokes them.
    private var cachedVersionLabel: String? {
        guard case .available(let version) = cachedAvailability?.availability else {
            return nil
        }
        return version
    }

    private func resolveCLIInvocation(forceRefresh: Bool = false) async throws -> BridgeCLIInvocation {
        if !forceRefresh, let cachedInvocation {
            return cachedInvocation
        }

        let cliPath = try await resolveFirstExecutable(named: ["domaeng", "remodex"])
        let nodePath = try await resolveNodePath(for: cliPath)
        let invocation = BridgeCLIInvocation(nodePath: nodePath, cliPath: cliPath)
        cachedInvocation = invocation
        return invocation
    }

    private func parseStatusLines(_ output: String) -> [String: String] {
        output
            .split(separator: "\n", omittingEmptySubsequences: true)
            .reduce(into: [String: String]()) { partialResult, line in
                let cleaned = line.trimmingCharacters(in: .whitespacesAndNewlines)
                guard let prefix = ["[domaeng] ", "[remodex] "].first(where: cleaned.hasPrefix) else {
                    return
                }

                let payload = cleaned.dropFirst(prefix.count)
                guard let separatorIndex = payload.firstIndex(of: ":") else {
                    return
                }

                let key = payload[..<separatorIndex]
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .lowercased()
                let value = payload[payload.index(after: separatorIndex)...]
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                partialResult[key] = value
            }
    }

    private func parseYesNo(_ value: String?) -> Bool? {
        switch value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "yes":
            return true
        case "no":
            return false
        default:
            return nil
        }
    }

    private func parsePid(_ value: String?) -> Int? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              let pid = Int(value) else {
            return nil
        }

        return pid
    }

    // Reads daemon-state files from the same state root used by the bridge service.
    private func readStateFile<T: Decodable>(named filename: String, in stateDirectory: URL) -> T? {
        let targetURL = stateDirectory.appendingPathComponent(filename)
        guard let data = try? Data(contentsOf: targetURL) else {
            return nil
        }

        return try? decoder.decode(T.self, from: data)
    }

    // Prefers the Node runtime sitting next to the resolved CLI binary so mixed installs stay compatible.
    private func resolveNodePath(for cliPath: String) async throws -> String {
        if let colocatedNodePath = resolveColocatedNodePath(for: cliPath) {
            return colocatedNodePath
        }

        return try await resolveExecutable(named: "node")
    }

    private func resolveColocatedNodePath(for cliPath: String) -> String? {
        let cliURL = URL(fileURLWithPath: cliPath)
        let candidateDirectories = [
            cliURL.deletingLastPathComponent().path,
            cliURL.resolvingSymlinksInPath().deletingLastPathComponent().path,
        ]

        var seenDirectories = Set<String>()
        for directory in candidateDirectories where seenDirectories.insert(directory).inserted {
            let candidate = URL(fileURLWithPath: directory, isDirectory: true)
                .appendingPathComponent("node")
                .path
            if fileManager.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }

        return nil
    }

    private func resolveFirstExecutable(named names: [String]) async throws -> String {
        for name in names {
            if let path = try? await resolveExecutable(named: name) {
                return path
            }
        }

        throw BridgeControlError.commandFailed(
            command: names.joined(separator: " or "),
            message: "Neither the `domaeng` CLI nor the legacy `remodex` CLI was found in the app shell environment."
        )
    }

    private func resolveExecutable(named name: String) async throws -> String {
        if let discovered = try? await runner.run(command: "command -v \(name)"),
           let path = parseExecutablePath(discovered.stdout),
           fileManager.isExecutableFile(atPath: path) {
            return path
        }

        if let fallback = fallbackExecutableCandidates(named: name).first(where: { fileManager.isExecutableFile(atPath: $0) }) {
            return fallback
        }

        throw BridgeControlError.commandFailed(
            command: name,
            message: "\(name) was not found in the app shell environment."
        )
    }

    private func parseExecutablePath(_ output: String) -> String? {
        let path = output.trimmingCharacters(in: .whitespacesAndNewlines)
        return path.isEmpty ? nil : path
    }

    private func fallbackExecutableCandidates(named name: String) -> [String] {
        let homeDirectory = NSHomeDirectory()
        let stableCandidates = [
            "/opt/homebrew/bin/\(name)",
            "/usr/local/bin/\(name)",
            "\(homeDirectory)/.local/bin/\(name)",
            "\(homeDirectory)/.volta/bin/\(name)",
        ]

        return stableCandidates + nvmExecutableCandidates(named: name, homeDirectory: homeDirectory)
    }

    private func nvmExecutableCandidates(named name: String, homeDirectory: String) -> [String] {
        let versionsDirectory = URL(fileURLWithPath: homeDirectory)
            .appendingPathComponent(".nvm", isDirectory: true)
            .appendingPathComponent("versions", isDirectory: true)
            .appendingPathComponent("node", isDirectory: true)

        guard let contents = try? fileManager.contentsOfDirectory(
            at: versionsDirectory,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }

        return contents
            .sorted { compareVersionDirectoryNames($0.lastPathComponent, $1.lastPathComponent) == .orderedDescending }
            .map { $0.appendingPathComponent("bin", isDirectory: true).appendingPathComponent(name).path }
    }

    // Mirrors the bridge daemon-state lookup order so old CLI output still hydrates the companion correctly.
    private func resolveStateDirectory(statusLines: [String: String]) -> URL {
        if let explicitStateDirectory = normalizeNonEmptyString(ProcessInfo.processInfo.environment["DOMAENG_DEVICE_STATE_DIR"])
            ?? normalizeNonEmptyString(ProcessInfo.processInfo.environment["REMODEX_DEVICE_STATE_DIR"]) {
            return URL(fileURLWithPath: explicitStateDirectory, isDirectory: true)
        }

        if let installedStateDirectory = readLaunchAgentStateDirectory() {
            return installedStateDirectory
        }

        if let derivedStateDirectory = deriveStateDirectory(fromLogPath: statusLines["stdout log"] ?? statusLines["stderr log"]) {
            return derivedStateDirectory
        }

        return defaultStateDirectory
    }

    private func readLaunchAgentStateDirectory() -> URL? {
        guard let data = try? Data(contentsOf: launchAgentPlistURL),
              let plist = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any],
              let environment = plist["EnvironmentVariables"] as? [String: Any],
              let stateDirectory = normalizeNonEmptyString(environment["DOMAENG_DEVICE_STATE_DIR"] as? String)
                ?? normalizeNonEmptyString(environment["REMODEX_DEVICE_STATE_DIR"] as? String) else {
            return nil
        }

        return URL(fileURLWithPath: stateDirectory, isDirectory: true)
    }

    private func deriveStateDirectory(fromLogPath logPath: String?) -> URL? {
        guard let logPath = normalizeNonEmptyString(logPath) else {
            return nil
        }

        return URL(fileURLWithPath: logPath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    private func compareVersionDirectoryNames(_ lhs: String, _ rhs: String) -> ComparisonResult {
        let lhsVersion = parseVersionDirectoryName(lhs)
        let rhsVersion = parseVersionDirectoryName(rhs)

        switch (lhsVersion, rhsVersion) {
        case let (.some(lhsVersion), .some(rhsVersion)):
            return compareVersionComponents(lhsVersion, rhsVersion)
        case (.some, .none):
            return .orderedDescending
        case (.none, .some):
            return .orderedAscending
        case (.none, .none):
            return lhs.localizedStandardCompare(rhs)
        }
    }

    private func parseVersionDirectoryName(_ value: String) -> [Int]? {
        let normalized = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "v", with: "", options: [.anchored])
        let coreVersion = normalized.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: true).first
        guard let coreVersion else {
            return nil
        }

        let parts = coreVersion.split(separator: ".", omittingEmptySubsequences: false)
        guard !parts.isEmpty else {
            return nil
        }

        let numericParts = parts.compactMap { Int($0) }
        guard numericParts.count == parts.count else {
            return nil
        }

        return numericParts
    }

    private func compareVersionComponents(_ lhs: [Int], _ rhs: [Int]) -> ComparisonResult {
        for index in 0..<max(lhs.count, rhs.count) {
            let lhsValue = index < lhs.count ? lhs[index] : 0
            let rhsValue = index < rhs.count ? rhs[index] : 0

            if lhsValue == rhsValue {
                continue
            }

            return lhsValue < rhsValue ? .orderedAscending : .orderedDescending
        }

        return .orderedSame
    }

    private func normalizeNonEmptyString(_ value: String?) -> String? {
        guard let value else {
            return nil
        }

        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    // Maps shell failures into the explicit "missing global CLI" state shown by the menu bar.
    private func classifyCLIAvailability(from error: Error) -> BridgeCLIAvailability {
        let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalized = message.lowercased()

        if normalized.contains("command not found: domaeng")
            || normalized.contains("domaeng: command not found")
            || normalized.contains("domaeng: not found")
            || normalized.contains("command not found: remodex")
            || normalized.contains("remodex: command not found")
            || normalized.contains("remodex: not found")
            || normalized.contains("no such file or directory") {
            return .missing
        }

        return .broken(message: message.isEmpty ? "The CLI returned an unknown error." : message)
    }

    private func commandEnvironment(relayOverride: String?) -> [String: String] {
        guard let relayOverride,
              !relayOverride.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return [:]
        }

        return [
            "DOMAENG_RELAY": relayOverride.trimmingCharacters(in: .whitespacesAndNewlines),
            "REMODEX_RELAY": relayOverride.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
    }
}

private struct BridgeDeviceStateFile: Decodable {
    let trustedPhones: [String: String]?
    let trustedPhoneMetadata: [String: BridgeTrustedPhoneMetadata]?
}

private struct BridgeTrustedPhoneMetadata: Decodable {
    let displayName: String?
    let deviceKind: String?
    let trustedAt: String?
    let lastSeenAt: String?
    let disabledAt: String?
}

private func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data)
        .map { String(format: "%02x", $0) }
        .joined()
}

private func normalizeDisplayName(_ value: String?) -> String? {
    let trimmed = value?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .components(separatedBy: .whitespacesAndNewlines)
        .filter { !$0.isEmpty }
        .joined(separator: " ") ?? ""
    guard !trimmed.isEmpty else {
        return nil
    }
    return String(trimmed.prefix(80))
}

private func normalizeDeviceKind(_ value: String?) -> String? {
    let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
    if normalized == "ios" || normalized == "web" || normalized == "android" {
        return normalized
    }
    return normalized.isEmpty ? nil : "unknown"
}

private func inferTrustedDeviceKind(_ deviceId: String) -> String {
    deviceId.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().hasPrefix("web-") ? "web" : "ios"
}

private func defaultTrustedDeviceDisplayName(kind: String, fingerprint: String) -> String {
    switch kind {
    case "web":
        return "Web Device \(fingerprint)"
    case "ios":
        return "iPhone \(fingerprint)"
    case "android":
        return "Android Device \(fingerprint)"
    default:
        return "Device \(fingerprint)"
    }
}

private func normalizeDateString(_ value: String?) -> String? {
    guard let date = Date.parseBridgeControlDate(value ?? "") else {
        return nil
    }
    return bridgeControlISO8601Formatter.string(from: date)
}

private let bridgeControlISO8601Formatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

private let bridgeControlPlainISO8601Formatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
}()

private extension Date {
    static func parseBridgeControlDate(_ value: String) -> Date? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return nil
        }
        return bridgeControlISO8601Formatter.date(from: trimmed)
            ?? bridgeControlPlainISO8601Formatter.date(from: trimmed)
    }
}

private func shellQuoted(_ value: String) -> String {
    "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
}
