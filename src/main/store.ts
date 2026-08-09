/**
 * Shared settings store
 *
 * electron-store is ESM-only, so it has to be imported dynamically. Every part
 * of the app goes through this one lazily-created instance: window settings,
 * section visibility and Spotify tokens all live in the same config.json, and
 * separate instances each kept their own in-memory copy of that file, so a
 * write through one could drop a write made through another.
 *
 * The on-disk format is unchanged - this is the same default store the three
 * previous instances opened.
 */

import type Store from 'electron-store';

let storePromise: Promise<Store> | null = null;

/**
 * The shared store, created on first use
 */
export async function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = import('electron-store').then(
      (module) => new module.default(),
    );
  }

  return storePromise;
}
