import type { StorageKind } from '@/types/snapshot';

/** "a, b, c and 5 more" past `shown`; a single item left over is named instead of "and 1 more". */
export function listWords(items: string[], shown = Infinity): string {
    const named = items.length > shown + 1 ? items.slice(0, shown) : items;
    const more = items.length - named.length;
    const last = more > 0 ? `${more} more` : named[named.length - 1];
    const before = more > 0 ? named : named.slice(0, -1);
    return before.length > 0 ? `${before.join(', ')} and ${last}` : (last ?? '');
}

export function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One decimal, two below 1 ("0.07"), without trailing zeros. */
export function amount(x: number): string {
    return String(+x.toFixed(x < 1 ? 2 : 1));
}

export function day(time: number): string {
    return new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Under a millisecond counts as 1 ms. */
export function duration(ms: number): string {
    return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function elapsed(ms: number): string {
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
    const seconds = Math.floor(ms / 1000);
    return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
}

/** To two significant digits: "260,000", "2.6 million". */
export function roughCount(count: number): string {
    const rounded = Number(count.toPrecision(2));
    if (rounded >= 1e9) return `${Number((rounded / 1e9).toPrecision(2))} billion`;
    if (rounded >= 1e6) return `${Number((rounded / 1e6).toPrecision(2))} million`;
    return rounded.toLocaleString('en-US');
}

export function bytes(count: number): string {
    return count < 1024 ? `${count} B` : `${(count / 1024).toFixed(1)} KB`;
}

export const STORAGE_WORDS: Record<StorageKind, string> = {
    cookie: 'cookie',
    localStorage: 'local storage',
    sessionStorage: 'session storage',
    indexedDB: 'IndexedDB',
};
