#!/bin/bash
#
# Full release pipeline for LyricGlow. One command does everything:
#
#   npm run release            # patch bump (0.7.0 -> 0.7.1)
#   npm run release -- minor   # 0.7.0 -> 0.8.0
#   npm run release -- major   # 0.7.0 -> 1.0.0
#
# Steps: preflight checks -> version bump -> typecheck/lint -> build signed
# DMGs (arm64 + x64) -> notarize + staple with Apple -> verify Gatekeeper ->
# commit + tag + push -> GitHub release with DMGs -> update Homebrew cask.
#
# Prerequisites (one-time setup, already done on this machine):
#   - "Developer ID Application: Royan AB" certificate in the Keychain
#     (electron-builder.yml signs with it automatically)
#   - notarytool credentials: xcrun notarytool store-credentials lyricglow-notary
#   - gh CLI authenticated with push access to ateymoori/lyricglow and
#     ateymoori/homebrew-tap
#   - The new version's section added to CHANGELOG.md BEFORE running this
#     (the script hard-fails without it — the changelog is the release notes)

set -euo pipefail

BUMP="${1:-patch}"
NOTARY_PROFILE="lyricglow-notary"
TAP_REPO="git@github.com:ateymoori/homebrew-tap.git"

fail() { echo "❌ $1" >&2; exit 1; }

# ── Preflight ────────────────────────────────────────────────────────────────
echo "🔍 Preflight checks..."

[[ "$BUMP" =~ ^(patch|minor|major)$ ]] || fail "Argument must be patch, minor or major (got: $BUMP)"

[ "$(git branch --show-current)" = "main" ] || fail "Not on main branch"
git diff-index --quiet HEAD -- || fail "Working tree is not clean — commit or stash first"

git fetch origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || fail "Local main and origin/main differ — sync first"

security find-identity -v -p codesigning | grep -q "Developer ID Application: Royan AB" \
  || fail "Royan AB Developer ID certificate not found in Keychain"

xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1 \
  || fail "Notary profile '$NOTARY_PROFILE' not found — run: xcrun notarytool store-credentials $NOTARY_PROFILE"

gh auth status >/dev/null 2>&1 || fail "gh CLI is not authenticated"

# ── Version bump ─────────────────────────────────────────────────────────────
CURRENT_VERSION=$(node -p "require('./package.json').version")
npm version "$BUMP" --no-git-tag-version >/dev/null
NEW_VERSION=$(node -p "require('./package.json').version")
echo "📦 Version: $CURRENT_VERSION -> $NEW_VERSION"

if ! grep -q "^## \[$NEW_VERSION\]" CHANGELOG.md; then
  git checkout -- package.json package-lock.json
  fail "CHANGELOG.md has no '## [$NEW_VERSION]' section — write the changelog first, then rerun"
fi

# ── Quality gates ────────────────────────────────────────────────────────────
echo "🧪 Typecheck + lint..."
npm run typecheck
npm run lint

# ── Build signed DMGs ────────────────────────────────────────────────────────
echo "🔨 Building signed DMGs (arm64 + x64)..."
rm -rf release
npm run dist:mac

DMG_ARM="release/LyricGlow-arm64.dmg"
DMG_X64="release/LyricGlow-x64.dmg"
[ -f "$DMG_ARM" ] && [ -f "$DMG_X64" ] || fail "Expected DMGs missing in release/"

codesign --verify --deep --strict release/mac-arm64/LyricGlow.app || fail "arm64 app signature invalid"
codesign --verify --deep --strict release/mac/LyricGlow.app || fail "x64 app signature invalid"

# ── Notarize + staple ────────────────────────────────────────────────────────
for DMG in "$DMG_ARM" "$DMG_X64"; do
  echo "📤 Notarizing $DMG (Apple usually takes 2-10 min)..."
  RESULT=$(xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait 2>&1)
  echo "$RESULT" | grep -q "status: Accepted" || { echo "$RESULT"; fail "Notarization failed for $DMG"; }
  xcrun stapler staple "$DMG" || fail "Stapling failed for $DMG"
done

spctl --assess --type execute -v release/mac-arm64/LyricGlow.app 2>&1 | grep -q "accepted" \
  || fail "Gatekeeper does not accept the notarized app"
echo "✅ Notarized and stapled — Gatekeeper accepts"

SHA_ARM=$(shasum -a 256 "$DMG_ARM" | cut -d' ' -f1)
SHA_X64=$(shasum -a 256 "$DMG_X64" | cut -d' ' -f1)

# ── Commit, tag, push ────────────────────────────────────────────────────────
echo "🏷  Committing and tagging v$NEW_VERSION..."
git add package.json package-lock.json
git commit -m "release: v$NEW_VERSION"
git tag "v$NEW_VERSION"
git push origin main "v$NEW_VERSION"

# ── GitHub release ───────────────────────────────────────────────────────────
echo "🚀 Creating GitHub release..."
NOTES_FILE=$(mktemp)
awk -v ver="$NEW_VERSION" '/^## \[/{p = ($0 ~ "\\[" ver "\\]")} p' CHANGELOG.md > "$NOTES_FILE"
gh release create "v$NEW_VERSION" "$DMG_ARM" "$DMG_X64" \
  --title "v$NEW_VERSION" \
  --notes-file "$NOTES_FILE"
rm -f "$NOTES_FILE"

# ── Homebrew cask ────────────────────────────────────────────────────────────
echo "🍺 Updating Homebrew cask..."
TAP_DIR=$(mktemp -d)
git clone -q "$TAP_REPO" "$TAP_DIR"
CASK="$TAP_DIR/Casks/lyricglow.rb"
[ -f "$CASK" ] || fail "Cask not found in tap repo"

sed -i '' -E "s|^  version \".*\"|  version \"$NEW_VERSION\"|" "$CASK"
sed -i '' -E "s|arm:   \".*\"|arm:   \"$SHA_ARM\"|" "$CASK"
sed -i '' -E "s|intel: \".*\"|intel: \"$SHA_X64\"|" "$CASK"

git -C "$TAP_DIR" add Casks/lyricglow.rb
git -C "$TAP_DIR" commit -m "lyricglow $NEW_VERSION"
git -C "$TAP_DIR" push
rm -rf "$TAP_DIR"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🎉 v$NEW_VERSION shipped"
echo "  Release: https://github.com/ateymoori/lyricglow/releases/tag/v$NEW_VERSION"
echo "  Install: brew install --cask ateymoori/tap/lyricglow"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
