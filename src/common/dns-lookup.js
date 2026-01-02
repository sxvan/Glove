import { extractSubdomain, getEtld1, getHostname, scoreSubdomainEntropy } from './http-utils.js';

export async function dnsLookup(url) {
    const hostname = getHostname(url);
    const lookupUrl = `https://dns.google/resolve?name=${hostname}`;

    const resp = await fetch(lookupUrl, {
        method: 'GET',
        headers: {
            accept: 'application/dns-json',
        },
    });

    const answer = (await resp.json()).Answer;
    const enrichedAnswer = enrichDnsAnswer(answer, hostname);

    return enrichedAnswer;
}

export function enrichDnsAnswer(dnsAnswer, hostname) {
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
