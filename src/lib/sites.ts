// Sites the user turned the extension off for: there it records, scores and blocks nothing, and its
// recorders aren't even in the page, so the site loads as without the extension. Like uBlock Origin's
// trusted sites: an entry is the page's host without a leading "www.", and covers that name and all
// its subdomains, so turning it off on www.tiktok.com covers tiktok.com and login.tiktok.com too,
// while turning it off on login.tiktok.com covers only that one and its subdomains.
import { browser } from 'wxt/browser';

export interface OffSite {
    /** The name it covers, with its subdomains (see siteOf). */
    site: string;
    /** When it was turned off (ms since the epoch). */
    since: number;
}

const STORAGE_KEY = 'offSites';

/** The entry turning the extension off on `host` makes: the host without a leading "www.". */
export function siteOf(host: string): string {
    return host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

/** The entry that turns the extension off on `host`, if any: the host itself or one it is a subdomain of. */
export function offEntryFor(host: string | null | undefined, sites: OffSite[]): OffSite | undefined {
    if (!host) return undefined;
    const name = host.toLowerCase().replace(/\.$/, '');
    return sites.find(({ site }) => name === site || name.endsWith(`.${site}`));
}

/** The host of an http(s) address, which the extension can be turned off for; null for others. */
export function switchableHost(url: string | null | undefined): string | null {
    try {
        const { protocol, hostname } = new URL(url ?? '');
        return protocol === 'http:' || protocol === 'https:' ? hostname : null;
    } catch {
        return null;
    }
}

export async function loadOffSites(): Promise<OffSite[]> {
    const stored = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    return Array.isArray(stored) ? (stored as OffSite[]) : [];
}

/**
 * Turns the extension off on `host` (see siteOf), or on again: then every entry covering it is
 * removed, as it was turned off for one of the names it is under.
 */
export async function setSiteOff(host: string, off: boolean): Promise<void> {
    let sites = await loadOffSites();
    if (off) {
        const site = siteOf(host);
        sites = [...sites.filter((entry) => entry.site !== site), { site, since: Date.now() }];
    } else {
        for (let entry = offEntryFor(host, sites); entry; entry = offEntryFor(host, sites)) {
            const covering = entry;
            sites = sites.filter((other) => other !== covering);
        }
    }
    await browser.storage.local.set({ [STORAGE_KEY]: sites });
}

/** Turns the extension on again for these entries, e.g. from the settings. */
export async function removeOffSites(names: string[]): Promise<void> {
    const sites = (await loadOffSites()).filter(({ site }) => !names.includes(site));
    await browser.storage.local.set({ [STORAGE_KEY]: sites });
}

/** Calls `onChange` with the list whenever it changes. */
export function watchOffSites(onChange: (sites: OffSite[]) => void): () => void {
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
        if (area === 'local' && STORAGE_KEY in changes) onChange(Array.isArray(changes[STORAGE_KEY]!.newValue) ? (changes[STORAGE_KEY]!.newValue as OffSite[]) : []);
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
}

/** The match patterns of the entries: each name, and all its subdomains. */
export function matchPatternsOf(sites: OffSite[]): string[] {
    return sites.flatMap(({ site }) => [`*://${site}/*`, `*://*.${site}/*`]);
}
