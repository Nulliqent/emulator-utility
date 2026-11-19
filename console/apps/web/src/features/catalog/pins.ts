import { useSyncExternalStore } from "react";
import { prefKey, readPref, writePref } from "../../preferences.ts";

const KEY = "pinned-services";

export function parsePins(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : [];
  } catch {
    return [];
  }
}

let pins: string[] = parsePins(readPref(KEY));
const listeners = new Set<() => void>();

function set(next: string[]) {
  pins = next;
  writePref(KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

export const togglePin = (serviceId: string) => set(pins.includes(serviceId) ? pins.filter((p) => p !== serviceId) : [...pins, serviceId]);

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === prefKey(KEY) || e.key === null) {
      pins = parsePins(readPref(KEY));
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export const usePins = () => useSyncExternalStore(subscribe, () => pins);
