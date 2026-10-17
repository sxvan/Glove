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
