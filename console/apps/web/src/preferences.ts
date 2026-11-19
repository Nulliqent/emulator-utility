/**
 * Preferences live in browser localStorage under the `console:v1:` prefix. Storage can be blocked or absent
 * (private window, site data cleared), so every access is guarded and the app works without it.
 */
const PREFIX = "console:v1:";

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // Not persisted; the value still holds for this page's lifetime.
  }
}

/** The raw storage key, for listening to `storage` events. */
export const prefKey = (key: string) => PREFIX + key;
