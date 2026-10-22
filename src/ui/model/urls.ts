import { getEtld1 } from '@/lib/http-utils';
import type { TabSnapshot } from '@/types/snapshot';

export function pageUrl(snapshot: TabSnapshot): string | null {
    const frames = snapshot.frames.filter((f) => f !== null);
    return (frames.find((f) => f.frameId === '0') ?? frames[0])?.document.url ?? null;
}

export function pageHost(snapshot: TabSnapshot): string {
    const url = pageUrl(snapshot);
    return hostOf(url) || url || '';
}

/**
 * How to present a script recorded under `url`: the fp-recorder stores the caller's URL from the
 * stack trace, which is "null" when unknown, the document URL for inline code, or a blob:/data: URL
 * for code generated at runtime. `host` is the host the script belongs to, if any; `linkable` is
 * true for script files, `inline` for code inline in the page.
 */
export function describeScript(
    url: string,
    documentUrl: string | null
): { name: string; path: boolean; origin: string; host: string | null; linkable: boolean; inline: boolean } {
    if (url === 'null') {
        return { name: 'Unknown script', path: false, origin: 'Its source could not be determined', host: null, linkable: false, inline: false };
    }

    if (documentUrl && url === documentUrl) {
        const host = hostOf(url);
        return { name: 'Inline script', path: false, origin: `Embedded in ${host}`, host, linkable: false, inline: true };
    }

    // Code of a blank frame the page made and filled itself, and is recorded with (see
    // lib/recording-document): inline, but not in the page's source, so not shown there.
    if (/^about:/i.test(url)) {
        const host = documentUrl ? hostOf(documentUrl) : '';
        return { name: 'Inline script', path: false, origin: host ? `In a frame of ${host}` : 'In a frame', host: host || null, linkable: false, inline: false };
    }

    if (/^(blob|data):/i.test(url)) {
        // A blob: URL keeps the origin of the page that created it; a data: URL has none.
        let creator = '';
        try {
            creator = hostOf(new URL(url).origin);
        } catch {}
        const origin = creator ? `Created at runtime by ${creator}` : 'Created at runtime';
        return { name: 'Generated script', path: false, origin, host: creator || null, linkable: false, inline: false };
    }

    const host = hostOf(url);
    return {
        name: urlPath(url),
        path: true,
        origin: host,
        host: host || null,
        linkable: true,
        inline: false,
    };
}

/** The URL if it uses http or https. Script URLs come from page stack traces, so other schemes are not linked. */
export function linkableUrl(url: string): string | null {
    try {
        const { protocol } = new URL(url);
        return protocol === 'http:' || protocol === 'https:' ? url : null;
    } catch {
        return null;
    }
}

/** The URL's path, e.g. "/libs/launch-ENdd5c82….min.js"; its last segment is the file name. */
export function urlPath(url: string): string {
    return `/${pathSegments(url).join('/')}`;
}

function pathSegments(url: string): string[] {
    try {
        return new URL(url).pathname.split('/').filter(Boolean);
    } catch {
        return [];
    }
}

/** Hosts on the page that are CNAME-cloaked, each with the host it is really an alias for. */
export function cloakedHosts(snapshot: TabSnapshot): Map<string, string> {
    const aliases = new Map<string, string>();
    for (const req of snapshot.cNameRequests) {
        const host = req.hostname ?? hostOf(req.url);
        const target = req.cRecords?.[req.cRecords.length - 1]?.target;
        if (host && target && !aliases.has(host)) aliases.set(host, target);
    }
    return aliases;
}

/** The host a script came from, and the server it is an alias (CNAME) for if it is cloaked. */
export function originTitle(host: string | null, aliases: Map<string, string>): string {
    if (!host) return '';
    const target = aliases.get(host);
    return target ? `${host}, an alias (CNAME) for ${target}` : host;
}

/** The host a script really comes from: for a CNAME-cloaked host the server it points to, otherwise itself. */
export function realHost(host: string, aliases: Map<string, string>): string {
    return (aliases.get(host) ?? host).replace(/\.$/, '');
}

/**
 * The site a host really belongs to: for a CNAME-cloaked host the site of the server it points to,
 * since a first-party name doesn't tell who serves it; otherwise the host's own site.
 */
export function realSite(host: string | null, aliases: Map<string, string>): string | null {
    if (!host) return null;
    return getEtld1(aliases.get(host) ?? host);
}

export function hostOf(url: string | null | undefined): string {
    try {
        return new URL(url ?? '').hostname;
    } catch {
        return '';
    }
}
