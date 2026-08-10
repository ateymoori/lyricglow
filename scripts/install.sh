#!/bin/bash
#
# LyricGlow Installer for macOS
# Real-time synchronized lyrics for Spotify, Apple Music & more
#
# Usage: curl -fsSL https://raw.githubusercontent.com/ateymoori/lyricglow/main/scripts/install.sh | bash
#

set -e

# Configuration
REPO="ateymoori/lyricglow"
APP_NAME="LyricGlow"
INSTALL_DIR="/Applications"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

# Print banner
echo ""
echo -e "${BLUE}${BOLD}"
cat << 'EOF'
  _               _       _____ _
 | |   _   _ _ __(_) ___ |  __ | | _____      __
 | |  | | | | '__| |/ __|| |  \| |/ _ \ \ /\ / /
 | |__| |_| | |  | | (__ | |__|| | (_) \ V  V /
 |_____\__, |_|  |_|\___||_____/_|\___/ \_/\_/
       |___/
EOF
echo -e "${NC}"
echo -e "${BOLD}Real-time synchronized lyrics for macOS${NC}"
echo ""

# Check if running on macOS
if [[ "$(uname)" != "Darwin" ]]; then
    echo -e "${RED}Error: LyricGlow is only available for macOS${NC}"
    exit 1
fi

# Detect architecture
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" ]]; then
    DMG_ARCH="arm64"
    echo -e "${GREEN}✓${NC} Detected: Apple Silicon (M1/M2/M3/M4)"
elif [[ "$ARCH" == "x86_64" ]]; then
    DMG_ARCH="x64"
    echo -e "${GREEN}✓${NC} Detected: Intel Mac"
else
    echo -e "${RED}Error: Unsupported architecture: $ARCH${NC}"
    exit 1
fi

# Check for curl
if ! command -v curl &> /dev/null; then
    echo -e "${RED}Error: curl is required but not installed${NC}"
    exit 1
fi

# Fetch latest release version from GitHub API
echo -e "${BLUE}→${NC} Checking latest version..."
RELEASE_INFO=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null) || {
    echo -e "${RED}Error: Could not connect to GitHub${NC}"
    exit 1
}

if [[ -z "$RELEASE_INFO" ]]; then
    echo -e "${RED}Error: Empty response from GitHub${NC}"
    exit 1
fi

# Parse tag_name - try jq first, fallback to grep/sed
if command -v jq &> /dev/null; then
    LATEST_TAG=$(echo "$RELEASE_INFO" | jq -r '.tag_name // empty')
