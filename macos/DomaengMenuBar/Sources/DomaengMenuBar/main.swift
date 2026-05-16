import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI

@main
struct DomaengMenuBarApp: App {
    @StateObject private var model = DomaengMenuBarModel()

    var body: some Scene {
        MenuBarExtra {
            DomaengPanel(model: model)
        } label: {
            MenuBarLogoLabel()
        }
        .menuBarExtraStyle(.window)
    }
}

struct DomaengPanel: View {
    @ObservedObject var model: DomaengMenuBarModel
    @State private var isTrustedDevicesPresented = false
    @State private var isTailscaleAddressPresented = false
    @State private var isQRCodePresented = false
    @State private var tailscaleAddressDraft = ""

    var body: some View {
        ZStack {
            PanelBackground()
            VStack(alignment: .leading, spacing: 12) {
                header
                statusCard
                webCard
                pairingCard
                controls
                footer
            }
            .padding(14)

            if isQRCodePresented {
                PanelModalOverlay {
                    QRCodePanel(
                        image: model.qrImage,
                        onClose: { isQRCodePresented = false }
                    )
                }
            }

            if isTrustedDevicesPresented {
                PanelModalOverlay {
                    TrustedDevicesPanel(
                        model: model,
                        onClose: { isTrustedDevicesPresented = false }
                    )
                }
            }

            if isTailscaleAddressPresented {
                PanelModalOverlay {
                    TailscaleAddressPanel(
                        address: $tailscaleAddressDraft,
                        localURL: model.localWebAppURL,
                        onCancel: {
                            isTailscaleAddressPresented = false
                        },
                        onSave: { value in
                            model.setCustomTailscaleAddress(value)
                            isTailscaleAddressPresented = false
                        }
                    )
                }
            }
        }
        .frame(width: 390)
    }

    private var header: some View {
        HStack(spacing: 12) {
            LogoMark()
            VStack(alignment: .leading, spacing: 4) {
                Text("Domaeng")
                    .font(.system(size: 21, weight: .bold, design: .rounded))
                    .foregroundStyle(Theme.ink)
                StatusPill(label: model.statusLabel, color: model.statusColor)
            }
            Spacer()
            Button {
                Task { await model.refreshNow() }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(IconButtonStyle())
            .disabled(model.isWorking)
            .help("Refresh")
        }
    }

    private var statusCard: some View {
        SectionCard {
            HStack(spacing: 10) {
                MetricPill(title: "Bridge Status", value: model.bridgeSummary.capitalized, systemImage: "waveform.path.ecg")
                MetricPill(title: "PID", value: model.pidSummary, systemImage: "number.circle.fill")
            }
            if let updatedAt = model.updatedAtSummary {
                DividerLine()
                InfoRow(label: "Updated", value: updatedAt)
            }
            DividerLine()
            VersionRow(
                version: model.versionSummary,
                isWorking: model.isWorking,
                onUpdate: {
                    Task { await model.updateDomaeng() }
                }
            )
            if let error = model.visibleError {
                DividerLine()
                Text(error)
                    .font(.caption)
                    .foregroundStyle(Theme.red)
                    .lineLimit(3)
            }
        }
    }

    private var webCard: some View {
        SectionCard {
            HStack(spacing: 10) {
                SectionHeader(title: "Web App", systemImage: "globe")
                Spacer(minLength: 8)
                WebAppModeToggle(
                    selectedMode: model.webAppAccessMode,
                    isResolving: model.isResolvingTailscale,
                    onSelect: { mode in
                        Task {
                            let didSelect = await model.selectWebAppAccessMode(mode)
                            if !didSelect {
                                tailscaleAddressDraft = model.tailscaleAddress ?? ""
                                isTailscaleAddressPresented = true
                            }
                        }
                    }
                )
                .disabled(model.isWorking)
            }
            WebAppURLField(value: model.webAppURL)
            HStack(spacing: 8) {
                Button {
                    model.openWebApp()
                } label: {
                    Label("Open", systemImage: "safari")
                }
                .buttonStyle(GlassButtonStyle(variant: .primary))
                .disabled(model.webAppURL == nil)
                Button {
                    model.copyWebAppURL()
                } label: {
                    Label("Copy URL", systemImage: "doc.on.doc")
                }
                .buttonStyle(GlassButtonStyle())
                .disabled(model.webAppURL == nil)
            }
        }
    }

    private var pairingCard: some View {
        SectionCard {
            SectionHeader(title: "Pairing Code", systemImage: "qrcode.viewfinder")
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(model.pairingCode ?? "No active pairing code")
                        .font(.system(size: 22, weight: .bold, design: .monospaced))
                        .foregroundStyle(Theme.ink)
                        .textSelection(.enabled)
                        .minimumScaleFactor(0.78)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    PairingExpiryBadge(text: model.pairingExpiryText, color: model.pairingExpiryColor)
                    Button {
                        isQRCodePresented = true
                    } label: {
                        Label("Show QR Code", systemImage: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.inkSoft)
                    }
                    .buttonStyle(.plain)
                    .disabled(model.qrImage == nil)
                }
                VStack(spacing: 8) {
                    Button {
                        model.copyPairingCode()
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                    .buttonStyle(PairingActionButtonStyle(height: 38))
                    .disabled(model.pairingCode == nil)
                    Button {
                        Task { await model.run(.renewPairing) }
                    } label: {
                        Label("Renew", systemImage: "qrcode")
                    }
                    .buttonStyle(PairingActionButtonStyle(height: 38))
                    .disabled(model.isWorking)
                    Button {
                        isTrustedDevicesPresented = true
                    } label: {
                        Label("Trusted Devices", systemImage: "person.2.fill")
                    }
                    .buttonStyle(PairingActionButtonStyle(height: 38))
                }
                .frame(width: 158)
            }
        }
    }

