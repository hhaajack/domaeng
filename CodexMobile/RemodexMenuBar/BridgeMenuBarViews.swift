// FILE: BridgeMenuBarViews.swift
// Purpose: Renders the lightweight menu bar service popover plus the full Remodex control center window.
// Layer: Companion app view
// Exports: BridgeMenuBarContentView, BridgeControlCenterWindow, BridgeMenuBarLabel
// Depends on: SwiftUI, AppKit, CoreImage, BridgeMenuBarStore, BridgeControlModels

import AppKit
import CoreImage.CIFilterBuiltins
import SwiftUI

struct BridgeMenuBarContentView: View {
    @ObservedObject var store: BridgeMenuBarStore
    @Environment(\.openWindow) private var openWindow
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            compactHeader

            if store.isCLIAvailable {
                serviceSummary
                serviceActions
                feedbackBlock
            } else {
                compactCLISetup
            }
        }
        .padding(14)
        .frame(width: 320)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var compactHeader: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Remodex")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.primary)
                Text(versionSummary)
                    .font(.system(size: 10, weight: .regular, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer()
            statusIndicator
        }
    }

    private var statusIndicator: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(statusTint)
                .frame(width: 7, height: 7)
            Text(currentStatusTitle.uppercased())
                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
    }

    private var serviceSummary: some View {
        VStack(alignment: .leading, spacing: 8) {
            CompactStatusRow(label: "Service", value: serviceStateLabel)
            CompactStatusRow(label: "Connection", value: store.snapshot?.bridgeStatus?.connectionStatus ?? "unknown")
            CompactStatusRow(label: "Relay", value: store.snapshot?.relayKindLabel ?? "Unconfigured")
        }
        .padding(12)
        .background(cardFill, in: cardShape)
        .overlay(cardBorder)
    }

    private var serviceActions: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                CompactActionButton("Start", style: .primary, isDisabled: store.isPerformingAction) {
                    store.startBridge()
                }
                CompactActionButton("Stop", style: .destructive, isDisabled: store.isPerformingAction) {
                    store.stopBridge()
                }
            }

            HStack(spacing: 8) {
                CompactActionButton("Refresh", style: .secondary, isDisabled: store.isRefreshing) {
                    Task { await store.refresh(showSpinner: true) }
                }
                CompactActionButton("Control Center", style: .secondary) {
                    openControlCenter()
                }
            }

        }
    }

    @ViewBuilder
    private var feedbackBlock: some View {
        let hasBridgeError = !(store.snapshot?.lastErrorMessage ?? "").isEmpty
        if !store.errorMessage.isEmpty || !store.transientMessage.isEmpty || hasBridgeError {
            VStack(alignment: .leading, spacing: 6) {
                if !store.transientMessage.isEmpty {
                    feedbackLine(store.transientMessage, tint: .green)
                }
                if !store.errorMessage.isEmpty {
                    feedbackLine(store.errorMessage, tint: .red)
                }
                if let bridgeError = store.snapshot?.lastErrorMessage, !bridgeError.isEmpty {
                    feedbackLine(bridgeError, tint: .pink)
                }
            }
            .padding(12)
            .background(cardFill, in: cardShape)
            .overlay(cardBorder)
        }
    }

    private var compactCLISetup: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                sectionTitle("Bridge Runtime")
                Spacer()
                statusIndicator
            }

            Text(store.cliAvailability.setupTitle)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.primary)

            Text(store.cliAvailability.setupMessage)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 8) {
                CompactActionButton("Retry", style: .primary) {
                    store.retryCLISetup()
                }
                CompactActionButton("Control Center", style: .secondary) {
                    openControlCenter()
                }
            }
        }
        .padding(12)
        .background(cardFill, in: cardShape)
        .overlay(cardBorder)
    }

    private var cardShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
    }

    private var cardFill: Color {
        Color(nsColor: .controlBackgroundColor).opacity(colorScheme == .dark ? 0.42 : 0.62)
    }

    private var cardBorder: some View {
        cardShape.stroke(Color.primary.opacity(0.06), lineWidth: 1)
    }

    private var statusTint: Color {
        if !store.isCLIAvailable { return cliStatusTint }

        let status = store.snapshot?.bridgeStatus?.connectionStatus?.lowercased()
        if status == "connected" { return .green }
        if status == "connecting" || status == "starting" { return .yellow }
        if status == "error" { return .red }

        return store.snapshot?.launchdLoaded == true ? .blue : .gray
    }

    private var cliStatusTint: Color {
        switch store.cliAvailability {
        case .checking: return .yellow
        case .available: return .green
        case .missing: return .orange
        case .broken: return .red
        }
    }

    private var currentStatusTitle: String {
        if let snapshot = store.snapshot { return snapshot.statusHeadline }
        switch store.cliAvailability {
        case .available: return "Loading"
        case .checking: return "Checking"
        case .missing: return "CLI Missing"
        case .broken: return "CLI Error"
        }
    }

    private var serviceStateLabel: String {
        store.snapshot?.launchdLoaded == true ? "Loaded" : "Stopped"
    }

    private var versionSummary: String {
        let installed = store.snapshot?.currentVersion ?? store.cliAvailability.versionLabel ?? "-"
        return "Installed \(installed)  Adapted \(store.supportedBridgeVersion)"
    }

    private func openControlCenter() {
        openWindow(id: RemodexWindowID.controlCenter)
        NSApp.activate(ignoringOtherApps: true)
    }
}

