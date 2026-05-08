// FILE: BridgeMenuBarStore.swift
// Purpose: Owns CLI gating, bridge polling, command execution, and local relay override persistence for the menu bar control center.
// Layer: Companion app state
// Exports: BridgeMenuBarStore
// Depends on: AppKit, Combine, Foundation, BridgeControlService, BridgeControlModels

import AppKit
import Combine
import Foundation

enum BridgeMenuBarActionError: LocalizedError {
    case missingCLI
    case brokenCLI(String)
    case pairingTimeout

    var errorDescription: String? {
        switch self {
        case .missingCLI:
            return "Install the global `remodex` CLI before using this companion."
        case .brokenCLI(let message):
            return message
        case .pairingTimeout:
            return "The bridge did not publish a fresh pairing session in time. Check the daemon logs and try again."
        }
    }
}

@MainActor
final class BridgeMenuBarStore: ObservableObject {
    @Published var snapshot: BridgeSnapshot?
    @Published var cliAvailability: BridgeCLIAvailability = .checking
    @Published var relayOverride: String
    @Published var tailscaleHostOverride: String
    @Published var isRefreshing = false
    @Published var isPerformingAction = false
    @Published var transientMessage = ""
    @Published var errorMessage = ""

    private static let relayOverrideKey = "remodex.menuBar.relayOverride"
    private static let tailscaleHostOverrideKey = "remodex.menuBar.tailscaleHostOverride"
    private let service: BridgeControlService
    private var refreshLoopTask: Task<Void, Never>?

    let supportedBridgeVersion = BridgeClientCompatibility.supportedBridgeVersion

    init(service: BridgeControlService? = nil) {
        self.service = service ?? BridgeControlService()
        self.relayOverride = UserDefaults.standard.string(forKey: Self.relayOverrideKey) ?? ""
        self.tailscaleHostOverride = UserDefaults.standard.string(forKey: Self.tailscaleHostOverrideKey) ?? ""
        startRefreshLoop()

        Task {
            await self.bootstrap()
        }
    }

    deinit {
        refreshLoopTask?.cancel()
    }

    // Refreshes the bridge snapshot so the menu bar stays aligned with the local control plane.
    func refresh(showSpinner: Bool = false, forceCLIRefresh: Bool = false) async {
        do {
            _ = try await performRefresh(
                showSpinner: showSpinner,
                clearSnapshotOnFailure: false,
                forceCLIRefresh: forceCLIRefresh
            )
        } catch {
            // Passive refreshes keep the last known snapshot so brief shell hiccups do not blank the menu bar.
        }
    }

    func saveRelayOverride(_ value: String) {
        applyRelayOverride(value, successMessage: "Relay updated.")
    }

    func useRelay(_ value: String) {
        applyRelayOverride(value, successMessage: "Relay switched.")
    }

    func clearRelayOverride() {
        applyRelayOverride("", successMessage: "Default relay restored.")
    }

    func saveTailscaleHostOverride(_ value: String) {
        let normalizedHost = Self.normalizeTailscaleHost(value)
        tailscaleHostOverride = normalizedHost
        if normalizedHost.isEmpty {
            UserDefaults.standard.removeObject(forKey: Self.tailscaleHostOverrideKey)
            transientMessage = "Tailscale address cleared."
        } else {
            UserDefaults.standard.set(normalizedHost, forKey: Self.tailscaleHostOverrideKey)
            transientMessage = "Tailscale address saved."
        }
        errorMessage = ""
    }

    func clearTailscaleHostOverride() {
        saveTailscaleHostOverride("")
    }

    private func applyRelayOverride(_ value: String, successMessage: String) {
        let normalizedRelay = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let expectedRelay = normalizedRelay.isEmpty ? nil : normalizedRelay
        let previousPairingDate = snapshot?.pairingSession?.createdDate
        runAction(successMessage: successMessage) {
            try await self.requireCLIAvailability()
            self.relayOverride = normalizedRelay
            if normalizedRelay.isEmpty {
                UserDefaults.standard.removeObject(forKey: Self.relayOverrideKey)
            } else {
                UserDefaults.standard.set(normalizedRelay, forKey: Self.relayOverrideKey)
            }
            try await self.service.startBridge(relayOverride: self.effectiveRelayOverride)
            try await self.waitForFreshPairing(after: previousPairingDate, expectedRelayURL: expectedRelay)
        }
    }

    func startBridge() {
        let previousPairingDate = snapshot?.pairingSession?.createdDate
        runAction(successMessage: "Bridge avviato.") {
            try await self.requireCLIAvailability()
            try await self.service.startBridge(relayOverride: self.effectiveRelayOverride)
            try await self.waitForFreshPairing(after: previousPairingDate, expectedRelayURL: self.effectiveRelayOverride)
        }
    }

    func stopBridge() {
        runAction(successMessage: "Bridge fermato.") {
            try await self.requireCLIAvailability()
            try await self.service.stopBridge(relayOverride: self.effectiveRelayOverride)
            try await self.refreshAfterAction()
        }
    }

