/**
 * Translation providers
 *
 * The order below is the whole routing policy: the chain tries providers from
 * first to last and skips any that recently failed. Adding a service means
 * writing one file that implements TranslationProvider and adding it to this
 * list; reordering means moving one line.
 */

import GoogleWebProvider from './GoogleWebProvider';
import LingvaProvider from './LingvaProvider';
import ProviderChain from './ProviderChain';

export { default as ProviderChain } from './ProviderChain';

/**
 * Build the default chain: Google's web endpoint first, Lingva as backup
 */
export function createProviderChain(): ProviderChain {
  return new ProviderChain([new GoogleWebProvider(), new LingvaProvider()]);
}