struct BridgeControlCenterWindow: View {
    @ObservedObject var store: BridgeMenuBarStore
    @State private var relayDraft = ""
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                windowHeader

                if store.isCLIAvailable {
                    serviceSection
                    connectionSection
                    pairingSection
                    trustedDevicesSection
                    logsSection
                    feedbackSection
                } else {
                    cliSetupCard
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minWidth: 680, minHeight: 620)
        .background(Color(nsColor: .windowBackgroundColor))
        .task {
            relayDraft = store.relayOverride
        }
        .onChange(of: store.relayOverride) { _, newValue in
            relayDraft = newValue
        }
    }

    private var windowHeader: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Remodex")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(.primary)
                Text(store.snapshot?.label ?? "com.remodex.bridge")
                    .font(.system(size: 11, weight: .regular, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer()

            HStack(spacing: 7) {
                Circle()
                    .fill(statusTint)
                    .frame(width: 8, height: 8)
                Text(currentStatusTitle)
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color(nsColor: .controlBackgroundColor).opacity(0.65), in: Capsule())
        }
    }

    private var serviceSection: some View {
        controlSection("Service") {
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 12) {
                GridRow {
                    statusTile("Daemon", store.snapshot?.launchdLoaded == true ? "Loaded" : "Stopped")
                    statusTile("Connection", store.snapshot?.bridgeStatus?.connectionStatus ?? "unknown")
                    statusTile("PID", pidLabel)
                }
                GridRow {
                    statusTile("Installed", store.snapshot?.currentVersion ?? store.cliAvailability.versionLabel ?? "-")
                    statusTile("Adapted", store.supportedBridgeVersion)
                    statusTile("Updated", store.snapshot?.statusFootnote ?? "n/a")
                }
            }

            HStack(spacing: 8) {
                CompactActionButton("Start", style: .primary, isDisabled: store.isPerformingAction) {
                    store.startBridge()
                }
                CompactActionButton("Stop", style: .destructive, isDisabled: store.isPerformingAction) {
                    store.stopBridge()
                }
                CompactActionButton("Resume Thread", style: .secondary, isDisabled: store.isPerformingAction) {
                    store.resumeLastThread()
                }
                CompactActionButton("Refresh", style: .secondary, isDisabled: store.isRefreshing) {
                    Task { await store.refresh(showSpinner: true) }
                }
            }

        }
    }

    private var connectionSection: some View {
        controlSection("Connection") {
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 12) {
                GridRow {
                    ConnectionEndpointTile(
                        title: "Tailscale Web",
                        value: tailscaleWebAppURLLabel
                    )
                    ConnectionEndpointTile(
                        title: "Local LAN Web",
                        value: localLANWebAppURLLabel
                    )
                }
                GridRow {
                    ConnectionEndpointTile(
                        title: "Tailscale Relay",
                        value: tailscaleRelayURLLabel
                    )
                    ConnectionEndpointTile(
                        title: "Local LAN Relay",
                        value: localLANRelayURLLabel
                    )
                }
            }

            HStack(spacing: 8) {
                if isActiveTailscaleRelay {
                    CompactActionButton("Open Tailscale App", style: .secondary, isDisabled: tailscaleWebAppURLLabel.isEmpty) {
                        store.openExternalURL(webAppEntryURL(baseURL: tailscaleWebAppURLLabel, entry: "tailscale"))
                    }
                } else {
                    CompactActionButton(
                        "Use Tailscale Relay",
                        style: .secondary,
                        isDisabled: tailscaleRelayURLLabel.isEmpty || store.isPerformingAction
                    ) {
                        switchRelay(to: tailscaleRelayURLLabel)
                    }
                }

                if isActiveLocalLANRelay {
                    CompactActionButton("Open Local App", style: .secondary) {
                        store.openExternalURL(webAppEntryURL(baseURL: localLANWebAppURLLabel, entry: "local"))
                    }
                } else {
                    CompactActionButton("Use Local Relay", style: .primary, isDisabled: store.isPerformingAction) {
                        switchRelay(to: localLANRelayURLLabel)
                    }
                }
            }

            HStack(spacing: 8) {
                CompactActionButton(
                    "Copy Tailscale Relay",
                    style: .secondary,
                    isDisabled: tailscaleRelayURLLabel.isEmpty || !isActiveTailscaleRelay
                ) {
                    store.copyTextToPasteboard(tailscaleRelayURLLabel, successMessage: "Tailscale relay copied.")
                }
                CompactActionButton("Copy Local Relay", style: .secondary, isDisabled: !isActiveLocalLANRelay) {
                    store.copyTextToPasteboard(localLANRelayURLLabel, successMessage: "Local relay copied.")
                }
            }

            Divider()

            LabelValueRow(label: "Active Relay", value: relayURLLabel)

            TextField("ws://localhost:9000/relay", text: $relayDraft)
                .textFieldStyle(.plain)
                .font(.system(size: 12, weight: .regular, design: .monospaced))
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Color(nsColor: .textBackgroundColor).opacity(0.82), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(Color.primary.opacity(0.08), lineWidth: 1)
                )

            HStack(spacing: 8) {
                CompactActionButton("Save Relay Override", style: .primary) {
                    store.saveRelayOverride(relayDraft)
                }
                CompactActionButton("Use Defaults", style: .secondary) {
                    relayDraft = ""
                    store.clearRelayOverride()
                }
            }
        }
    }

    @ViewBuilder
    private var pairingSection: some View {
        controlSection("Pairing") {
            if let payload = store.snapshot?.pairingSession?.pairingPayload {
                HStack(alignment: .top, spacing: 18) {
                    PairingQRCodeView(payload: payload)
                        .frame(width: 150, height: 150)
                        .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .stroke(Color.primary.opacity(0.08), lineWidth: 1)
                        )

                    VStack(alignment: .leading, spacing: 12) {
                        if let pairingCode = trimmedNonEmpty(store.snapshot?.pairingSession?.pairingCode) {
                            PairingCodeBadge(code: pairingCode)
                        }

                        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 12) {
                            GridRow {
                                LabelValueRow(label: "Session", value: shortIdentifier(payload.sessionId))
                                LabelValueRow(label: "Device", value: shortIdentifier(payload.macDeviceId))
                            }
                            GridRow {
                                LabelValueRow(label: "Expires", value: payload.expiryDate.formatted(date: .omitted, time: .shortened))
                                PairingStateRow(payload: payload)
                            }
                        }
                    }
                }
            } else {
                Text("Start Remodex to publish a pairing QR.")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 8) {
                CompactActionButton("Reset Pairing", style: .destructive, isDisabled: store.isPerformingAction) {
                    store.resetPairing()
                }
                CompactActionButton("Renew Pairing", style: .secondary, isDisabled: store.isPerformingAction) {
                    store.renewPairing()
                }
            }
        }
    }

    private var trustedDevicesSection: some View {
        controlSection("Trusted Devices") {
            let devices = store.snapshot?.trustedDeviceList ?? []
            if devices.isEmpty {
                Text("No trusted devices yet.")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 10) {
                    ForEach(devices) { device in
                        TrustedDeviceRow(device: device, store: store)
                    }
                }
            }
        }
    }

    private var logsSection: some View {
        controlSection("Logs") {
            if let snapshot = store.snapshot {
                LabelValueRow(label: "Stdout", value: snapshot.stdoutLogPath)
                LabelValueRow(label: "Stderr", value: snapshot.stderrLogPath)
            }

            HStack(spacing: 8) {
                CompactActionButton("Open Folder", style: .secondary) {
                    store.openLogsFolder()
                }
                CompactActionButton("Open Stdout", style: .secondary) {
                    store.openStdoutLog()
                }
                CompactActionButton("Open Stderr", style: .secondary) {
                    store.openStderrLog()
                }
            }
        }
    }

    @ViewBuilder
    private var feedbackSection: some View {
        let hasBridgeError = !(store.snapshot?.lastErrorMessage ?? "").isEmpty
        if !store.errorMessage.isEmpty || !store.transientMessage.isEmpty || hasBridgeError {
            controlSection("Feedback") {
                if !store.transientMessage.isEmpty {
                    feedbackLine(store.transientMessage, tint: .green)
                }
                if !store.errorMessage.isEmpty {
                    feedbackLine(store.errorMessage, tint: .red)
                }
                if let bridgeError = store.snapshot?.lastErrorMessage, !bridgeError.isEmpty {
                    feedbackLine(bridgeError, tint: .pink)
                }
            }
        }
    }

    private var cliSetupCard: some View {
        controlSection("Bridge Runtime") {
            Text(store.cliAvailability.setupTitle)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.primary)

            Text(store.cliAvailability.setupMessage)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            LabelValueRow(label: "Install", value: BridgeCLIAvailability.installCommand)

            CompactActionButton("Retry", style: .primary) {
                store.retryCLISetup()
            }
        }
    }

    private func controlSection<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle(title)
            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(cardFill, in: cardShape)
        .overlay(cardBorder)
    }

    private var cardShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
    }

    private var cardFill: Color {
        Color(nsColor: .controlBackgroundColor).opacity(colorScheme == .dark ? 0.42 : 0.62)
    }

    private var cardBorder: some View {
        cardShape.stroke(Color.primary.opacity(0.06), lineWidth: 1)
    }

    private var statusTint: Color {
        if !store.isCLIAvailable { return cliStatusTint }

        let status = store.snapshot?.bridgeStatus?.connectionStatus?.lowercased()
        if status == "connected" { return .green }
        if status == "connecting" || status == "starting" { return .yellow }
        if status == "error" { return .red }

        return store.snapshot?.launchdLoaded == true ? .blue : .gray
    }

    private var cliStatusTint: Color {
        switch store.cliAvailability {
        case .checking: return .yellow
        case .available: return .green
        case .missing: return .orange
        case .broken: return .red
        }
    }

    private var currentStatusTitle: String {
        if let snapshot = store.snapshot { return snapshot.statusHeadline }
        switch store.cliAvailability {
        case .available: return "Loading"
        case .checking: return "Checking"
        case .missing: return "CLI Missing"
        case .broken: return "CLI Error"
        }
    }

    private var pidLabel: String {
        if let pid = store.snapshot?.launchdPid { return String(pid) }
        if let pid = store.snapshot?.bridgeStatus?.pid { return String(pid) }
        return "-"
    }

    private var relayURLLabel: String {
        if let relay = store.snapshot?.effectiveRelayURL, !relay.isEmpty {
            return relay
        }

        return "Not configured yet"
    }

    private var tailscaleRelayURLLabel: String {
        store.snapshot?.tailscaleRelayURL ?? ""
    }

    private var tailscaleWebAppURLLabel: String {
        store.snapshot?.tailscaleWebAppURL ?? ""
    }

    private var localLANRelayURLLabel: String {
        store.snapshot?.localLANRelayURL ?? "ws://localhost:9000/relay"
    }

    private var localLANWebAppURLLabel: String {
        store.snapshot?.localLANWebAppURL ?? "http://localhost:9000/app/"
    }

    private var activeRelayURLLabel: String {
        store.snapshot?.effectiveRelayURL ?? ""
    }

    private var isActiveTailscaleRelay: Bool {
        relayURLsMatch(activeRelayURLLabel, tailscaleRelayURLLabel)
    }

    private var isActiveLocalLANRelay: Bool {
        relayURLsMatch(activeRelayURLLabel, localLANRelayURLLabel)
    }

    private func switchRelay(to relayURL: String) {
        relayDraft = relayURL
        store.useRelay(relayURL)
    }

    private func webAppEntryURL(baseURL: String, entry: String) -> String {
        guard !baseURL.isEmpty,
              var components = URLComponents(string: baseURL) else {
            return baseURL
        }

        var queryItems = [URLQueryItem(name: "entry", value: entry)]
        if entry == "tailscale" {
            queryItems.append(URLQueryItem(name: "tailscaleRelay", value: tailscaleRelayURLLabel))
        } else if entry == "local" {
            queryItems.append(URLQueryItem(name: "localRelay", value: localLANRelayURLLabel))
        }

        components.queryItems = queryItems.filter { !($0.value ?? "").isEmpty }

        return components.string ?? baseURL
    }

    private func relayURLsMatch(_ lhs: String, _ rhs: String) -> Bool {
        let normalizedLHS = normalizeRelayURLForComparison(lhs)
        let normalizedRHS = normalizeRelayURLForComparison(rhs)
        return !normalizedLHS.isEmpty && normalizedLHS == normalizedRHS
    }

    private func normalizeRelayURLForComparison(_ value: String) -> String {
        var normalized = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        while normalized.hasSuffix("/") {
            normalized.removeLast()
        }
        return normalized
    }
}