    func resumeLastThread() {
        runAction(successMessage: "Ultimo thread riaperto in Codex.") {
            try await self.requireCLIAvailability()
            try await self.service.resumeLastThread(relayOverride: self.effectiveRelayOverride)
            try await self.refreshAfterAction()
        }
    }

    func resetPairing() {
        runAction(successMessage: "Pairing resettato.") {
            try await self.requireCLIAvailability()
            let previousPairingDate = self.snapshot?.pairingSession?.createdDate
            try await self.service.resetPairing(relayOverride: self.effectiveRelayOverride)
            try await self.service.startBridge(relayOverride: self.effectiveRelayOverride)
            try await self.waitForFreshPairing(after: previousPairingDate, expectedRelayURL: self.effectiveRelayOverride)
        }
    }

    func renewPairing() {
        runAction(successMessage: "Pairing refreshed.") {
            try await self.requireCLIAvailability()
            let previousPairingDate = self.snapshot?.pairingSession?.createdDate
            if self.snapshot?.launchdLoaded == true {
                do {
                    try await self.service.renewPairing(relayOverride: self.effectiveRelayOverride)
                    try await self.refreshAfterAction()
                } catch {
                    try await self.service.startBridge(relayOverride: self.effectiveRelayOverride)
                    try await self.waitForFreshPairing(after: previousPairingDate, expectedRelayURL: self.effectiveRelayOverride)
                }
            } else {
                try await self.service.startBridge(relayOverride: self.effectiveRelayOverride)
                try await self.waitForFreshPairing(after: previousPairingDate, expectedRelayURL: self.effectiveRelayOverride)
            }
        }
    }

    func enableTrustedDevice(_ device: BridgeTrustedDevice) {
        updateTrustedDevice(
            device,
            successMessage: "Trusted device enabled."
        ) {
            try await self.service.setTrustedDevice(device.id, enabled: true, relayOverride: self.effectiveRelayOverride)
        }
    }

    func disableTrustedDevice(_ device: BridgeTrustedDevice) {
        updateTrustedDevice(
            device,
            successMessage: "Trusted device disabled."
        ) {
            try await self.service.setTrustedDevice(device.id, enabled: false, relayOverride: self.effectiveRelayOverride)
        }
    }

    func revokeTrustedDevice(_ device: BridgeTrustedDevice) {
        updateTrustedDevice(
            device,
            successMessage: "Trusted device removed."
        ) {
            try await self.service.revokeTrustedDevice(device.id, relayOverride: self.effectiveRelayOverride)
        }
    }

    func retryCLISetup() {
        Task {
            await self.refresh(showSpinner: true, forceCLIRefresh: true)
        }
    }

    func openLogsFolder() {
        let path = snapshot?.stateDirectoryPath.trimmingCharacters(in: .whitespacesAndNewlines)
        let targetPath = (path?.isEmpty == false) ? path! : "\(NSHomeDirectory())/.remodex"
        NSWorkspace.shared.open(URL(fileURLWithPath: targetPath))
    }

    func openStdoutLog() {
        guard let snapshot else { return }
        NSWorkspace.shared.open(URL(fileURLWithPath: snapshot.stdoutLogPath))
    }

    func openStderrLog() {
        guard let snapshot else { return }
        NSWorkspace.shared.open(URL(fileURLWithPath: snapshot.stderrLogPath))
    }