    private var controls: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Button {
                    Task { await model.run(.start) }
                } label: {
                    Label("Start", systemImage: "play.fill")
                }
                .buttonStyle(GlassButtonStyle(variant: .primary))
                Button {
                    Task { await model.run(.stop) }
                } label: {
                    Label("Stop", systemImage: "stop.fill")
                }
                .buttonStyle(GlassButtonStyle())
                Button {
                    Task { await model.run(.restart) }
                } label: {
                    Label("Restart", systemImage: "arrow.clockwise")
                }
                .buttonStyle(GlassButtonStyle())
            }
            HStack(spacing: 8) {
                settings
                Spacer()
                Button {
                    NSApplication.shared.terminate(nil)
                } label: {
                    Image(systemName: "power")
                }
                .buttonStyle(IconButtonStyle(isDestructive: true))
            }
        }
        .disabled(model.isWorking)
    }

    private var settings: some View {
        Toggle("Open at Login", isOn: Binding(
            get: { model.openAtLoginEnabled },
            set: { enabled in
                Task { await model.setOpenAtLogin(enabled) }
            }
        ))
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(Theme.inkSoft)
        .toggleStyle(.switch)
        .tint(Theme.green)
        .disabled(model.isWorking || !model.canChangeOpenAtLogin)
    }

    private var footer: some View {
        HStack(spacing: 8) {
            if model.isWorking {
                ProgressView()
                    .controlSize(.small)
                Text("Working...")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Theme.muted)
            } else {
                Text(model.lastActionSummary)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Theme.muted)
            }
            Spacer()
        }
        .padding(.horizontal, 2)
    }
}

struct InfoRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .top) {
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.muted)
                .frame(width: 64, alignment: .leading)
            Text(value)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.inkSoft)
                .lineLimit(2)
                .textSelection(.enabled)
            Spacer(minLength: 0)
        }
    }
}

struct VersionRow: View {
    let version: String
    let isWorking: Bool
    let onUpdate: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Version")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.muted)
                Text(version)
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundStyle(Theme.inkSoft)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
                    .textSelection(.enabled)
            }
            Spacer(minLength: 8)
            Button {
                onUpdate()
            } label: {
                Label("Update", systemImage: "arrow.down.circle")
            }
            .buttonStyle(CompactActionButtonStyle(width: 88))
            .disabled(isWorking)
            .help("Update Domaeng via npm and refresh the bundled menu bar app")
        }
    }
}

struct WebAppURLField: View {
    let value: String?

    var body: some View {
        Text(value ?? "Unavailable")
            .font(.system(size: 12, weight: .medium, design: .monospaced))
            .foregroundStyle(Theme.inkSoft)
            .lineLimit(2)
            .lineSpacing(2)
            .multilineTextAlignment(.leading)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.vertical, 8)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            .background(Theme.controlBackground, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Theme.hairline, lineWidth: 1)
            )
    }
}

struct PanelModalOverlay<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        ZStack {
            Color.black.opacity(0.42)
            content
        }
    }
}

struct WebAppModeToggle: View {
    let selectedMode: WebAppAccessMode
    let isResolving: Bool
    let onSelect: (WebAppAccessMode) -> Void

    var body: some View {
        HStack(spacing: 2) {
            segment(.local)
            segment(.tailscale)
        }
        .padding(3)
        .background(Theme.controlBackground, in: Capsule())
        .overlay(Capsule().stroke(Theme.hairline, lineWidth: 1))
    }

    private func segment(_ mode: WebAppAccessMode) -> some View {
        Button {
            onSelect(mode)
        } label: {
            HStack(spacing: 4) {
                if mode == .tailscale && isResolving {
                    ProgressView()
                        .controlSize(.mini)
                }
                Text(mode.title)
                    .font(.system(size: 10, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
            }
            .foregroundStyle(selectedMode == mode ? Theme.primaryButtonInk : Theme.inkSoft)
            .padding(.vertical, 5)
            .padding(.horizontal, 8)
            .frame(minWidth: 52)
            .background(selectedMode == mode ? Theme.green : Color.clear, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(mode == .tailscale && isResolving)
    }
}

struct QRCodePanel: View {
    let image: NSImage?
    let onClose: () -> Void

    var body: some View {
        ModalCard(width: 300) {
            HStack {
                SectionHeader(title: "QR Code", systemImage: "qrcode")
                Spacer()
                Button {
                    onClose()
                } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(IconButtonStyle())
            }
            if let image {
                Image(nsImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 220, height: 220)
                    .padding(12)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .frame(maxWidth: .infinity)
            } else {
                Text("No active QR")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, minHeight: 120, alignment: .center)
            }
        }
    }
}

struct TrustedDevicesPanel: View {
    @ObservedObject var model: DomaengMenuBarModel
    let onClose: () -> Void

    var body: some View {
        ModalCard(width: 354) {
            HStack {
                SectionHeader(title: "Trusted Devices", systemImage: "person.2.fill")
                Spacer()
                Button {
                    onClose()
                } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(IconButtonStyle())
            }
            Text(model.trustedDevicesSummary)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.muted)
            if model.trustedDevices.isEmpty {
                Text("No trusted devices yet.")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.inkSoft)
                    .frame(maxWidth: .infinity, minHeight: 72, alignment: .center)
                    .background(Theme.controlBackground, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(Theme.hairline, lineWidth: 1)
                    )
            } else {
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(model.trustedDevices) { device in
                            TrustedDeviceRow(
                                device: device,
                                isWorking: model.isWorking,
                                onToggle: {
                                    Task { await model.updateTrustedDevice(device, action: device.isDisabled ? .enable : .disable) }
                                },
                                onRemove: {
                                    Task { await model.updateTrustedDevice(device, action: .revoke) }
                                }
                            )
                        }
                    }
                }
                .frame(maxHeight: 340)
            }
            if let error = model.visibleError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(Theme.red)
                    .lineLimit(3)
            }
        }
    }
}

