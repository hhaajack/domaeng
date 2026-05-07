// FILE: RemodexMenuBarApp.swift
// Purpose: Entry point for the macOS companion that turns the existing bridge CLI into a menu bar control center.
// Layer: Companion app
// Exports: RemodexMenuBarApp
// Depends on: SwiftUI, BridgeMenuBarStore, BridgeMenuBarViews

import SwiftUI

enum RemodexWindowID {
    static let controlCenter = "remodex-control-center"
}

@main
struct RemodexMenuBarApp: App {
    @StateObject private var store = BridgeMenuBarStore()

    var body: some Scene {
        MenuBarExtra {
            BridgeMenuBarContentView(store: store)
        } label: {
            BridgeMenuBarLabel(
                snapshot: store.snapshot,
                isBusy: store.isRefreshing || store.isPerformingAction
            )
        }
        .menuBarExtraStyle(.window)

        WindowGroup("Remodex", id: RemodexWindowID.controlCenter) {
            BridgeControlCenterWindow(store: store)
        }
        .defaultSize(width: 720, height: 640)
    }
}
