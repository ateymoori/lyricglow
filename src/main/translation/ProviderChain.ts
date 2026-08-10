/**
 * Provider chain
 *
 * Walks the configured providers in order and returns the first usable answer.
 * A provider that throws is considered down and skipped for ten minutes, so a
 * dead service costs one failed request rather than one per line of every song.
 *
 * This is the only translation entry point TranslationManager knows about.
 */

import Logger from '../../shared/utils/Logger';
import type { TranslationProvider } from './TranslationProvider';

// How long a failing provider is left alone before it is tried again
const COOLDOWN_MS = 10 * 60 * 1000;

class ProviderChain {
  private readonly providers: TranslationProvider[];
  private readonly cooldownUntil = new Map<string, number>();

  constructor(providers: TranslationProvider[]) {
    this.providers = providers;
  }

  /**
   * Translate lines with the first provider that can do it.
   *
   * @returns one entry per input line; null where that line failed
   * @throws when no provider was able to run at all
   */
  async translateBatch(
    lines: string[],
    targetLang: string,
    timeoutMs: number,
  ): Promise<(string | null)[]> {
    if (!lines.length) return [];

    let lastError: Error | null = null;
    let emptyResult: (string | null)[] | null = null;

    for (const provider of this.providers) {
      if (this.isCoolingDown(provider.name)) continue;

      try {
        const results = await provider.translateBatch(
          lines,
          targetLang,
          timeoutMs,
        );

        // Something came back - use it
        if (results.some((result) => result !== null)) {
          return results;
        }

        // Provider ran but translated nothing; try the next one before giving
        // up, and do not punish it with a cooldown
        emptyResult = results;
      } catch (error) {
        lastError = error as Error;
        this.startCooldown(provider.name);

        // One warning per provider failure, never one per line
        Logger.lyrics.warn(
          `Translation provider "${provider.name}" unavailable (${lastError.message}); skipping it for ${COOLDOWN_MS / 60000} minutes`,
        );
      }
    }

    if (emptyResult) return emptyResult;

    throw lastError ?? new Error('No translation provider available right now');
  }

  private isCoolingDown(name: string): boolean {
    const until = this.cooldownUntil.get(name);

    if (until === undefined) return false;
    if (until > Date.now()) return true;

    this.cooldownUntil.delete(name);
    return false;
  }

  private startCooldown(name: string): void {
    this.cooldownUntil.set(name, Date.now() + COOLDOWN_MS);
  }
}

export default ProviderChain;
