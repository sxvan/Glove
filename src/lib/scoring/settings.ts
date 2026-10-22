import { browser } from 'wxt/browser';
import { loadStored, watchStored } from '../storage';
import { DEFAULT_SETTINGS, type ScoreLevel, type ScoringSettings } from './definitions';

const STORAGE_KEY = 'scoringSettings';

// The stored units' version (2: API information in bits), should the units change again.
const SETTINGS_VERSION = 2;

type StoredSettings = Partial<ScoringSettings> & { version?: number };

export async function loadScoringSettings(): Promise<ScoringSettings> {
    return withDefaults(await loadStored<StoredSettings>(STORAGE_KEY));
}

// Only what differs from the defaults, so a recalibrated default reaches everyone who didn't set it.
export function saveScoringSettings(settings: ScoringSettings): Promise<void> {
    const changed = (changedFrom(DEFAULT_SETTINGS, settings) ?? {}) as StoredSettings;
    return browser.storage.local.set({ [STORAGE_KEY]: { ...changed, version: SETTINGS_VERSION } });
}

function changedFrom(base: unknown, value: unknown): unknown {
    if (typeof value === 'object' && value !== null && typeof base === 'object' && base !== null) {
        const changed: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value)) {
            const difference = changedFrom((base as Record<string, unknown>)[key], inner);
            if (difference !== undefined) changed[key] = difference;
        }
        return Object.keys(changed).length > 0 ? changed : undefined;
    }
    return value === base ? undefined : value;
}

export function resetScoringSettings(): Promise<void> {
    return browser.storage.local.remove(STORAGE_KEY);
}

export function watchScoringSettings(onChange: (settings: ScoringSettings) => void): () => void {
    return watchStored<StoredSettings>(STORAGE_KEY, (value) => onChange(withDefaults(value)));
}

function withDefaults(stored: StoredSettings | undefined): ScoringSettings {
    const strengths = Object.fromEntries(
        (Object.keys(DEFAULT_SETTINGS.strengths) as ScoreLevel[]).map((level) => [
            level,
            { ...DEFAULT_SETTINGS.strengths[level], ...stored?.strengths?.[level] },
        ])
    ) as ScoringSettings['strengths'];
    return {
        strengths,
        cutoffs: {
            fingerprinting: { ...DEFAULT_SETTINGS.cutoffs.fingerprinting, ...stored?.cutoffs?.fingerprinting },
        },
        apis: Object.fromEntries(
            Object.entries(DEFAULT_SETTINGS.apis).map(([id, traits]) => [id, { ...traits, ...stored?.apis?.[id] }])
        ),
        rarityPower: stored?.rarityPower ?? DEFAULT_SETTINGS.rarityPower,
        fullAt: {
            burst: { ...DEFAULT_SETTINGS.fullAt.burst, ...stored?.fullAt?.burst },
            pageBurst: { ...DEFAULT_SETTINGS.fullAt.pageBurst, ...stored?.fullAt?.pageBurst },
            script: { ...DEFAULT_SETTINGS.fullAt.script, ...stored?.fullAt?.script },
            page: { ...DEFAULT_SETTINGS.fullAt.page, ...stored?.fullAt?.page },
        },
        bursts: { ...DEFAULT_SETTINGS.bursts, ...stored?.bursts },
        identifiers: { ...DEFAULT_SETTINGS.identifiers, ...stored?.identifiers },
    };
}
