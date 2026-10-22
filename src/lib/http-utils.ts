import { getDomain } from 'tldts';

// Sites by the Public Suffix List, as browsers tell them apart: its private part included, so a
// customer's name under a hosting service (d1234.cloudfront.net, user.github.io) is a site of its
// own, as for the browser's cookies.
const PSL = { allowPrivateDomains: true };

export function normalizeHostname(name: string): string {
    return name.toLowerCase().replace(/\.$/, '');
}

// A host without a registrable domain, such as localhost or an IP address, is its own site.
export function getEtld1(hostname: string | null): string | null {
    if (!hostname) return null;
    const normalizedHostname = normalizeHostname(hostname);
    return getDomain(normalizedHostname, PSL) ?? normalizedHostname;
}

export function getHostname(urlOrHostname: string | null | undefined): string | null {
    if (!urlOrHostname) {
        return null;
    }

    if (/^[a-z0-9.-]+$/i.test(urlOrHostname) && !urlOrHostname.includes('://')) {
        return urlOrHostname;
    }

    try {
        return new URL(urlOrHostname).hostname;
    } catch {
        return null;
    }
}
