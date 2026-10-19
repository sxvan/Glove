import { getDomain, getSubdomain } from 'tldts';
import type { DnsAnswer } from '@/types/analysis';
import { combine, type ScoringSettings } from './scoring';

// Sites by the Public Suffix List, as browsers tell them apart: its private part included, so a
// customer's name under a hosting service (d1234.cloudfront.net, user.github.io) is a site of its
// own, as for the browser's cookies.
const PSL = { allowPrivateDomains: true };

/**
 * The site a host belongs to, its registrable domain: shop.example.co.uk is example.co.uk. A host
 * without one, such as localhost or an IP address, is its own site.
 */
export function getEtld1(hostname: string | null): string | null {
    if (!hostname) return null;
    const normalizedHostname = normalizeHostname(hostname);
    return getDomain(normalizedHostname, PSL) ?? normalizedHostname;
}

export function isSameEtld1(hostA: string | null, hostB: string | null): boolean {
    const etld1A = getEtld1(hostA);
    const etld1B = getEtld1(hostB);

    return etld1A === etld1B;
}

export function isCrossOrigin(documentUrl: string | null, requestUrl: string | null): boolean {
    const docOrigin = getOriginSafe(documentUrl);
    const reqOrigin = getOriginSafe(requestUrl);

    // If we can't determine origins, treat as cross-origin / not eligible for cloaking
    if (!docOrigin || !reqOrigin) return true;

    return docOrigin !== reqOrigin;
}

export function getHostname(urlOrHostname: string | null | undefined): string | null {
    if (!urlOrHostname) {
        return null;
    }

    // 1) If it already looks like a hostname, return it directly
    if (/^[a-z0-9.-]+$/i.test(urlOrHostname) && !urlOrHostname.includes('://')) {
        return urlOrHostname;
    }

    // 2) Otherwise, try to parse as a URL
    try {
        return new URL(urlOrHostname).hostname;
    } catch (e) {
        console.warn('Invalid URL:', urlOrHostname);
        return null;
    }
}

function getOriginSafe(urlOrHostname: string | null): string | null {
    if (!urlOrHostname) return null;

    // If it looks like a bare hostname, assume https://
    if (/^[a-z0-9.-]+$/i.test(urlOrHostname) && !urlOrHostname.includes('://')) {
        urlOrHostname = 'https://' + urlOrHostname;
    }

    try {
        const u = new URL(urlOrHostname);

        // ignore opaque origins like about:, data:, blob: etc
        if (u.origin === 'null') return null;

        return u.origin; // scheme + host + port
    } catch (e) {
        console.warn('Invalid URL in getOriginSafe:', urlOrHostname);
        return null;
    }
}

export function normalizeHostname(name: string | null): string {
    if (!name) return '';
    return name.toLowerCase().replace(/\.$/, '');
}

export function getDnsMetrics(dnsEntry: DnsAnswer[]) {
    const aRecords: string[] = [];
    const cRecords: string[] = [];
    const chain: string[] = [];

    for (const answer of dnsEntry) {
        chain.push(answer.name);
        if (answer.type === 1) {
            aRecords.push(answer.name);
        } else if (answer.type === 5) {
            cRecords.push(answer.name);
        }
    }

    return {
        chain,
        aRecords,
        cRecords,
        cNameDepth: cRecords.length,
        isSameEtld1: dnsEntry.length > 0 ? isSameEtld1(dnsEntry[0]!.name, dnsEntry[dnsEntry.length - 1]!.name) : null,
    };
}

function normalizedEntropy(str: string): number {
    if (!str || str.length === 0) return 0;

    const freq: Record<string, number> = {};
    for (const c of str) freq[c] = (freq[c] || 0) + 1;

    let entropy = 0;
    const len = str.length;

    for (const c in freq) {
        const p = freq[c]! / len;
        entropy -= p * Math.log2(p);
    }

    const maxEntropy = Math.log2(Object.keys(freq).length);
    return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

function charRatio(str: string, regex: RegExp): number {
    const matches = str.match(regex);
    return matches ? matches.length / str.length : 0;
}

function clamp(v: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, v));
}

function isBaseLike(label: string): boolean {
    if (label.length < 16) return false;

    return (
        /^[a-f0-9]{16,}$/i.test(label) || // hex
        /^[a-z2-7]{16,}$/i.test(label) || // base32
        /^[a-z0-9_-]{16,}$/i.test(label) || // base64url-ish
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(label) // UUID
    );
}

/**
 * How much a subdomain looks like it carries an ID, from 0 to 1, judged by its longest part:
 * randomness, digits, vowels, encoded-looking parts, length and hyphens (see scoring).
 */
export function scoreSubdomainEntropy(subdomain: string | null, settings: ScoringSettings): number {
    if (!subdomain) return 0;

    const labels = subdomain.split('.').filter(Boolean);
    if (labels.length === 0) return 0;

    const longestLabel = labels.reduce((a, b) => (a.length > b.length ? a : b));
    const longedLabelLength = longestLabel.length;

    // ---------- entropy ----------
    const normalizedEntropyScore = normalizedEntropy(longestLabel);

    // ---------- ratios ----------
    const digitRatio = charRatio(longestLabel, /[0-9]/g);
    const vowelRatio = charRatio(longestLabel, /[aeiou]/gi);
    const hyphenRatio = charRatio(longestLabel, /-/g);

    // ---------- regex-based token detection ----------
    const looksLikeEncodedIdentifier = labels.some(isBaseLike) ? 1 : 0;

    // ---------- length gate ----------
    const lengthActivationFactor = clamp((longedLabelLength - 10) / 20, 0, 1);

    return combine(
        'hostname',
        {
            randomness: normalizedEntropyScore * lengthActivationFactor,
            digits: clamp((digitRatio - 0.35) / 0.35, 0, 1),
            fewVowels: clamp((0.25 - vowelRatio) / 0.25, 0, 1),
            encodedId: looksLikeEncodedIdentifier,
            length: clamp((longedLabelLength - 25) / 25, 0, 1),
            hyphens: clamp((hyphenRatio - 0.05) / 0.15, 0, 1),
        },
        settings
    );
}

/** The part of a hostname before its site (see getEtld1): "a.b" of a.b.example.co.uk; null without one. */
export function extractSubdomain(hostname: string | null): string | null {
    if (!hostname) return null;
    return getSubdomain(normalizeHostname(hostname), PSL) || null;
}
