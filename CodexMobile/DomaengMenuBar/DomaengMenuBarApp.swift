// FILE: DomaengMenuBarApp.swift
// Purpose: Entry point for the macOS companion that turns the existing bridge CLI into a menu bar control center.
// Layer: Companion app
// Exports: DomaengMenuBarApp
// Depends on: SwiftUI, BridgeMenuBarStore, BridgeMenuBarViews

import SwiftUI

enum DomaengWindowID {
    static let controlCenter = "domaeng-control-center"
}

@main
struct DomaengMenuBarApp: App {
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

        WindowGroup("Domaeng", id: DomaengWindowID.controlCenter) {
            BridgeControlCenterWindow(store: store)
        }
        .defaultSize(width: 720, height: 640)
    }
}
