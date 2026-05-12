#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
REPO_ROOT=$(CDPATH= cd -- "$PACKAGE_DIR/../.." && pwd)
APP_DIR="$PACKAGE_DIR/build/DomaengMenuBar.app"
BINARY_PATH="$PACKAGE_DIR/.build/release/DomaengMenuBar"
VERSION=$(node -p "require('$REPO_ROOT/phodex-bridge/package.json').version" 2>/dev/null || printf "1.0.0")
CACHE_ROOT="${TMPDIR:-/tmp}/domaeng-menubar-swift-cache"
RESOURCES_DIR="$APP_DIR/Contents/Resources"
ICON_SOURCE="$REPO_ROOT/web/public/icons/domaeng-icon-512.png"

mkdir -p "$CACHE_ROOT/clang" "$CACHE_ROOT/swiftpm" "$CACHE_ROOT/xdg"
export CLANG_MODULE_CACHE_PATH="$CACHE_ROOT/clang"
export SWIFTPM_MODULECACHE_OVERRIDE="$CACHE_ROOT/swiftpm"
export XDG_CACHE_HOME="$CACHE_ROOT/xdg"

swift build -c release --package-path "$PACKAGE_DIR" --scratch-path "$PACKAGE_DIR/.build" --disable-sandbox

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$RESOURCES_DIR"

cp "$BINARY_PATH" "$APP_DIR/Contents/MacOS/DomaengMenuBar"
chmod +x "$APP_DIR/Contents/MacOS/DomaengMenuBar"

if [ -f "$ICON_SOURCE" ]; then
  cp "$ICON_SOURCE" "$RESOURCES_DIR/DomaengIcon.png"
  sips -s format icns "$ICON_SOURCE" --out "$RESOURCES_DIR/DomaengIcon.icns" >/dev/null
fi

cat > "$APP_DIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>DomaengMenuBar</string>
  <key>CFBundleIdentifier</key>
  <string>com.domaeng.menubar</string>
  <key>CFBundleIconFile</key>
  <string>DomaengIcon</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>DomaengMenuBar</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundleVersion</key>
  <string>$VERSION</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

printf '%s\n' "$APP_DIR"