struct TrustedDeviceRow: View {
    let device: TrustedDevice
    let isWorking: Bool
    let onToggle: () -> Void
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(device.isDisabled ? Theme.muted : Theme.green)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 3) {
                Text(device.displayName)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text("\(device.fingerprint) · \(device.status.capitalized)")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(device.isDisabled ? Theme.muted : Theme.inkSoft)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            Button(device.isDisabled ? "Enable" : "Disable") {
                onToggle()
            }
            .buttonStyle(CompactActionButtonStyle())
            .disabled(isWorking)
            Button("Remove") {
                onRemove()
            }
            .buttonStyle(CompactActionButtonStyle(variant: .destructive))
            .disabled(isWorking)
        }
        .padding(.vertical, 9)
        .padding(.horizontal, 10)
        .background(Theme.controlBackground, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Theme.hairline, lineWidth: 1)
        )
    }
}

struct TailscaleAddressPanel: View {
    @Binding var address: String
    let localURL: String?
    let onCancel: () -> Void
    let onSave: (String) -> Void

    var body: some View {
        ModalCard(width: 340) {
            SectionHeader(title: "Tailscale Address", systemImage: "network")
            Text("Enter this Mac's Tailscale IP or MagicDNS name.")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.muted)
            TextField("100.x.x.x or mac.tailnet.ts.net", text: $address)
                .textFieldStyle(.plain)
                .font(.system(size: 13, weight: .medium, design: .monospaced))
                .foregroundStyle(Theme.inkSoft)
                .padding(.vertical, 9)
                .padding(.horizontal, 10)
                .background(Theme.controlBackground, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(Theme.hairline, lineWidth: 1)
                )
            if let preview = webAppURLForTailscaleAddress(address, localURL: localURL) {
                InfoRow(label: "Preview", value: preview)
            }
            HStack(spacing: 8) {
                Button("Cancel") {
                    onCancel()
                }
                .buttonStyle(GlassButtonStyle())
                Button("Use Address") {
                    onSave(address)
                }
                .buttonStyle(GlassButtonStyle(variant: .primary))
                .disabled(webAppURLForTailscaleAddress(address, localURL: localURL) == nil)
            }
        }
    }
}

struct ModalCard<Content: View>: View {
    let width: CGFloat
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            content
        }
        .padding(16)
        .frame(width: width)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Theme.backgroundBottom.opacity(0.96))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(Theme.cardBorder, lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.28), radius: 22, x: 0, y: 14)
    }
}

struct PairingExpiryBadge: View {
    let text: String
    let color: Color

    var body: some View {
        HStack(spacing: 7) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text(text)
                .font(.system(size: 12, weight: .semibold))
                .lineLimit(1)
        }
        .foregroundStyle(color)
        .padding(.vertical, 7)
        .padding(.horizontal, 10)
        .background(color.opacity(0.12), in: Capsule())
        .overlay(Capsule().stroke(color.opacity(0.22), lineWidth: 1))
    }
}

struct PanelBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Theme.backgroundTop,
                    Theme.backgroundBottom
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            RadialGradient(
                colors: [
                    Theme.greenGlow,
                    Color.clear
                ],
                center: .topTrailing,
                startRadius: 12,
                endRadius: 260
            )
            RadialGradient(
                colors: [
                    Theme.coolGlow,
                    Color.clear
                ],
                center: .bottomLeading,
                startRadius: 30,
                endRadius: 260
            )
        }
        .ignoresSafeArea()
    }
}

struct MenuBarLogoLabel: View {
    var body: some View {
        Image(nsImage: DomaengAssets.menuBarIconImage())
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: 16, height: 16)
            .accessibilityLabel("Domaeng")
            .help("Domaeng")
    }
}

struct LogoMark: View {
    var body: some View {
        Image(nsImage: DomaengAssets.logoImage())
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .frame(width: 52, height: 52)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: Theme.logoShadow, radius: 18, x: 0, y: 10)
    }
}

struct StatusPill: View {
    let label: String
    let color: Color

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text(label)
                .font(.system(size: 12, weight: .medium))
        }
        .foregroundStyle(color)
        .padding(.vertical, 3)
        .padding(.horizontal, 0)
    }
}

struct SectionCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            content
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Theme.cardBackground)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Theme.cardBorder, lineWidth: 1)
        )
        .shadow(color: Theme.cardShadow, radius: 22, x: 0, y: 16)
    }
}

struct SectionHeader: View {
    let title: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.green)
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.ink)
        }
    }
}

struct MetricPill: View {
    let title: String
    let value: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Theme.green)
                .frame(width: 24, height: 24)
                .background(Theme.green.opacity(0.18), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.muted)
                Text(value)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.inkSoft)
                    .lineLimit(1)
                    .minimumScaleFactor(0.76)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 11)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, minHeight: 58)
        .background(Theme.controlBackground, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Theme.hairline, lineWidth: 1)
        )
    }
}

struct DividerLine: View {
    var body: some View {
        Rectangle()
            .fill(Theme.hairline)
            .frame(height: 1)
    }
}

struct GlassButtonStyle: ButtonStyle {
    enum Variant {
        case normal
        case primary
        case destructive
    }

