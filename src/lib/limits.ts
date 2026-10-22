// So a long-running page doesn't take ever more memory and time. Applied outside the page, where its
// scripts can't change them.
import { browser } from 'wxt/browser';
import { loadStored, watchStored } from './storage';

export interface PerformanceLimits {
    callsPerScript: number;
    callsPerPage: number;
}

// More than ten times the most measured: about 390 calls by a collector (FingerprintJS's agent 337 to
// 388, TikTok's webmssdk about 350), about 2,500 by TikTok's whole page.
export const DEFAULT_LIMITS: PerformanceLimits = { callsPerScript: 5_000, callsPerPage: 25_000 };

export const LIMIT_FIELDS: { key: keyof PerformanceLimits; label: string; description: string }[] = [
    {
        key: 'callsPerScript',
        label: 'Calls kept per script',
        description: 'Past this, a script’s further calls aren’t kept or scored, and its score stays as it was. The most any measured fingerprinter made is about 390.',
    },
    {
        key: 'callsPerPage',
        label: 'Calls kept per page',
        description:
            'All the page’s scripts together, its frames’ too. Past this, its calls aren’t kept, scored or even sent to the extension any more, until the page is loaded again. TikTok’s whole page makes about 2,500.',
    },
];

const STORAGE_KEY = 'performanceLimits';

export async function loadLimits(): Promise<PerformanceLimits> {
    return { ...DEFAULT_LIMITS, ...(await loadStored<Partial<PerformanceLimits>>(STORAGE_KEY)) };
}

export function saveLimits(limits: PerformanceLimits): Promise<void> {
    return browser.storage.local.set({ [STORAGE_KEY]: limits });
}

export function watchLimits(onChange: (limits: PerformanceLimits) => void): () => void {
    return watchStored<Partial<PerformanceLimits>>(STORAGE_KEY, (value) => onChange({ ...DEFAULT_LIMITS, ...value }));
}