    func copyTextToPasteboard(_ value: String, successMessage: String = "Copied.") {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = "Nothing to copy."
            return
        }

        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(trimmed, forType: .string)
        transientMessage = successMessage
        errorMessage = ""
    }

    func openExternalURL(_ value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), !trimmed.isEmpty else {
            errorMessage = "URL is not available."
            return
        }

        NSWorkspace.shared.open(url)
    }

    private var effectiveRelayOverride: String? {
        relayOverride.isEmpty ? nil : relayOverride
    }

    var effectiveTailscaleHost: String {
        if let overrideHost = Self.normalizeTailscaleHost(tailscaleHostOverride).nonEmptyTrimmed {
            return overrideHost
        }

        return snapshot?.tailscaleDNSName?.nonEmptyTrimmed ?? ""
    }

    var tailscaleRelayURL: String {
        let host = effectiveTailscaleHost
        guard !host.isEmpty else {
            return snapshot?.tailscaleRelayURL ?? ""
        }

        return "wss://\(host)/relay"
    }

    var tailscaleWebAppURL: String {
        let host = effectiveTailscaleHost
        guard !host.isEmpty else {
            return snapshot?.tailscaleWebAppURL ?? ""
        }

        return "https://\(host)/app/"
    }

    var isCLIAvailable: Bool {
        cliAvailability.isAvailable
    }

    private func startRefreshLoop() {
        refreshLoopTask = Task { [weak self] in
            guard let self else { return }

            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(480))
                guard !Task.isCancelled else { return }
                await self.refresh(showSpinner: false)
            }
        }
    }

    // Performs the first load in two stages so the UI can show a dedicated "install the CLI" blocker.
    private func bootstrap() async {
        let cliAvailability = await refreshCLIAvailability()
        guard cliAvailability.isAvailable else {
            snapshot = nil
            return
        }

        await refresh(showSpinner: true)
    }

    @discardableResult
    private func refreshCLIAvailability() async -> BridgeCLIAvailability {
        await refreshCLIAvailability(forceRefresh: false)
    }

    @discardableResult
    private func refreshCLIAvailability(forceRefresh: Bool) async -> BridgeCLIAvailability {
        let availability = await service.detectCLIAvailability(forceRefresh: forceRefresh)
        cliAvailability = availability
        return availability
    }

    private func requireCLIAvailability() async throws {
        switch await refreshCLIAvailability() {
        case .available:
            return
        case .missing:
            throw BridgeMenuBarActionError.missingCLI
        case .broken(let message):
            throw BridgeMenuBarActionError.brokenCLI(message)
        case .checking:
            throw BridgeMenuBarActionError.missingCLI
        }
    }

    private func updateTrustedDevice(
        _ device: BridgeTrustedDevice,
        successMessage: String,
        action: @escaping () async throws -> Void
    ) {
        _ = device
        runAction(successMessage: successMessage) {
            try await self.requireCLIAvailability()
            try await action()
            try await self.refreshAfterAction()
        }
    }

    // Lets command handlers fail loudly when the follow-up snapshot cannot be trusted.
    private func refreshAfterAction() async throws {
        _ = try await performRefresh(
            showSpinner: false,
            clearSnapshotOnFailure: true,
            forceCLIRefresh: false
        )
    }

    @discardableResult
    private func performRefresh(
        showSpinner: Bool,
        clearSnapshotOnFailure: Bool,
        forceCLIRefresh: Bool
    ) async throws -> BridgeSnapshot? {
        if showSpinner {
            isRefreshing = true
        }

        defer {
            isRefreshing = false
        }

        let cliAvailability = await refreshCLIAvailability(forceRefresh: forceCLIRefresh)
        guard cliAvailability.isAvailable else {
            snapshot = nil
            transientMessage = ""
            errorMessage = ""
            return nil
        }

        do {
            let snapshot = try await service.loadSnapshot(relayOverride: effectiveRelayOverride)
            self.snapshot = snapshot
            self.errorMessage = ""
            return snapshot
        } catch {
            if clearSnapshotOnFailure {
                snapshot = nil
            }
            errorMessage = error.localizedDescription
            throw error
        }
    }

    // Treats a missing fresh QR as a real start failure so the menu bar never reports a false success.
    private func waitForFreshPairing(after previousPairingDate: Date?, expectedRelayURL: String? = nil) async throws {
        for _ in 0..<20 {
            do {
                let nextSnapshot = try await service.loadSnapshot(relayOverride: effectiveRelayOverride)
                let nextPairingDate = nextSnapshot.pairingSession?.createdDate
                self.snapshot = nextSnapshot
                if let expectedRelayURL,
                   !Self.relayURLsMatch(nextSnapshot.effectiveRelayURL, expectedRelayURL) {
                    try? await Task.sleep(for: .milliseconds(500))
                    continue
                }

                if previousPairingDate == nil {
                    if nextSnapshot.pairingSession?.pairingPayload != nil {
                        return
                    }
                } else if let nextPairingDate,
                          let previousPairingDate,
                          nextPairingDate > previousPairingDate {
                    return
                }
            } catch {
                self.errorMessage = error.localizedDescription
            }

            try? await Task.sleep(for: .milliseconds(500))
        }

        throw BridgeMenuBarActionError.pairingTimeout
    }

    private static func relayURLsMatch(_ lhs: String, _ rhs: String) -> Bool {
        let normalizedLHS = normalizeRelayURLForComparison(lhs)
        let normalizedRHS = normalizeRelayURLForComparison(rhs)
        return !normalizedLHS.isEmpty && normalizedLHS == normalizedRHS
    }

    private static func normalizeRelayURLForComparison(_ value: String) -> String {
        var normalized = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        while normalized.hasSuffix("/") {
            normalized.removeLast()
        }
        return normalized
    }

    private static func normalizeTailscaleHost(_ value: String) -> String {
        let trimmed = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
        guard !trimmed.isEmpty else {
            return ""
        }

        let parseCandidate = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        if let components = URLComponents(string: parseCandidate),
           let host = components.host?.trimmingCharacters(in: .whitespacesAndNewlines),
           !host.isEmpty {
            return host
                .trimmingCharacters(in: CharacterSet(charactersIn: "."))
                .lowercased()
        }

        return trimmed
            .split(separator: "/")
            .first
            .map(String.init)?
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
            .lowercased() ?? ""
    }

    private func runAction(
        successMessage: String,
        operation: @escaping @MainActor () async throws -> Void
    ) {
        guard !isPerformingAction else {
            return
        }

        isPerformingAction = true
        transientMessage = ""
        errorMessage = ""

        Task {
            defer {
                self.isPerformingAction = false
            }

            do {
                try await operation()
                self.transientMessage = successMessage
            } catch {
                self.errorMessage = error.localizedDescription
            }
        }
    }
}

private extension String {
    var nonEmptyTrimmed: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
