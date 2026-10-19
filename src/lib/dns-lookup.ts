// Looks up a host's DNS records, for the CNAME aliases it may hide behind (see http-analysis), over
// DNS over HTTPS (RFC 8484) at Quad9: a non-profit resolver that doesn't store IP addresses. Chrome
// gives extensions no access to the browser's own resolver, so this is a query of its own; only
// made when the user turned DNS lookups on (see lib/privacy). The query and answer are DNS's own
// binary messages (RFC 1035), built and read here.
import type { DnsAnswer, DnsResult } from '@/types/analysis';
import { getEtld1, getHostname } from './http-utils';

const RESOLVER = 'https://dns.quad9.net/dns-query';

const TYPE_A = 1;
const TYPE_CNAME = 5;
const CLASS_IN = 1;
const RCODE_SERVFAIL = 2;

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

    // Asking for its address: the resolver answers with the CNAME chain leading to it.
    const resp = await fetch(`${RESOLVER}?dns=${base64Url(queryMessage(hostname, TYPE_A))}`, {
        method: 'GET',
        headers: { accept: 'application/dns-message' },
    });
    if (!resp.ok) {
        throw new Error(`DNS lookup for ${hostname} failed with HTTP ${resp.status}`);
    }

    const { rcode, answers } = readMessage(new Uint8Array(await resp.arrayBuffer()));
    // SERVFAIL is temporary, so it is reported as an error and the lookup can be retried.
    if (rcode === RCODE_SERVFAIL) {
        throw new Error(`DNS lookup for ${hostname} failed (SERVFAIL)`);
    }

    // No answers (e.g. NXDOMAIN, or no records of the requested type) is a valid result without CNAMEs.
    return enrichDnsAnswer(answers, hostname);
}

/** A query for `type` records of `name`: id 0, as RFC 8484 asks for caching; recursion desired. */
function queryMessage(name: string, type: number): Uint8Array {
    const labels = name.replace(/\.$/, '').split('.').map((label) => new TextEncoder().encode(label));
    const message = new Uint8Array(12 + labels.reduce((sum, label) => sum + 1 + label.length, 0) + 1 + 4);
    const view = new DataView(message.buffer);
    view.setUint16(2, 0x0100); // flags: recursion desired
    view.setUint16(4, 1); // one question
    let at = 12;
    for (const label of labels) {
        message[at++] = label.length;
        message.set(label, at);
        at += label.length;
    }
    message[at++] = 0;
    view.setUint16(at, type);
    view.setUint16(at + 2, CLASS_IN);
    return message;
}

/** The response code and the answer records of a DNS message, CNAMEs and addresses as text. */
function readMessage(message: Uint8Array): { rcode: number; answers: DnsAnswer[] } {
    const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
    const rcode = view.getUint16(2) & 0x000f;
    const questions = view.getUint16(4);
    const answerCount = view.getUint16(6);
    let at = 12;
    for (let i = 0; i < questions; i++) at = readName(message, at).next + 4;

    const answers: DnsAnswer[] = [];
    for (let i = 0; i < answerCount; i++) {
        const { name, next } = readName(message, at);
        const type = view.getUint16(next);
        const ttl = view.getUint32(next + 4);
        const length = view.getUint16(next + 8);
        const data = next + 10;
        if (type === TYPE_CNAME) answers.push({ name, type, TTL: ttl, data: readName(message, data).name });
        else if (type === TYPE_A && length === 4) answers.push({ name, type, TTL: ttl, data: [...message.subarray(data, data + 4)].join('.') });
        at = data + length;
    }
    return { rcode, answers };
}

/**
 * A domain name at `offset`, as labels or a pointer to an earlier name (compression), with a dot at
 * the end like the JSON APIs give it; and where the message goes on after it.
 */
function readName(message: Uint8Array, offset: number): { name: string; next: number } {
    const labels: string[] = [];
    let at = offset;
    let next = -1;
    // Pointers only point backwards, so a name is read in few steps; more is a malformed message.
    for (let steps = 0; steps < 128; steps++) {
        const length = message[at] ?? 0;
        if ((length & 0xc0) === 0xc0) {
            if (next < 0) next = at + 2;
            at = ((length & 0x3f) << 8) | (message[at + 1] ?? 0);
            continue;
        }
        if (length === 0) return { name: `${labels.join('.')}.`, next: next < 0 ? at + 1 : next };
        labels.push(new TextDecoder().decode(message.subarray(at + 1, at + 1 + length)));
        at += 1 + length;
    }
    throw new Error('Malformed DNS name');
}

/** Base64url without padding, as RFC 8484 sends a query in a URL. */
function base64Url(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function enrichDnsAnswer(dnsAnswer: DnsAnswer[], hostname: string): DnsResult {
    const cRecords = dnsAnswer
        .filter((entry) => entry.type === TYPE_CNAME)
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
