// What the popup says about a script, as statements: the info lines of its card, which are also
// the sections of its page.
import { bytes, listWords, plural } from './format';
import type { ScriptDetail } from './model';
import type { TextPart } from './text-parts';

/** A statement about a script, shown as an info line: the card's rating is its only judgment, in color. */
export interface Statement {
    key: string;
    /** The heading, with its values marked to be emphasized: counts with what they count ("27 fingerprinting APIs"), sizes, sites. */
    text: TextPart[];
    /** Below the text without an icon, e.g. the kinds of detail under "Read 40 fingerprinting APIs". */
    detail?: string;
}

/**
 * What the card says about a script, as a list of statements: what it read (always there, and
 * always first), how (signs of fingerprinting), who is behind it if that is hidden, and where
 * it sent data right after.
 */
export function statements(script: ScriptDetail): Statement[] {
    // The most identifying kinds first, so those named are the ones that matter most.
    const kinds = listWords(
        script.learned.map(({ kind }) => kind.toLowerCase()),
        SHOWN_KINDS
    );
    const list: Statement[] = [
        {
            key: 'read',
            text: ['Read ', { value: plural(script.apis.length, 'fingerprinting API') }, ' in ', { value: plural(script.calls, 'call') }],
            detail: kinds ? `About ${kinds}` : '',
        },
    ];
    // The signs say what their APIs are about like the first line: "About graphics card, …".
    for (const signal of script.signals) {
        const about = listWords(
            signal.kinds.map((kind) => kind.toLowerCase()),
            SHOWN_KINDS
        );
        list.push({ key: signal.id, text: [{ value: plural(signal.count, 'API') }, ` ${signal.rest}`], detail: about ? `About ${about}` : '' });
    }
    // A CNAME-cloaked script: served from an address of the site that is an alias for another company.
    if (script.via) {
        list.push({
            key: 'cloaked',
            text: ['Served by ', { value: script.origin }, ' through ', { value: script.via }],
            detail: script.aliasOf ? `${script.via} alias for ${script.aliasOf}` : '',
        });
    }
    const sent = sentStatement(script);
    if (sent) list.push(sent);
    const alias = sentThroughAliasStatement(script);
    if (alias) list.push(alias);
    return list;
}

// Items named in a list under a statement, the rest as "and N more": kinds of detail are short
// words, sites long names, so fewer of them fit in about two lines.
const SHOWN_KINDS = 6;
const SHOWN_SITES = 4;

/**
 * All the requests with data in one line, the sites below it, the most data first: "Sent 6 KB to
 * 3 sites right after reading" over "To digitec.ch, doubleclick.net, google.com", like "About …"
 * under what it read; past SHOWN_SITES, "and N more". A single site is named in the line itself.
 * Aliases the data went through have a line of their own (see sentThroughAliasStatement). Only
 * requests from a burst until shortly after it count (see fp-analysis); the requests themselves
 * are for a screen of their own.
 */
function sentStatement(script: ScriptDetail): Statement | null {
    const bySite = new Map<string, number>();
    for (const { site, bytes } of script.sent) bySite.set(site, (bySite.get(site) ?? 0) + bytes);
    const sites = [...bySite.entries()].map(([site, total]) => ({ site, total })).sort((a, b) => b.total - a.total);
    if (sites.length === 0) return null;

    const total = bytes(sites.reduce((sum, site) => sum + site.total, 0));
    if (sites.length === 1) {
        return { key: 'sent', text: ['Sent ', { value: total }, ' to ', { value: sites[0]!.site }, ' right after reading'] };
    }
    return {
        key: 'sent',
        text: ['Sent ', { value: total }, ' to ', { value: plural(sites.length, 'site') }, ' right after reading'],
        detail: `To ${listWords(
            sites.map(({ site }) => site),
            SHOWN_SITES
        )}`,
    };
}

/**
 * The site's own addresses that data went through to another site, as CNAME aliases, written like
 * the sites under "Sent …": "Sent data through smetrics.walgreens.com alias" over "To omtrdc.net
 * (through smetrics.walgreens.com)", several as "Sent data through 2 aliases" over "To omtrdc.net
 * (through smetrics.walgreens.com and target.walgreens.com)", the rest as "and N more". Cookies
 * sent there count as the site's own (see the sentThroughAlias signal).
 */
function sentThroughAliasStatement(script: ScriptDetail): Statement | null {
    // The aliases by the site they lead to.
    const bySite = new Map<string, string[]>();
    for (const { site, via } of script.sent) {
        if (!via) continue;
        const vias = bySite.get(site) ?? [];
        if (!vias.includes(via)) vias.push(via);
        bySite.set(site, vias);
    }
    const aliases = [...bySite.values()].flat();
    if (aliases.length === 0) return null;

    const detail = `To ${listWords(
        [...bySite].map(([site, vias]) => `${site} (through ${listWords(vias, SHOWN_SITES)})`),
        SHOWN_SITES
    )}`;
    const text: TextPart[] =
        aliases.length === 1
            ? ['Sent data through ', { value: aliases[0]! }, ' alias']
            : ['Sent data through ', { value: plural(aliases.length, 'alias', 'aliases') }];
    return { key: 'sent-alias', text, detail };
}
