// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "hoverhelper",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "hoverhelper",
            path: "Sources/hoverhelper"
        )
    ]
)