// MARK: - Menu bar icon

struct BridgeMenuBarLabel: View {
    let snapshot: BridgeSnapshot?
    let isBusy: Bool

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Image(systemName: "terminal")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(isBusy ? Color.primary.opacity(0.7) : Color.primary)
            if snapshot?.bridgeStatus?.connectionStatus?.lowercased() == "connected" {
                Circle()
                    .fill(.green)
                    .frame(width: 7, height: 7)
                    .offset(x: 4, y: -2)
            }
        }
    }
}

// MARK: - Shared components

private func sectionTitle(_ title: String) -> some View {
    Text(title.uppercased())
        .font(.system(size: 10, weight: .semibold, design: .monospaced))
        .foregroundStyle(.tertiary)
}

private func statusTile(_ title: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        Text(title.uppercased())
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(.secondary)
        Text(value)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.primary)
            .lineLimit(1)
            .truncationMode(.middle)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(12)
    .background(Color(nsColor: .textBackgroundColor).opacity(0.78), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    .overlay(
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .stroke(Color.primary.opacity(0.06), lineWidth: 1)
    )
}

private func feedbackLine(_ message: String, tint: Color) -> some View {
    HStack(alignment: .top, spacing: 6) {
        Circle()
            .fill(tint)
            .frame(width: 6, height: 6)
            .padding(.top, 4)
        Text(message)
            .font(.system(size: 11))
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private func shortIdentifier(_ value: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.count > 14 else {
        return trimmed
    }

    return "\(trimmed.prefix(8))...\(trimmed.suffix(4))"
}

private func trimmedNonEmpty(_ value: String?) -> String? {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmed.isEmpty ? nil : trimmed
}

private struct ConnectionEndpointTile: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(displayValue)
                .font(.system(size: 11, weight: .regular, design: .monospaced))
                .foregroundStyle(value.isEmpty ? .tertiary : .primary)
                .lineLimit(2)
                .truncationMode(.middle)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, minHeight: 62, alignment: .leading)
        .padding(12)
        .background(Color(nsColor: .textBackgroundColor).opacity(0.78), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.primary.opacity(0.06), lineWidth: 1)
        )
    }

    private var displayValue: String {
        value.isEmpty ? "Not configured" : value
    }
}