else
    LATEST_TAG=$(echo "$RELEASE_INFO" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
fi

if [[ -z "$LATEST_TAG" ]]; then
    echo -e "${RED}Error: Could not find latest release${NC}"
    echo -e "${YELLOW}Please download manually from: https://github.com/$REPO/releases${NC}"
    exit 1
fi

VERSION="${LATEST_TAG#v}"

# Check if already installed and get current version
CURRENT_VERSION=""
if [[ -d "$INSTALL_DIR/$APP_NAME.app" ]]; then
    CURRENT_VERSION=$(defaults read "$INSTALL_DIR/$APP_NAME.app/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo "")
fi

# Compare versions
if [[ -n "$CURRENT_VERSION" ]]; then
    if [[ "$CURRENT_VERSION" == "$VERSION" ]]; then
        echo -e "${GREEN}✓${NC} Already up to date: ${BOLD}v$VERSION${NC}"
        echo ""
        echo -e "LyricGlow is already at the latest version."
        echo -e "To reinstall, first remove: ${BOLD}rm -rf /Applications/LyricGlow.app${NC}"
        echo ""
        exit 0
    else
        echo -e "${YELLOW}→${NC} Update available: v$CURRENT_VERSION → ${BOLD}v$VERSION${NC}"
    fi
else
    echo -e "${GREEN}✓${NC} Latest version: ${BOLD}v$VERSION${NC}"
fi

# Check if app is currently running
if pgrep -x "$APP_NAME" > /dev/null 2>&1; then
    echo -e "${YELLOW}→${NC} Stopping running instance..."
    pkill -x "$APP_NAME" 2>/dev/null || true
    sleep 1
fi

# Build download URL
DMG_NAME="${APP_NAME}-${DMG_ARCH}.dmg"
DOWNLOAD_URL="https://github.com/$REPO/releases/download/$LATEST_TAG/$DMG_NAME"

# Create temporary directory
TEMP_DIR=$(mktemp -d)
DMG_PATH="$TEMP_DIR/$DMG_NAME"
MOUNT_POINT=""

# Cleanup function
cleanup() {
    if [[ -n "$MOUNT_POINT" ]] && [[ -d "$MOUNT_POINT" ]]; then
        hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
    fi
    rm -rf "$TEMP_DIR" 2>/dev/null || true
}
trap cleanup EXIT

# Download DMG
echo -e "${BLUE}→${NC} Downloading ${DMG_NAME}..."
if ! curl -fSL --progress-bar -o "$DMG_PATH" "$DOWNLOAD_URL"; then
    echo -e "${RED}Error: Download failed${NC}"
    echo -e "${YELLOW}URL: $DOWNLOAD_URL${NC}"
    exit 1
fi

# Verify download (check file exists and has reasonable size > 10MB)
DMG_SIZE=$(stat -f%z "$DMG_PATH" 2>/dev/null || echo "0")
if [[ "$DMG_SIZE" -lt 10000000 ]]; then
    echo -e "${RED}Error: Downloaded file is too small (corrupted?)${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Download complete ($(echo "scale=1; $DMG_SIZE/1048576" | bc)MB)"

# Mount DMG
echo -e "${BLUE}→${NC} Mounting disk image..."
MOUNT_OUTPUT=$(hdiutil attach "$DMG_PATH" -nobrowse -readonly 2>&1) || {
    echo -e "${RED}Error: Failed to mount disk image${NC}"
    echo "$MOUNT_OUTPUT"
    exit 1
}

# Extract mount point (look for /Volumes/ in output)
MOUNT_POINT=$(echo "$MOUNT_OUTPUT" | awk '/\/Volumes\// {for(i=1;i<=NF;i++) if($i ~ /^\/Volumes/) {p=$i; for(j=i+1;j<=NF;j++) p=p" "$j; print p; exit}}')

if [[ -z "$MOUNT_POINT" ]] || [[ ! -d "$MOUNT_POINT" ]]; then
    # Fallback: find any recently mounted LyricGlow volume
    MOUNT_POINT=$(find /Volumes -maxdepth 1 -name "*LyricGlow*" -type d 2>/dev/null | head -1)
fi

if [[ -z "$MOUNT_POINT" ]] || [[ ! -d "$MOUNT_POINT" ]]; then
    echo -e "${RED}Error: Could not find mount point${NC}"
    exit 1
fi

# Verify app exists in mounted DMG
if [[ ! -d "$MOUNT_POINT/$APP_NAME.app" ]]; then
    echo -e "${RED}Error: App not found in disk image${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Mounted"

# Check if app already exists and remove old version
if [[ -d "$INSTALL_DIR/$APP_NAME.app" ]]; then
    echo -e "${BLUE}→${NC} Removing old version..."
    rm -rf "$INSTALL_DIR/$APP_NAME.app"
fi

# Copy app to Applications
echo -e "${BLUE}→${NC} Installing to $INSTALL_DIR..."
if ! cp -R "$MOUNT_POINT/$APP_NAME.app" "$INSTALL_DIR/"; then
    echo -e "${RED}Error: Failed to copy app to Applications${NC}"
    echo -e "${YELLOW}Try running with sudo:${NC}"
    echo -e "${BOLD}  sudo bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/$REPO/main/scripts/install.sh)\"${NC}"
    exit 1
fi

# Verify installation
if [[ ! -d "$INSTALL_DIR/$APP_NAME.app" ]]; then
    echo -e "${RED}Error: Installation verification failed${NC}"
    exit 1
fi

# Remove quarantine attribute (harmless on notarized v0.7.0+; needed for old unsigned releases)
echo -e "${BLUE}→${NC} Configuring security..."
xattr -cr "$INSTALL_DIR/$APP_NAME.app" 2>/dev/null || true
echo -e "${GREEN}✓${NC} Security configured"

# Unmount DMG (cleanup will also try this)
hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
MOUNT_POINT=""

# Success message
echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════${NC}"
if [[ -n "$CURRENT_VERSION" ]]; then
    echo -e "${GREEN}${BOLD}   LyricGlow upgraded: v$CURRENT_VERSION → v$VERSION${NC}"
else
    echo -e "${GREEN}${BOLD}   LyricGlow v$VERSION installed successfully!${NC}"
fi
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Location: ${BOLD}$INSTALL_DIR/$APP_NAME.app${NC}"
echo -e "  Settings: ${BOLD}Preserved${NC} (stored in ~/Library)"
echo ""

# Launch the app
echo -e "${BLUE}→${NC} Launching LyricGlow..."
open "$INSTALL_DIR/$APP_NAME.app"

echo ""
echo -e "${GREEN}✓${NC} Enjoy your music with synchronized lyrics!"
echo -e "  To quit: Click the menu bar icon → Quit"
echo ""
