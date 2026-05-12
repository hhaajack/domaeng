// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "DomaengMenuBar",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "DomaengMenuBar", targets: ["DomaengMenuBar"])
    ],
    targets: [
        .executableTarget(name: "DomaengMenuBar")
    ]
)
