/**
 * Translation provider contract
 *
 * A provider turns source lines into translations: one entry per input line,
 * in the same order, so callers can map results back by index.
 *
 * Two ways to report trouble, and the difference matters:
 *
 * - `null` in the returned array: this line did not translate, but the service
 *   is fine. The caller retries that line however it likes.
 * - throwing: the provider itself is unusable right now (transport error,
 *   server error, unparseable response). ProviderChain puts a throwing provider
 *   on cooldown and moves to the next one, so throw only for that case.
 *
 * Nothing provider-specific belongs in this interface. Endpoints, instance
 * lists, headers and retry rules live inside each provider, which is what makes
 * a new provider a single new file.
 */
export interface TranslationProvider {
  /** Stable identifier used in logs and for cooldown bookkeeping */
  readonly name: string;

  /**
   * Translate each line into targetLang.
   *
   * @param lines - source lines, never empty strings
   * @param targetLang - ISO code, e.g. 'fa'
   * @param timeoutMs - budget for a single request
   * @returns one entry per input line; null where that line failed
   * @throws when the provider as a whole could not be used
   */
  translateBatch(
    lines: string[],
    targetLang: string,
    timeoutMs: number,
  ): Promise<(string | null)[]>;
}
