import type { HttpRequest } from '@/types/analysis';
import type { DocumentSnapshot, MetricsSnapshot, SpikeSnapshot, TabSnapshot } from '@/types/snapshot';

export type Metrics = Partial<MetricsSnapshot>;
export type DotState = 'good' | 'warn' | 'bad' | 'muted';

export function isNum(x: unknown): x is number {
    return typeof x === 'number' && Number.isFinite(x);
}

export function fmtSeconds(ms: unknown): string {
    if (!isNum(ms)) return '—';
    return Math.max(0, ms / 1000).toFixed(0);
}

export function safeLen(arr: unknown): number {
    return Array.isArray(arr) ? arr.length : 0;
}

export function clamp01(x: unknown): number | null {
    if (!isNum(x)) return null;
    return Math.max(0, Math.min(1, x));
}

export function fmtDelta(ms: unknown): string {
    if (!isNum(ms)) return '—';
    const s = ms / 1000;
    return s >= 1 ? `${s.toFixed(2)}s` : `${ms.toFixed(0)}ms`;
}

export function fmtScore(score: unknown, digits = 2): string {
    return isNum(score) ? score.toFixed(digits) : '—';
}

export function fmtTime(ts: unknown): string {
    return isNum(ts) ? new Date(ts).toLocaleTimeString() : '—';
}

export function fmtTimeMs(ts: unknown): string {
    if (!isNum(ts)) return '—';
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
}

export function safeUrlParts(url: string): { host: string; path: string } {
    try {
        const u = new URL(url);
        return { host: u.host, path: (u.pathname || '/') + (u.search || '') };
    } catch {
        // fallback: keep it readable
        return { host: '', path: url ?? '' };
    }
}

export function getHostFromUrl(url: string | undefined): string {
    try {
        return new URL(url ?? '').host;
    } catch {
        return '';
    }
}

export function getPathFromUrl(url: string | undefined): string {
    try {
        const u = new URL(url ?? '');
        return (u.pathname || '/') + (u.search || '');
    } catch {
        return url ?? '';
    }
}

export function requestTitle(req: HttpRequest): string {
    return `${(req?.method || 'REQ').toUpperCase()} ${getPathFromUrl(req?.url)}`;
}

/** Only rows with a value are returned. */
export function presentRows(rows: [string, unknown][]): [string, string][] {
    return rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]);
}

export function importantRequestFields(req: HttpRequest): [string, string][] {
    const cRecords = req?.cRecords;
    return presentRows([
        ['Method', req?.method],
        ['URL', req?.url],
        ['Host', getHostFromUrl(req?.url)],
        ['Time', isNum(req?.timeStamp) ? new Date(req.timeStamp).toLocaleTimeString() : undefined],
        ['Frame ID', req?.frameId],
        ['Document ID', req?.documentId],
        ['Initiator', req?.initiator],
        ['Type', req?.type],
        ['CNAME destination', Array.isArray(cRecords) && cRecords.length ? cRecords[cRecords.length - 1]!.target : undefined],
    ]);
}

// Pick main frame deterministically (lowest numeric key)
export function pickMainDocument(snapshot: TabSnapshot | undefined): DocumentSnapshot | null {
    if (!snapshot?.frames) return null;
    const entries = Object.entries(snapshot.frames);
    if (!entries.length) return null;

    entries.sort(([a], [b]) => Number(a) - Number(b));
    return entries[0]?.[1]?.document ?? null;
}

export function scoreClass(score: unknown): string {
    if (!isNum(score)) return '';
    if (score >= 0.7) return 'bad';
    if (score >= 0.4) return 'warn';
    return 'good';
}

export function dnsScoreClass(score: unknown): string {
    if (!isNum(score)) return '';
    if (score > 0.6) return 'bad';
    if (score > 0.2) return 'warn';
    return 'good';
}

export const DOT_COLORS: Record<DotState, string> = {
    good: 'var(--good)',
    warn: 'var(--warn)',
    bad: 'var(--bad)',
    muted: 'var(--muted)',
};

export function humanFpSentence(m: Metrics | null): string {
    const intensity = m?.intensity ?? 0;
    const durationSec = fmtSeconds(m?.durationMs);
    const apis = safeLen(m?.distinctFpApis);
    const cats = safeLen(m?.distinctFpCategories);
    return `${intensity} events over ${durationSec} seconds using ${apis} fingerprint APIs across ${cats} different categories.`;
}

export function metricsSummary(m: Metrics): string {
    return `${m?.intensity ?? 0} events · ${fmtSeconds(m?.durationMs)}s · ${safeLen(m?.distinctFpApis)} APIs · ${safeLen(m?.distinctFpCategories)} cats`;
}

export function getSpikeMetrics(spike: SpikeSnapshot | null): Metrics {
    if (spike?.fpMetrics) return spike.fpMetrics;

    const ev = Array.isArray(spike?.events) ? spike.events : [];
    const intensity = ev.length;

    // best-effort duration if timestamp exists
    const ts = ev
        .map((e) => e?.timeStamp)
        .filter(isNum)
        .sort((a, b) => a - b);

    const durationMs = ts.length >= 2 ? ts[ts.length - 1]! - ts[0]! : 0;

    return {
        intensity,
        durationMs,
        density: durationMs > 0 ? intensity / (durationMs / 1000) : 0,
        distinctFpApis: [],
        distinctFpCategories: [],
    };
}

export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const item of items) {
        const k = key(item);
        const group = groups.get(k);
        if (group) group.push(item);
        else groups.set(k, [item]);
    }
    return groups;
}

/**
 * Pairs items with keys for keyed {#each} blocks, which keep an item's DOM (and so its open
 * accordions) across updates. Repeated keys get a counter suffix, since duplicates would throw.
 */
export function withUniqueKeys<T>(items: T[], key: (item: T) => string): { item: T; key: string }[] {
    const seen = new Map<string, number>();
    return items.map((item) => {
        const base = key(item);
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        return { item, key: count === 0 ? base : `${base}#${count}` };
    });
}

export function maxSubdomainScore(requests: HttpRequest[]): number {
    return requests.reduce((m, r) => Math.max(m, r?.subdomainScore ?? -1), -1);
}
