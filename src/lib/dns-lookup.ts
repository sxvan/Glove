import type { DnsAnswer, DnsResult } from '@/types/analysis';
import { getEtld1, getHostname } from './http-utils';

export async function dnsLookup(url: string | null): Promise<DnsResult> {
    const hostname = getHostname(url);
    if (!hostname) {
        throw new Error(`Cannot resolve DNS for invalid URL: ${url}`);
    }

    if (hostname.endsWith('.test')) {
        const testDnsData: DnsAnswer[] = [
            { name: 'tracker.site.test.', type: 5, TTL: 3600, data: 'tracker.test.' },
            { name: 'tracker.test.', type: 1, TTL: 3600, data: '127.0.0.1' },
        ];

        return enrichDnsAnswer(testDnsData, hostname);
    }

    const lookupUrl = `https://dns.google/resolve?name=${hostname}`;

    const resp = await fetch(lookupUrl, {
        method: 'GET',
        headers: {
            accept: 'application/dns-json',
        },
    });

    const answer: DnsAnswer[] = (await resp.json()).Answer;
    const enrichedAnswer = enrichDnsAnswer(answer, hostname);

    return enrichedAnswer;
}

export function enrichDnsAnswer(dnsAnswer: DnsAnswer[], hostname: string): DnsResult {
    const cRecords = dnsAnswer
        .filter((entry) => entry.type === 5)
        .map((entry) => ({
            source: entry.name.replace(/\.$/, ''),
            target: entry.data.replace(/\.$/, ''),
        }));

    const lastCname = cRecords.at(-1);
    const finalDomain = lastCname ? lastCname.target : hostname;

    return {
        hostname,
        cRecords,
        cNameDepth: cRecords.length,
        eTld1: getEtld1(hostname),
        finalEtld1: getEtld1(finalDomain),
    };
}
