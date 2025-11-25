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
    echo -e "${GREEN}*${NC} Detected: Apple Silicon (M1/M2/M3/M4)"
elif [[ "$ARCH" == "x86_64" ]]; then
    DMG_ARCH="x64"
    echo -e "${GREEN}*${NC} Detected: Intel Mac"
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
echo -e "${BLUE}*${NC} Checking latest version..."
RELEASE_INFO=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null)

if [[ -z "$RELEASE_INFO" ]]; then
    echo -e "${RED}Error: Could not connect to GitHub${NC}"
    exit 1
fi

LATEST_TAG=$(echo "$RELEASE_INFO" | grep '"tag_name":' | sed -n '1p' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')

if [[ -z "$LATEST_TAG" ]]; then
    echo -e "${RED}Error: Could not find latest release${NC}"
    echo -e "${YELLOW}Please download manually from: https://github.com/$REPO/releases${NC}"
    exit 1
fi

VERSION="${LATEST_TAG#v}"
echo -e "${GREEN}*${NC} Latest version: ${BOLD}$VERSION${NC}"

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
echo -e "${BLUE}*${NC} Downloading ${DMG_NAME}..."
if ! curl -fSL --progress-bar -o "$DMG_PATH" "$DOWNLOAD_URL"; then
    echo -e "${RED}Error: Download failed${NC}"
    echo -e "${YELLOW}URL: $DOWNLOAD_URL${NC}"
    exit 1
fi
echo -e "${GREEN}*${NC} Download complete"

# Mount DMG and capture mount point
echo -e "${BLUE}*${NC} Mounting disk image..."
MOUNT_OUTPUT=$(hdiutil attach "$DMG_PATH" -nobrowse 2>&1)
if [[ $? -ne 0 ]]; then
    echo -e "${RED}Error: Failed to mount disk image${NC}"
    exit 1
fi

# Extract mount point from hdiutil output (last column of last line)
MOUNT_POINT=$(echo "$MOUNT_OUTPUT" | grep "/Volumes/" | sed -E 's|.*/Volumes/|/Volumes/|' | tr -d '\t')

if [[ -z "$MOUNT_POINT" ]] || [[ ! -d "$MOUNT_POINT" ]]; then
    echo -e "${RED}Error: Could not find mount point${NC}"
    exit 1
fi
echo -e "${GREEN}*${NC} Mounted"

# Check if app already exists
if [[ -d "$INSTALL_DIR/$APP_NAME.app" ]]; then
    echo -e "${YELLOW}*${NC} Removing previous installation..."
    rm -rf "$INSTALL_DIR/$APP_NAME.app"
fi

# Copy app to Applications
echo -e "${BLUE}*${NC} Installing to $INSTALL_DIR..."
if ! cp -R "$MOUNT_POINT/$APP_NAME.app" "$INSTALL_DIR/"; then
    echo -e "${RED}Error: Failed to copy app to Applications${NC}"
    echo -e "${YELLOW}Try running with sudo: sudo bash <(curl -fsSL ...)${NC}"
    exit 1
fi

# Verify installation
if [[ ! -d "$INSTALL_DIR/$APP_NAME.app" ]]; then
    echo -e "${RED}Error: Installation verification failed${NC}"
    exit 1
fi

# Remove quarantine attribute (bypass Gatekeeper for unsigned app)
echo -e "${BLUE}*${NC} Configuring security settings..."
xattr -cr "$INSTALL_DIR/$APP_NAME.app" 2>/dev/null || true
echo -e "${GREEN}*${NC} Security configured"

# Unmount DMG
echo -e "${BLUE}*${NC} Cleaning up..."
hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true

# Success message
echo ""
echo -e "${GREEN}${BOLD}================================================${NC}"
echo -e "${GREEN}${BOLD}   LyricGlow $VERSION installed successfully!${NC}"
echo -e "${GREEN}${BOLD}================================================${NC}"
echo ""
echo -e "Location: ${BOLD}$INSTALL_DIR/$APP_NAME.app${NC}"
echo ""

# Prompt to launch
echo -e -n "Launch LyricGlow now? [Y/n] "
read -r REPLY
if [[ "$REPLY" =~ ^[Nn]$ ]]; then
    echo ""
    echo -e "To launch later: ${BOLD}open -a LyricGlow${NC}"
else
    echo -e "${BLUE}*${NC} Launching LyricGlow..."
    open "$INSTALL_DIR/$APP_NAME.app"
fi

echo ""
echo -e "Enjoy your music with synchronized lyrics!"
echo ""