    var variant: Variant = .normal

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .bold))
            .lineLimit(1)
            .labelStyle(.titleAndIcon)
            .foregroundStyle(foreground)
            .padding(.vertical, 9)
            .padding(.horizontal, 12)
            .frame(minHeight: 38)
            .frame(maxWidth: .infinity)
            .background(background(isPressed: configuration.isPressed), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(stroke, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }

    private var foreground: Color {
        switch variant {
        case .primary:
            return Theme.primaryButtonInk
        case .destructive:
            return Theme.red
        case .normal:
            return Theme.ink
        }
    }

    private var stroke: Color {
        switch variant {
        case .primary:
            return Theme.green.opacity(0.34)
        case .destructive:
            return Theme.red.opacity(0.28)
        case .normal:
            return Theme.hairline
        }
    }

    private func background(isPressed: Bool) -> LinearGradient {
        if variant == .primary {
            return LinearGradient(
                colors: [
                    Theme.primaryButtonTop.opacity(isPressed ? 0.82 : 1.0),
                    Theme.primaryButtonBottom.opacity(isPressed ? 0.82 : 1.0)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }

        if variant == .destructive {
            return LinearGradient(
                colors: [
                    Theme.red.opacity(isPressed ? 0.16 : 0.12),
                    Theme.red.opacity(isPressed ? 0.08 : 0.06)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }

        return LinearGradient(
            colors: [
                Color.white.opacity(isPressed ? 0.12 : 0.16),
                Color.white.opacity(isPressed ? 0.05 : 0.08)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

struct PairingActionButtonStyle: ButtonStyle {
    var width: CGFloat = 158
    var height: CGFloat = 44

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .bold))
            .lineLimit(1)
            .minimumScaleFactor(0.82)
            .labelStyle(.titleAndIcon)
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 12)
            .frame(width: width, height: height)
            .background(Theme.controlBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Theme.hairline, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
    }
}

struct CompactActionButtonStyle: ButtonStyle {
    enum Variant {
        case normal
        case destructive
    }

    var variant: Variant = .normal
    var width: CGFloat = 68

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 11, weight: .bold))
            .lineLimit(1)
            .minimumScaleFactor(0.82)
            .foregroundStyle(variant == .destructive ? Theme.red : Theme.ink)
            .padding(.horizontal, 8)
            .frame(width: width, height: 30)
            .background(background(isPressed: configuration.isPressed), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(variant == .destructive ? Theme.red.opacity(0.28) : Theme.hairline, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
    }

    private func background(isPressed: Bool) -> LinearGradient {
        if variant == .destructive {
            return LinearGradient(
                colors: [
                    Theme.red.opacity(isPressed ? 0.16 : 0.12),
                    Theme.red.opacity(isPressed ? 0.08 : 0.06)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }

        return LinearGradient(
            colors: [
                Color.white.opacity(isPressed ? 0.12 : 0.16),
                Color.white.opacity(isPressed ? 0.05 : 0.08)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

struct IconButtonStyle: ButtonStyle {
    var isDestructive = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(isDestructive ? Theme.red : Theme.ink)
            .frame(width: 42, height: 38)
            .background(Theme.controlBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(isDestructive ? Theme.red.opacity(0.26) : Theme.hairline, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
    }
}

enum Theme {
    static let ink = Color.adaptive(light: 0x11211E, dark: 0xF4FAF6)
    static let inkSoft = Color.adaptive(light: 0x263D3B, dark: 0xDBE6E1)
    static let muted = Color.adaptive(light: 0x6B8783, dark: 0x9AA8A4)
    static let green = Color.adaptive(light: 0x3CB878, dark: 0x5ED29A)
    static let greenDeep = Color.adaptive(light: 0x15865A, dark: 0x2DAF72)
    static let amber = Color.adaptive(light: 0x9B6800, dark: 0xF0BD67)
    static let red = Color.adaptive(light: 0xD84E43, dark: 0xFF7B73)
    static let hairline = Color.adaptive(light: 0xDDE8E4, dark: 0x304241).opacity(0.92)
    static let cardBorder = Color.adaptive(light: 0xDFEAE6, dark: 0x354A49).opacity(0.92)
    static let backgroundTop = Color.adaptive(light: 0xFBFEFC, dark: 0x061011)
    static let backgroundBottom = Color.adaptive(light: 0xF0F6F3, dark: 0x0D1A1A)
    static let greenGlow = Color.adaptive(light: 0xB8F3D2, dark: 0x2DAF72).opacity(0.26)
    static let coolGlow = Color.adaptive(light: 0xDDEBEA, dark: 0x4B7774).opacity(0.18)
    static let logoShadow = Color.adaptive(light: 0x70C79B, dark: 0x2DAF72).opacity(0.26)
    static let cardShadow = Color.adaptive(light: 0x17362E, dark: 0x000000).opacity(0.10)
    static let primaryButtonInk = Color.adaptive(light: 0x10211D, dark: 0x07140E)
    static let primaryButtonTop = Color.adaptive(light: 0xCFF8E2, dark: 0x77DFA4)
    static let primaryButtonBottom = Color.adaptive(light: 0xEAF8F0, dark: 0x48BC78)

    static var cardBackground: LinearGradient {
        LinearGradient(
            colors: [
                Color.adaptive(light: 0xFFFFFF, dark: 0xFFFFFF).opacity(Color.isEffectiveDarkAppearance ? 0.075 : 0.72),
                Color.adaptive(light: 0xF8FCFA, dark: 0xFFFFFF).opacity(Color.isEffectiveDarkAppearance ? 0.025 : 0.34)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    static var controlBackground: LinearGradient {
        LinearGradient(
            colors: [
                Color.adaptive(light: 0xFFFFFF, dark: 0xFFFFFF).opacity(Color.isEffectiveDarkAppearance ? 0.095 : 0.58),
                Color.adaptive(light: 0xF6FAF8, dark: 0xFFFFFF).opacity(Color.isEffectiveDarkAppearance ? 0.035 : 0.24)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

enum DomaengAssets {
    static func menuBarIconImage() -> NSImage {
        let size = NSSize(width: 18, height: 18)
        let image = NSImage(size: size)
        image.lockFocus()
        NSColor.black.setFill()
        menuBarIconPath(in: NSRect(origin: .zero, size: size)).fill()

        image.unlockFocus()
        image.isTemplate = true
        return image
    }

    private static func menuBarIconPath(in rect: NSRect) -> NSBezierPath {
        let sourceWidth: CGFloat = 98
        let sourceHeight: CGFloat = 96
        let scale = min(rect.width / sourceWidth, rect.height / sourceHeight)
        let offsetX = rect.minX + (rect.width - sourceWidth * scale) / 2
        let offsetY = rect.minY + (rect.height - sourceHeight * scale) / 2
        func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
            NSPoint(x: offsetX + x * scale, y: offsetY + (sourceHeight - y) * scale)
        }

        let path = NSBezierPath()
        path.windingRule = .evenOdd

        path.move(to: point(47, 68))
        path.line(to: point(47, 70))
        path.line(to: point(57, 70))
        path.line(to: point(57, 68))
        path.close()

        path.move(to: point(33, 53))
        path.line(to: point(32, 55))
        path.line(to: point(41, 61))
        path.line(to: point(32, 68))
        path.line(to: point(32, 69))
        path.line(to: point(34, 70))
        path.line(to: point(44, 64))
        path.line(to: point(46, 61))
        path.line(to: point(38, 55))
        path.close()

        path.move(to: point(10, 8))
        path.line(to: point(9, 9))
        path.line(to: point(9, 90))
        path.line(to: point(11, 90))
        path.line(to: point(26, 74))
        path.line(to: point(26, 26))
        path.line(to: point(28, 24))
        path.line(to: point(52, 24))
        path.line(to: point(62, 27))
        path.line(to: point(71, 35))
        path.line(to: point(74, 41))
        path.line(to: point(74, 44))
        path.line(to: point(75, 45))
        path.line(to: point(75, 55))
        path.line(to: point(71, 65))
        path.line(to: point(64, 72))
        path.line(to: point(54, 76))
        path.line(to: point(33, 76))
        path.line(to: point(23, 86))
        path.line(to: point(18, 93))
        path.line(to: point(55, 93))
        path.line(to: point(69, 89))
        path.line(to: point(77, 84))
        path.line(to: point(83, 78))
        path.line(to: point(88, 70))
        path.line(to: point(91, 61))
        path.line(to: point(91, 54))
        path.line(to: point(92, 53))
        path.line(to: point(91, 41))
        path.line(to: point(88, 32))
        path.line(to: point(84, 25))
        path.line(to: point(71, 13))
        path.line(to: point(57, 8))
        path.close()

        return path
    }

    static func logoImage() -> NSImage {
        if let url = Bundle.main.url(forResource: "DomaengIcon", withExtension: "png"),
           let image = NSImage(contentsOf: url) {
            return image
        }
        return NSImage(systemSymbolName: "paperplane.fill", accessibilityDescription: "Domaeng")
            ?? NSImage(size: NSSize(width: 32, height: 32))
    }
}

extension Color {
    static func adaptive(light: UInt32, dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            return NSColor(hex: isDark ? dark : light)
        })
    }

    static var isEffectiveDarkAppearance: Bool {
        NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    }
}

extension NSColor {
    convenience init(hex: UInt32) {
        let red = CGFloat((hex >> 16) & 0xff) / 255.0
        let green = CGFloat((hex >> 8) & 0xff) / 255.0
        let blue = CGFloat(hex & 0xff) / 255.0
        self.init(red: red, green: green, blue: blue, alpha: 1)
    }
}

@MainActor
final class DomaengMenuBarModel: ObservableObject {
    @Published private(set) var status: DomaengStatus?
    @Published private(set) var menuBarStatus: MenuBarStatus?
    @Published private(set) var isWorking = false
    @Published private(set) var isResolvingTailscale = false
    @Published private(set) var webAppAccessMode: WebAppAccessMode
    @Published private(set) var tailscaleAddress: String?
    @Published private(set) var actionMessage = "Ready"
    @Published private(set) var commandError: String?

    private let cli = DomaengCLI()
    private let defaults = UserDefaults.standard
    private var isRefreshing = false
    private var pollingTask: Task<Void, Never>?

    init() {
        webAppAccessMode = WebAppAccessMode(
            rawValue: UserDefaults.standard.string(forKey: Self.webAppAccessModeDefaultsKey) ?? ""
        ) ?? .local
        tailscaleAddress = normalizedString(UserDefaults.standard.string(forKey: Self.tailscaleAddressDefaultsKey))
        pollingTask = Task { [weak self] in
            await self?.startPolling()
        }
    }

    deinit {
        pollingTask?.cancel()
    }

    var menuBarSystemImage: String {
        switch serviceState {
        case .connected:
            return "paperplane.circle.fill"
        case .starting:
            return "clock.circle"
        case .error:
            return "exclamationmark.triangle"
        case .stopped:
            return "paperplane.circle"
        }
    }

    var statusLabel: String {
        switch serviceState {
        case .connected:
            return "Connected"
        case .starting:
            return "Starting"
        case .error:
            return "Needs attention"
        case .stopped:
            return "Stopped"
        }
    }

    var statusColor: Color {
        switch serviceState {
        case .connected:
            return .green
        case .starting:
            return .orange
        case .error:
            return .red
        case .stopped:
            return .secondary
        }
    }

    var bridgeSummary: String {
        let state = status?.bridgeStatus?.state ?? "unknown"
        let connection = status?.bridgeStatus?.connectionStatus ?? "unknown"
        return "\(state) / \(connection)"
    }

    var relaySummary: String {
        status?.daemonConfig?.relayUrl ?? "not configured"
    }

    var pidSummary: String {
        if let launchdPid = status?.launchdPid {
            return String(launchdPid)
        }
        if let bridgePid = status?.bridgeStatus?.pid {
            return String(bridgePid)
        }
        return "unknown"
    }

    var updatedAtSummary: String? {
        formatDate(status?.bridgeStatus?.updatedAt)
    }

    var versionSummary: String {
        normalizedString(status?.currentVersion)
            ?? bundleVersionSummary
            ?? "unknown"
    }

    var visibleError: String? {
        if let commandError {
            return commandError
        }
        if status?.bridgeStatus?.connectionStatus == "connected" {
            return nil
        }
        return status?.bridgeStatus?.lastError
    }

    var localWebAppURL: String? {
        webAppURLFromRelayURL(status?.daemonConfig?.relayUrl ?? status?.pairingSession?.relay)
    }

    var webAppURL: String? {
        switch webAppAccessMode {
        case .local:
            return localWebAppURL
        case .tailscale:
            return webAppURLForTailscaleAddress(tailscaleAddress, localURL: localWebAppURL)
        }
    }

    var pairingCode: String? {
        normalizedString(status?.pairingSession?.pairingCode)
    }

    var pairingExpiresAt: String? {
        guard let date = pairingExpirationDate else {
            return nil
        }
        return DateFormatter.localizedString(from: date, dateStyle: .none, timeStyle: .short)
    }

    var pairingExpiryText: String {
        guard let expiresAt = pairingExpiresAt else {
            return "No active expiry"
        }
        if pairingExpired {
            return "Expired"
        }
        return "Expires \(expiresAt)"
    }

    var pairingExpiryColor: Color {
        pairingExpired ? Theme.red : Theme.muted
    }

    private var pairingExpired: Bool {
        guard let date = pairingExpirationDate else {
            return false
        }
        return date <= Date()
    }

    private var pairingExpirationDate: Date? {
        guard let milliseconds = status?.pairingSession?.expiresAt else {
            return nil
        }
        return Date(timeIntervalSince1970: milliseconds / 1000)
    }

    var qrImage: NSImage? {
        guard let payload = status?.pairingSession?.pairingPayloadJSONString else {
            return nil
        }
        return makeQRCodeImage(from: payload)
    }

    var lastActionSummary: String {
        actionMessage
    }

    var openAtLoginEnabled: Bool {
        menuBarStatus?.openAtLogin ?? menuBarStatus?.autoOpenEnabled ?? false
    }

    var canChangeOpenAtLogin: Bool {
        menuBarStatus?.installed == true || menuBarStatus?.bundled == true
    }

    var trustedDevices: [TrustedDevice] {
        status?.trustedDevices ?? []
    }

    var trustedDevicesSummary: String {
        let total = trustedDevices.count
        let enabled = trustedDevices.filter { !$0.isDisabled }.count
        if total == 0 {
            return "No trusted browsers or devices are saved on this Mac."
        }
        if total == 1 {
            return enabled == 1 ? "1 trusted device can reconnect." : "1 trusted device is disabled."
        }
        return "\(total) trusted devices; \(enabled) can reconnect."
    }

    private func startPolling() async {
        while !Task.isCancelled {
            await refreshNow()
            try? await Task.sleep(nanoseconds: 1_500_000_000)
        }
    }

    func refreshNow() async {
        if isRefreshing {
            return
        }
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            let output = try await cli.run(["status", "--json"])
            let decoded = try JSONDecoder().decode(DomaengStatus.self, from: Data(output.utf8))
            status = decoded
            await refreshMenuBarStatus()
            commandError = nil
            actionMessage = "Updated \(DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .short))"
        } catch {
            commandError = error.localizedDescription
        }
    }

    func run(_ action: DomaengAction) async {
        isWorking = true
        commandError = nil
        defer { isWorking = false }

        do {
            _ = try await cli.run(action.arguments)
            actionMessage = action.successMessage
            await refreshNow()
        } catch {
            commandError = error.localizedDescription
        }
    }

    func updateDomaeng() async {
        isWorking = true
        commandError = nil
        defer { isWorking = false }

        do {
            let output = try await cli.run(["update", "--json"])
            let result = try? JSONDecoder().decode(DomaengUpdateResult.self, from: Data(output.utf8))
            let nextActionMessage: String
            let warningMessage: String?
            if result?.menuBar?.ok == false, let error = result?.menuBar?.error {
                nextActionMessage = "Updated; menu bar refresh warning"
                warningMessage = error
            } else if result?.restartRecommended == true {
                nextActionMessage = "Updated; restart recommended"
                warningMessage = nil
            } else {
                nextActionMessage = "Updated"
                warningMessage = nil
            }
            await refreshNow()
            actionMessage = nextActionMessage
            if let warningMessage {
                commandError = warningMessage
            }
        } catch {
            commandError = error.localizedDescription
        }
    }

    func openWebApp() {
        guard let value = webAppURL, let url = URL(string: value) else {
            return
        }
        NSWorkspace.shared.open(url)
    }

    func copyWebAppURL() {
        guard let webAppURL else {
            return
        }
        copyToPasteboard(webAppURL)
        actionMessage = "Copied Web App URL"
    }

    func copyPairingCode() {
        guard let pairingCode else {
            return
        }
        copyToPasteboard(pairingCode)
        actionMessage = "Copied pairing code"
    }

    func selectWebAppAccessMode(_ mode: WebAppAccessMode) async -> Bool {
        if mode == .local {
            webAppAccessMode = .local
            defaults.set(mode.rawValue, forKey: Self.webAppAccessModeDefaultsKey)
            actionMessage = "Using local URL"
            return true
        }

        if webAppURLForTailscaleAddress(tailscaleAddress, localURL: localWebAppURL) != nil {
            webAppAccessMode = .tailscale
            defaults.set(mode.rawValue, forKey: Self.webAppAccessModeDefaultsKey)
            actionMessage = "Using Tailscale URL"
            return true
        }

        isResolvingTailscale = true
        defer { isResolvingTailscale = false }

        if let resolvedAddress = await TailscaleAddressResolver.resolveAddress() {
            tailscaleAddress = resolvedAddress
            defaults.set(resolvedAddress, forKey: Self.tailscaleAddressDefaultsKey)
            webAppAccessMode = .tailscale
            defaults.set(mode.rawValue, forKey: Self.webAppAccessModeDefaultsKey)
            actionMessage = "Using Tailscale URL"
            return true
        }

        actionMessage = "Tailscale address needed"
        return false
    }

    func setCustomTailscaleAddress(_ value: String) {
        guard let normalizedAddress = normalizeTailscaleAddress(value),
              webAppURLForTailscaleAddress(normalizedAddress, localURL: localWebAppURL) != nil else {
            actionMessage = "Tailscale address needed"
            return
        }

        tailscaleAddress = normalizedAddress
        webAppAccessMode = .tailscale
        defaults.set(normalizedAddress, forKey: Self.tailscaleAddressDefaultsKey)
        defaults.set(WebAppAccessMode.tailscale.rawValue, forKey: Self.webAppAccessModeDefaultsKey)
        actionMessage = "Using Tailscale URL"
    }

    func updateTrustedDevice(_ device: TrustedDevice, action: TrustedDeviceAction) async {
        isWorking = true
        commandError = nil
        defer { isWorking = false }

        do {
            _ = try await cli.run(["trusted-device", action.rawValue, device.id, "--json"])
            actionMessage = action.successMessage
            await refreshNow()
        } catch {
            commandError = error.localizedDescription
        }
    }

    func setOpenAtLogin(_ enabled: Bool) async {
        isWorking = true
        commandError = nil
        defer { isWorking = false }

        do {
            _ = try await cli.run(["menubar", "login", enabled ? "on" : "off", "--json"])
            actionMessage = enabled ? "Open at Login enabled" : "Open at Login disabled"
            await refreshMenuBarStatus()
        } catch {
            commandError = error.localizedDescription
        }
    }

    private var serviceState: ServiceState {
        if status?.bridgeStatus?.connectionStatus == "connected" {
            return .connected
        }
        if status?.bridgeStatus?.lastError != nil || status?.bridgeStatus?.connectionStatus == "error" {
            return .error
        }
        if status?.launchdLoaded == true {
            return .starting
        }
        return .stopped
    }

    private func refreshMenuBarStatus() async {
        do {
            let output = try await cli.run(["menubar", "status", "--json"])
            menuBarStatus = try JSONDecoder().decode(MenuBarStatus.self, from: Data(output.utf8))
        } catch {
            menuBarStatus = nil
        }
    }

    private var bundleVersionSummary: String? {
        normalizedString(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)
    }

    private static let webAppAccessModeDefaultsKey = "DomaengMenuBar.webAppAccessMode"
    private static let tailscaleAddressDefaultsKey = "DomaengMenuBar.tailscaleAddress"
}

enum WebAppAccessMode: String {
    case local
    case tailscale

    var title: String {
        switch self {
        case .local:
            return "Local"
        case .tailscale:
            return "Tailscale"
        }
    }
}

enum DomaengAction {
    case start
    case stop
    case restart
    case renewPairing

    var arguments: [String] {
        switch self {
        case .start:
            return ["start", "--json"]
        case .stop:
            return ["stop", "--json"]
        case .restart:
            return ["restart", "--json"]
        case .renewPairing:
            return ["renew-pairing", "--json"]
        }
    }

    var successMessage: String {
        switch self {
        case .start:
            return "Started"
        case .stop:
            return "Stopped"
        case .restart:
            return "Restarted"
        case .renewPairing:
            return "Pairing renewed"
        }
    }

}

enum TrustedDeviceAction: String {
    case enable
    case disable
    case revoke

    var successMessage: String {
        switch self {
        case .enable:
            return "Trusted device enabled"
        case .disable:
            return "Trusted device disabled"
        case .revoke:
            return "Trusted device removed"
        }
    }
}

enum ServiceState {
    case connected
    case starting
    case stopped
    case error
}

struct DomaengStatus: Decodable {
    let currentVersion: String?
    let launchdLoaded: Bool?
    let launchdPid: Int?
    let daemonConfig: DaemonConfig?
    let bridgeStatus: BridgeStatus?
    let pairingSession: PairingSession?
    let trustedDevices: [TrustedDevice]?
}

struct MenuBarStatus: Decodable {
    let bundled: Bool?
    let installed: Bool?
    let openAtLogin: Bool?
    let autoOpenEnabled: Bool?
}

struct DomaengUpdateResult: Decodable {
    let restartRecommended: Bool?
    let menuBar: DomaengUpdateMenuBarResult?
}

struct DomaengUpdateMenuBarResult: Decodable {
    let ok: Bool?
    let error: String?
}

struct DaemonConfig: Decodable {
    let relayUrl: String?
}

struct BridgeStatus: Decodable {
    let state: String?
    let connectionStatus: String?
    let pid: Int?
    let lastError: String?
    let updatedAt: String?
}

struct TrustedDevice: Decodable, Identifiable {
    let id: String
    let displayName: String
    let kind: String?
    let fingerprint: String
    let trustedAt: String?
    let lastSeenAt: String?
    let disabledAt: String?
    let status: String

    var isDisabled: Bool {
        status == "disabled" || disabledAt != nil
    }

    var lastSeenSummary: String? {
        formatDate(lastSeenAt)
    }
}

struct PairingSession: Decodable {
    let createdAt: String?
    let pairingCode: String?
    let pairingPayload: JSONValue?

    var relay: String? {
        pairingPayload?.stringValue(for: "relay")
    }

    var expiresAt: Double? {
        pairingPayload?.numberValue(for: "expiresAt")
    }

    var pairingPayloadJSONString: String? {
        guard let pairingPayload else {
            return nil
        }
        guard let data = try? JSONEncoder().encode(pairingPayload) else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }
}

enum JSONValue: Codable {
    case string(String)
    case number(Double)
    case object([String: JSONValue])
    case array([JSONValue])
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }

    func stringValue(for key: String) -> String? {
        guard case .object(let values) = self, case .string(let value)? = values[key] else {
            return nil
        }
        return normalizedString(value)
    }

    func numberValue(for key: String) -> Double? {
        guard case .object(let values) = self else {
            return nil
        }
        if case .number(let value)? = values[key] {
            return value
        }
        return nil
    }
}

struct DomaengCLI {
    private let executablePath: String

    init() {
        executablePath = Self.resolveExecutablePath()
    }

    func run(_ args: [String]) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let process = Process()
                    let stdout = Pipe()
                    let stderr = Pipe()
                    if executablePath == "/usr/bin/env" {
                        process.executableURL = URL(fileURLWithPath: executablePath)
                        process.arguments = ["domaeng"] + args
                    } else {
                        process.executableURL = URL(fileURLWithPath: executablePath)
                        process.arguments = args
                    }
                    process.environment = Self.commandEnvironment()
                    process.standardOutput = stdout
                    process.standardError = stderr
                    try process.run()
                    process.waitUntilExit()

                    let stdoutText = String(data: stdout.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                    let stderrText = String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                    if process.terminationStatus == 0 {
                        continuation.resume(returning: stdoutText)
                    } else {
                        let message = normalizedString(stderrText) ?? normalizedString(stdoutText) ?? "domaeng exited with code \(process.terminationStatus)"
                        continuation.resume(throwing: DomaengCLIError(message: message))
                    }
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private static func resolveExecutablePath() -> String {
        let env = ProcessInfo.processInfo.environment
        let candidates = [
            env["DOMAENG_CLI_PATH"],
            "/opt/homebrew/bin/domaeng",
            "/usr/local/bin/domaeng",
            "/usr/bin/domaeng"
        ].compactMap { $0 }

        for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
            return candidate
        }
        return "/usr/bin/env"
    }

    private static func commandEnvironment() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        let existingPath = env["PATH"] ?? ""
        env["PATH"] = [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            existingPath
        ].filter { !$0.isEmpty }.joined(separator: ":")
        return env
    }
}

struct DomaengCLIError: LocalizedError {
    let message: String

    var errorDescription: String? {
        message
    }
}

func webAppURLFromRelayURL(_ value: String?) -> String? {
    guard let value = normalizedString(value), var components = URLComponents(string: value) else {
        return nil
    }

    if components.scheme == "ws" {
        components.scheme = "http"
    } else if components.scheme == "wss" {
        components.scheme = "https"
    } else if components.scheme != "http" && components.scheme != "https" {
        return nil
    }

    var parts = components.path.split(separator: "/").map(String.init)
    if parts.last == "relay" {
        parts.removeLast()
    }
    if parts.last != "app" {
        parts.append("app")
    }
    components.path = "/" + parts.joined(separator: "/") + "/"
    components.query = nil
    components.fragment = nil
    return components.url?.absoluteString
}

func webAppURLForTailscaleAddress(_ address: String?, localURL: String?) -> String? {
    guard let address = normalizeTailscaleAddress(address) else {
        return nil
    }

    if address.contains("://") {
        return webAppURLFromRelayURL(address)
    }

    var localComponents = URLComponents(string: localURL ?? "http://127.0.0.1:9000/app/")
        ?? URLComponents()
    let addressComponents = URLComponents(string: "http://\(address)")
    guard let host = normalizedString(addressComponents?.host) else {
        return nil
    }

    localComponents.scheme = localComponents.scheme ?? "http"
    localComponents.host = host
    if let port = addressComponents?.port {
        localComponents.port = port
    } else if localComponents.port == nil && localComponents.scheme == "http" {
        localComponents.port = 9000
    }
    localComponents.path = "/app/"
    localComponents.query = nil
    localComponents.fragment = nil
    return localComponents.url?.absoluteString
}

func normalizeTailscaleAddress(_ value: String?) -> String? {
    guard var value = normalizedString(value) else {
        return nil
    }
    while value.hasSuffix("/") {
        value.removeLast()
    }
    while value.hasSuffix(".") && !value.contains("://") {
        value.removeLast()
    }
    return value.isEmpty ? nil : value
}

struct TailscaleAddressResolver {
    static func resolveAddress() async -> String? {
        await Task.detached(priority: .userInitiated) {
            for candidate in commandCandidates() {
                if let statusJSON = run(candidate, arguments: ["status", "--json"]),
                   let address = addressFromStatusJSON(statusJSON) {
                    return address
                }
                if let ipOutput = run(candidate, arguments: ["ip", "-4"]),
                   let address = addressFromIPOutput(ipOutput) {
                    return address
                }
            }
            return nil
        }.value
    }

    private static func commandCandidates() -> [CommandCandidate] {
        [
            CommandCandidate(executable: "/opt/homebrew/bin/tailscale"),
            CommandCandidate(executable: "/usr/local/bin/tailscale"),
            CommandCandidate(executable: "/Applications/Tailscale.app/Contents/MacOS/Tailscale"),
            CommandCandidate(executable: "/usr/bin/env", prefixArguments: ["tailscale"])
        ].filter { candidate in
            candidate.executable == "/usr/bin/env"
                || FileManager.default.isExecutableFile(atPath: candidate.executable)
        }
    }

    private static func run(_ candidate: CommandCandidate, arguments: [String]) -> String? {
        let process = Process()
        let stdout = Pipe()
        let stderr = Pipe()
        process.executableURL = URL(fileURLWithPath: candidate.executable)
        process.arguments = candidate.prefixArguments + arguments
        process.standardOutput = stdout
        process.standardError = stderr

        let group = DispatchGroup()
        group.enter()
        process.terminationHandler = { _ in
            group.leave()
        }

        do {
            try process.run()
        } catch {
            return nil
        }

        if group.wait(timeout: .now() + 2.0) == .timedOut {
            process.terminate()
            return nil
        }

        guard process.terminationStatus == 0 else {
            return nil
        }

        return String(data: stdout.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)
    }

    private static func addressFromStatusJSON(_ value: String) -> String? {
        guard let data = value.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let selfNode = root["Self"] as? [String: Any] else {
            return nil
        }

        if let dnsName = normalizeTailscaleAddress(selfNode["DNSName"] as? String) {
            return dnsName
        }

        if let tailscaleIPs = selfNode["TailscaleIPs"] as? [String] {
            return tailscaleIPs.first(where: { $0.contains(".") })
                ?? tailscaleIPs.first.flatMap(normalizeTailscaleAddress)
        }

        return normalizeTailscaleAddress(selfNode["TailscaleIP"] as? String)
    }

    private static func addressFromIPOutput(_ value: String) -> String? {
        value
            .split(whereSeparator: \.isNewline)
            .map(String.init)
            .compactMap(normalizeTailscaleAddress)
            .first(where: { $0.contains(".") })
    }
}

struct CommandCandidate {
    let executable: String
    var prefixArguments: [String] = []
}

func makeQRCodeImage(from value: String) -> NSImage? {
    let filter = CIFilter.qrCodeGenerator()
    filter.message = Data(value.utf8)
    filter.correctionLevel = "M"
    guard let output = filter.outputImage else {
        return nil
    }

    let transformed = output.transformed(by: CGAffineTransform(scaleX: 8, y: 8))
    let representation = NSCIImageRep(ciImage: transformed)
    let image = NSImage(size: representation.size)
    image.addRepresentation(representation)
    return image
}

func copyToPasteboard(_ value: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(value, forType: .string)
}

func normalizedString(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
        return nil
    }
    return trimmed
}

func formatDate(_ value: String?) -> String? {
    guard let value, let date = ISO8601DateFormatter().date(from: value) else {
        return nil
    }
    return DateFormatter.localizedString(from: date, dateStyle: .none, timeStyle: .medium)
}