private struct PairingCodeBadge: View {
    let code: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("CODE")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.tertiary)
            Text(code)
                .font(.system(size: 22, weight: .semibold, design: .monospaced))
                .foregroundStyle(.primary)
                .textSelection(.enabled)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(nsColor: .textBackgroundColor).opacity(0.78), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.primary.opacity(0.06), lineWidth: 1)
        )
    }
}

private struct PairingStateRow: View {
    let payload: BridgePairingPayload

    var body: some View {
        TimelineView(.periodic(from: Date(), by: 1)) { context in
            LabelValueRow(label: "State", value: payload.stateLabel(at: context.date))
        }
    }
}

private struct TrustedDeviceRow: View {
    let device: BridgeTrustedDevice
    @ObservedObject var store: BridgeMenuBarStore

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(device.displayName)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .truncationMode(.middle)

                    HStack(spacing: 8) {
                        Text(trustedDeviceKindLabel(device.kind))
                        Text(device.fingerprint)
                        if let lastSeen = trustedDeviceDateLabel(device.lastSeenAt) {
                            Text(lastSeen)
                        }
                    }
                    .font(.system(size: 10, weight: .regular, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                }

                Spacer(minLength: 8)

                Text(trustedDeviceStatusLabel(device))
                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .foregroundStyle(trustedDeviceIsDisabled(device) ? .orange : .green)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color(nsColor: .textBackgroundColor).opacity(0.72), in: Capsule())
            }

            HStack(spacing: 8) {
                if trustedDeviceIsDisabled(device) {
                    CompactActionButton("Enable", style: .primary, isDisabled: store.isPerformingAction) {
                        store.enableTrustedDevice(device)
                    }
                } else {
                    CompactActionButton("Disable", style: .secondary, isDisabled: store.isPerformingAction) {
                        store.disableTrustedDevice(device)
                    }
                }
                CompactActionButton("Remove", style: .destructive, isDisabled: store.isPerformingAction) {
                    store.revokeTrustedDevice(device)
                }
            }
        }
        .padding(12)
        .background(Color(nsColor: .textBackgroundColor).opacity(0.76), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color.primary.opacity(0.06), lineWidth: 1)
        )
    }
}

