// Null while an input isn't a number.
import { DEFAULT_SETTINGS, type ScoringSettings } from '@/lib/scoring';

/** As a value from 0 to 1. */
export function percentFromInput(event: Event): number | null {
    const value = valueOf(event);
    return value === null ? null : Math.min(100, Math.max(0, value)) / 100;
}

export function positiveFromInput(event: Event): number | null {
    const value = valueOf(event);
    return value === null ? null : Math.max(0, value);
}

export function unitFromInput(event: Event): number | null {
    const value = valueOf(event);
    return value === null ? null : Math.min(1, Math.max(0, value));
}

export const percent = (value: number) => Math.round(value * 100);

function valueOf(event: Event): number | null {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    return Number.isFinite(value) ? value : null;
}

export const differs = (value: unknown, defaults: unknown) => JSON.stringify(value) !== JSON.stringify(defaults);

export function resetPart<K extends keyof ScoringSettings>(settings: ScoringSettings, key: K) {
    settings[key] = structuredClone(DEFAULT_SETTINGS[key]);
}
