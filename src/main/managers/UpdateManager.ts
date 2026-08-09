/**
 * UpdateManager: Check for app updates from GitHub Releases
 *
 * Features:
 * - Fetches latest release from GitHub API
 * - Compares with current version
 * - Returns update information with changelog
 *
 * Note: Manual download only (no auto-update, no code signing needed)
 */

import { app, dialog, shell } from 'electron';
import Logger from '../../shared/utils/Logger';

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
    size: number;
  }>;
}

interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  changelog: string;
  publishedAt: string;
}

class UpdateManager {
  private readonly repo = 'ateymoori/lyricglow';
  private readonly apiUrl =
    `https://api.github.com/repos/${this.repo}/releases/latest`;

  /**
   * Check if a new version is available
   */
  async checkForUpdates(): Promise<UpdateInfo> {
    const currentVersion = app.getVersion();

    try {
      Logger.app.info('Checking for updates...');

      const response = await fetch(this.apiUrl, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'LyricGlow',
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const release = (await response.json()) as GitHubRelease;
      const latestVersion = release.tag_name.replace(/^v/, '');

      const available = this.isNewerVersion(currentVersion, latestVersion);

      Logger.app.info(
        `Update check: current=${currentVersion}, latest=${latestVersion}, available=${available}`,
      );

      return {
        available,
        currentVersion,
        latestVersion,
        releaseUrl: release.html_url,
        changelog: release.body || 'No changelog available',
        publishedAt: release.published_at,
      };
    } catch (error) {
      Logger.app.error('Update check failed', error as Error);
      throw error;
    }
  }

  /**
   * Split a version into its numeric core and pre-release tag.
   * "1.2.3-beta.1" -> { parts: [1, 2, 3], prerelease: true }
   */
  private parseVersion(version: string): {
    parts: number[];
    prerelease: boolean;
  } {
    const cleaned = version.trim().replace(/^v/i, '');
    const [core = '', ...rest] = cleaned.split(/[-+]/);

    const parts = [0, 1, 2].map((i) => {
      // parseInt stops at the first non-digit, so "1rc" still reads as 1
      const value = parseInt(core.split('.')[i] ?? '0', 10);
      return Number.isNaN(value) ? 0 : value;
    });

    return { parts, prerelease: rest.length > 0 && rest[0] !== '' };
  }

  /**
   * Compare semantic versions.
   * Pre-release tags never break the comparison, and a pre-release ranks below
   * the release with the same numbers (1.0.0-beta < 1.0.0).
   */
  private isNewerVersion(current: string, latest: string): boolean {
    const curr = this.parseVersion(current);
    const lat = this.parseVersion(latest);

    for (let i = 0; i < 3; i++) {
      const c = curr.parts[i] ?? 0;
      const l = lat.parts[i] ?? 0;

      if (l > c) return true;
      if (l < c) return false;
    }

    // Same numbers: only a release is newer than the pre-release of it
    return curr.prerelease && !lat.prerelease;
  }

  /**
   * Show update dialog with download option
   */
  async showUpdateDialog(updateInfo: UpdateInfo): Promise<void> {
    if (!updateInfo.available) {
      dialog.showMessageBox({
        type: 'info',
        title: 'No Updates Available',
        message: 'You are running the latest version',
        detail: `Current version: ${updateInfo.currentVersion}`,
        buttons: ['OK'],
      });
      return;
    }

    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `LyricGlow ${updateInfo.latestVersion} is available`,
      detail: `You are currently running version ${updateInfo.currentVersion}\n\nChanges:\n${this.cleanChangelog(updateInfo.changelog)}`,
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      // User clicked "Download"
      shell.openExternal(updateInfo.releaseUrl);
      Logger.app.info('Opened release page in browser');
    }
  }

  /**
   * Clean changelog for dialog display (max 200 chars)
   */
  private cleanChangelog(changelog: string): string {
    // Remove markdown headers and formatting
    let cleaned = changelog
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim();

    // Truncate if too long
    if (cleaned.length > 200) {
      cleaned = `${cleaned.substring(0, 197)}...`;
    }

    return cleaned;
  }
}

export default new UpdateManager();