private struct CompactStatusRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: 10) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 84, alignment: .leading)
            Text(value)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.primary)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }
}

private func trustedDeviceIsDisabled(_ device: BridgeTrustedDevice) -> Bool {
    device.status?.lowercased() == "disabled" || trimmedNonEmpty(device.disabledAt) != nil
}

private func trustedDeviceStatusLabel(_ device: BridgeTrustedDevice) -> String {
    trustedDeviceIsDisabled(device) ? "DISABLED" : "ENABLED"
}

private func trustedDeviceKindLabel(_ value: String?) -> String {
    switch value?.lowercased() {
    case "ios":
        return "iOS"
    case "web":
        return "Web"
    case "android":
        return "Android"
    default:
        return "Device"
    }
}

private func trustedDeviceDateLabel(_ value: String?) -> String? {
    guard let value = trimmedNonEmpty(value) else {
        return nil
    }
    if let date = trustedDeviceISO8601Formatter.date(from: value) {
        return "Seen " + trustedDeviceRelativeFormatter.localizedString(for: date, relativeTo: Date())
    }
    return nil
}

private let trustedDeviceISO8601Formatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

private let trustedDeviceRelativeFormatter: RelativeDateTimeFormatter = {
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .short
    return formatter
}()

private struct LabelValueRow: View {
    let label: String
    let value: String
    var lineLimit: Int? = 2

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.tertiary)
            Text(value)
                .font(.system(size: 11, weight: .regular, design: .monospaced))
                .foregroundStyle(.primary)
                .lineLimit(lineLimit)
                .truncationMode(.middle)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct CompactActionButton: View {
    let title: String
    let style: Style
    let isDisabled: Bool
    let action: () -> Void

    enum Style { case primary, secondary, destructive }

    init(
        _ title: String,
        style: Style = .secondary,
        isDisabled: Bool = false,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.style = style
        self.isDisabled = isDisabled
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(foregroundColor)
                .lineLimit(1)
                .minimumScaleFactor(0.86)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 7)
                .padding(.horizontal, 8)
                .background(backgroundColor, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(borderColor, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.55 : 1)
    }

    private var backgroundColor: Color {
        guard !isDisabled else {
            return Color(nsColor: .textBackgroundColor).opacity(0.45)
        }

        switch style {
        case .primary: return .primary
        case .secondary: return Color(nsColor: .textBackgroundColor).opacity(0.5)
        case .destructive: return Color(nsColor: .textBackgroundColor).opacity(0.5)
        }
    }

    private var foregroundColor: Color {
        guard !isDisabled else {
            return .secondary
        }

        switch style {
        case .primary: return Color(nsColor: .windowBackgroundColor)
        case .secondary: return .primary
        case .destructive: return .red
        }
    }

    private var borderColor: Color {
        guard !isDisabled else {
            return Color.primary.opacity(0.05)
        }

        switch style {
        case .primary: return .clear
        case .secondary: return .primary.opacity(0.06)
        case .destructive: return .red.opacity(0.15)
        }
    }
}

