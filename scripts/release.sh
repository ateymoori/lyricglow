#!/bin/bash

set -e

echo "🚀 Starting release process..."
echo ""

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "📦 Current version: $CURRENT_VERSION"

# Bump version
echo "⬆️  Bumping version..."
npm version patch --no-git-tag-version

# Get new version
NEW_VERSION=$(node -p "require('./package.json').version")
echo "✅ New version: $NEW_VERSION"
echo ""

# Clean old builds
echo "🧹 Cleaning old builds..."
rm -rf dist
echo "✅ Cleaned dist folder"
echo ""

# Build DMG
echo "🔨 Building DMG for Apple Silicon..."
npm run dist:mac
echo ""

# Show result
echo "✅ DMG created successfully!"
echo ""
echo "📍 Location:"
ls -lh dist/*.dmg
echo ""

DMG_FILE=$(ls dist/*.dmg | /usr/bin/head -n 1)
DMG_SIZE=$(du -h "$DMG_FILE" | cut -f1)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Release: v$NEW_VERSION"
echo "  File: $(basename "$DMG_FILE")"
echo "  Size: $DMG_SIZE"
echo "  Platform: macOS (Apple Silicon)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📦 To install/update:"
echo "   1. Copy DMG to target Mac"
echo "   2. Double-click DMG"
echo "   3. Drag to Applications folder"
echo "   4. Replace if already exists"
echo ""
echo "🎉 Done!"