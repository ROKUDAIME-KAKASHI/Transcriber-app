// The per-device opt-in for reading names from the call screen (beta). Default OFF. Pure helpers over a
// storage-like object so node tests can use a Map. Erasable TypeScript only, no imports.

export const SCREEN_NAMING_KEY = "minutely.screenNaming";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function screenNamingOptedIn(store: KeyValueStore | null | undefined): boolean {
  try {
    return store?.getItem(SCREEN_NAMING_KEY) === "1";
  } catch {
    return false;
  }
}

export function setScreenNamingOptIn(store: KeyValueStore | null | undefined, on: boolean): void {
  try {
    if (on) store?.setItem(SCREEN_NAMING_KEY, "1");
    else store?.removeItem(SCREEN_NAMING_KEY);
  } catch {
    /* storage blocked: stays off */
  }
}

export interface NamingGateInput {
  /** The `screenNaming` feature switch. */
  flag: boolean;
  /** This device's opt-in. */
  optIn: boolean;
  /** This is a "Record an online call" tab recording. */
  guided: boolean;
  /** Chromium on a laptop, not the app (guidedCallAvailable). */
  desktopChromium: boolean;
}

/** Everything must be true: nothing runs, loads or is shown otherwise. */
export function screenNamingActive(g: NamingGateInput): boolean {
  return g.flag && g.optIn && g.guided && g.desktopChromium;
}