private struct PairingQRCodeView: View {
    let payload: BridgePairingPayload
    private let context = CIContext()
    private let filter = CIFilter.qrCodeGenerator()

    var body: some View {
        Group {
            if let image = qrImage {
                Image(nsImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .padding(10)
            } else {
                Text("QR unavailable")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
        }
    }

    private var qrImage: NSImage? {
        let payloadObject = PairingQRPayloadEnvelope(
            v: payload.v,
            relay: payload.relay,
            sessionId: payload.sessionId,
            macDeviceId: payload.macDeviceId,
            macIdentityPublicKey: payload.macIdentityPublicKey,
            expiresAt: payload.expiresAt
        )
        guard let data = try? JSONEncoder().encode(payloadObject) else { return nil }

        filter.setValue(data, forKey: "inputMessage")
        filter.correctionLevel = "M"

        guard let outputImage = filter.outputImage else { return nil }
        let scaledImage = outputImage.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
        guard let cgImage = context.createCGImage(scaledImage, from: scaledImage.extent) else { return nil }
        return NSImage(cgImage: cgImage, size: .zero)
    }
}

private struct PairingQRPayloadEnvelope: Encodable {
    let v: Int
    let relay: String
    let sessionId: String
    let macDeviceId: String
    let macIdentityPublicKey: String
    let expiresAt: Int64
}
