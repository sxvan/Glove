/**
 * Items as words, the last after "and": "a, b and c". Past `shown` items, the rest are counted:
 * "a, b, c and 5 more". A single item left over is named instead of "and 1 more".
 */
export function listWords(items: string[], shown = Infinity): string {
    const named = items.length > shown + 1 ? items.slice(0, shown) : items;
    const more = items.length - named.length;
    const last = more > 0 ? `${more} more` : named[named.length - 1];
    const before = more > 0 ? named : named.slice(0, -1);
    return before.length > 0 ? `${before.join(', ')} and ${last}` : (last ?? '');
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** A short duration, e.g. "85 ms" or "1.4 s"; under a millisecond counts as 1 ms. */
export function duration(ms: number): string {
    return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** A data size, e.g. "512 B" or "4.2 KB". */
export function bytes(count: number): string {
    return count < 1024 ? `${count} B` : `${(count / 1024).toFixed(1)} KB`;
}
