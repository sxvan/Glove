// Like uBlock Origin's trusted sites: an entry is the host without a leading "www." and covers its
// subdomains, so off on www.tiktok.com covers login.tiktok.com, but not the other way round.
import { browser } from 'wxt/browser';
import { listOf, loadStored, watchStored } from './storage';
import { normalizeHostname } from './http-utils';

export interface OffSite {
    site: string;
    /** When it was turned off (ms since the epoch). */
    since: number;
}

const STORAGE_KEY = 'offSites';

function siteOf(host: string): string {
    return normalizeHostname(host).replace(/^www\./, '');
}

export function offEntryFor(host: string | null | undefined, sites: OffSite[]): OffSite | undefined {
    if (!host) return undefined;
    const name = normalizeHostname(host);
    return sites.find(({ site }) => name === site || name.endsWith(`.${site}`));
}

export function switchableHost(url: string | null | undefined): string | null {
    try {
        const { protocol, hostname } = new URL(url ?? '');
        return protocol === 'http:' || protocol === 'https:' ? hostname : null;
    } catch {
        return null;
    }
}

export async function loadOffSites(): Promise<OffSite[]> {
    return listOf(await loadStored(STORAGE_KEY));
}

// On again removes every entry covering `host`, as it may be off for a name it is under.
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

export async function removeOffSites(names: string[]): Promise<void> {
    const sites = (await loadOffSites()).filter(({ site }) => !names.includes(site));
    await browser.storage.local.set({ [STORAGE_KEY]: sites });
}

export function watchOffSites(onChange: (sites: OffSite[]) => void): () => void {
    return watchStored(STORAGE_KEY, (value) => onChange(listOf(value)));
}

export function matchPatternsOf(sites: OffSite[]): string[] {
    return sites.flatMap(({ site }) => [`*://${site}/*`, `*://*.${site}/*`]);
}
