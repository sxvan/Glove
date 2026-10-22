// How many fingerprinting API calls are kept, so a long-running page doesn't take ever more memory and
// time: per script, and per page (the tab's page with all its frames). Past a limit, further calls
// aren't kept or scored, and the scores stay as they were; past the page's, its calls aren't even sent
// to the background any more (see bridge). The page itself can't change them: they apply where its
// scripts can't reach, as a recorder in the page could be told anything by them.
import { browser } from 'wxt/browser';
import { loadStored, watchStored } from './storage';

export interface PerformanceLimits {
    callsPerScript: number;
    callsPerPage: number;
}

/**
 * Far above what fingerprinting takes: the most any measured collector made is about 390 calls
 * (FingerprintJS's agent 337 to 388, TikTok's webmssdk about 350), and TikTok's whole page about
 * 2,500; so more than ten times either.
 */
export const DEFAULT_LIMITS: PerformanceLimits = { callsPerScript: 5_000, callsPerPage: 25_000 };

/** The limits with their labels and explanations, in the order the options page lists them. */
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

/** Calls `onChange` with the limits whenever the user changes them. */
export function watchLimits(onChange: (limits: PerformanceLimits) => void): () => void {
    return watchStored<Partial<PerformanceLimits>>(STORAGE_KEY, (value) => onChange({ ...DEFAULT_LIMITS, ...value }));
}
