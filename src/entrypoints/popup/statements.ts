// What the popup says about a script, as statements: the info lines of its card, which are also
// the sections of its page.
import { EVERYONE_BITS } from '@/lib/scoring';
import { bytes, listWords, plural, roughCount } from './format';
import { identifyingBits, type ScriptDetail } from './model';
import type { TextPart } from './text-parts';
import type { StorageKind } from '@/types/snapshot';

/** A statement about a script, shown as an info line: the card's rating is its only judgment, in color. */
interface Statement {
    key: string;
    /** The heading, with its values marked to be emphasized: counts with what they count ("27 fingerprinting APIs"), sizes, sites. */
    text: TextPart[];
    /** Below the text without an icon, e.g. the kinds of detail under "Read 40 fingerprinting APIs". */
    detail?: string;
    /** How it is measured, shown in a tip (see InfoTip). */
    explanation?: string;
}

/**
 * What the card says about a script, as a list of statements: what it read (always there, and
 * always first) and how identifying that is together, how (signs of fingerprinting), who is behind it if that is hidden, and where
 * it sent data right after.
 */
export function statements(script: ScriptDetail): Statement[] {
    // Nothing read yet: not recorded, or recorded without any fingerprinting API read; requests
    // through an alias are worth telling even so.
    if (script.apis.length === 0) {
        const alias = sentThroughAliasStatement(script);
        return [{ key: 'read', text: [script.likelihood === 'unknown' ? 'Not checked yet' : 'No fingerprinting APIs read so far'] }, ...(alias ? [alias] : [])];
    }
    // The most identifying kinds first, so those named are the ones that matter most.
    const kinds = listWords(
        script.learned.map(({ kind }) => kind.toLowerCase()),
        SHOWN_KINDS
    );
    const list: Statement[] = [
        {
            key: 'read',
            // Past a limit of calls kept (see lib/limits), at least that many.
            text: ['Read ', { value: plural(script.apis.length, 'fingerprinting API') }, ' in ', { value: script.capped ? `${script.calls}+ calls` : plural(script.calls, 'call') }],
            detail: kinds ? `About ${kinds}` : '',
            explanation:
                'Fingerprinting APIs are the browser\u2019s features that reveal details of the device, such as the graphics card, the screen or the fonts. Every call to them is noted with the script that made it. Ordinary scripts read some too: what counts toward the score is how rare and identifying they are. The kinds of detail are named the most identifying first.',
        },
    ];
    const identifying = identifyingStatement(script);
    if (identifying) list.push(identifying);
    // The signs say what their APIs are about like the first line: "About graphics card, …".
    for (const signal of script.signals) {
        const about = listWords(
            signal.kinds.map((kind) => kind.toLowerCase()),
            SHOWN_KINDS
        );
        list.push({ key: signal.id, text: [{ value: plural(signal.count, 'API') }, ` ${signal.rest}`], detail: about ? `About ${about}` : '', explanation: signal.explanation });
    }
    // A CNAME-cloaked script: served from an address of the site that is an alias for another company.
    if (script.via) {
        list.push({
            key: 'cloaked',
            text: ['Served by ', { value: script.origin }, ' through ', { value: script.via }],
            detail: script.via ? `${script.via} is an address of the site that is an alias (CNAME) for it` : '',
            explanation:
                'The script comes from an address of the site itself, but that address is an alias (a CNAME record) for another company\u2019s server. The browser then treats the tracker as part of the site: its cookies count as the site\u2019s own, and blockers that go by the address miss it.',
        });
    }
    const sent = sentStatement(script);
    if (sent) list.push(sent);
    const alias = sentThroughAliasStatement(script);
    if (alias) list.push(alias);
    const stored = storedStatement(script);
    if (stored) list.push(stored);
    return list;
}

/** Where values are stored, as named under "Stored …": cookies by count, other storage by place. */
export const STORAGE_WORDS: Record<StorageKind, string> = {
    cookie: 'cookie',
    localStorage: 'local storage',
    sessionStorage: 'session storage',
    indexedDB: 'IndexedDB',
};

/**
 * What the script wrote to cookies and storage, where it could keep what it computed. With
 * identifiers (see findIdentifier), the most likely ones: "Stored 2 likely identifiers in the
 * browser" over "1 cookie and 1 in local storage, besides 1 possible identifier and 2 other
 * values"; without, all: "Stored 3 values in the browser" over "2 cookies and 1 in local storage".
 */
/** How "Stored …" is judged, for its tip. */
const STORED_EXPLANATION =
    'Values the script wrote to cookies and the page\u2019s storage, as recorded when written. An identifier stored there lets a script recognize the browser on later visits without fingerprinting again, and a cookie keeps being sent after the script is blocked. A possible identifier is kept long enough (a cookie for 3 months by default; local storage until cleared) and holds a part of 8 to 200 characters with a digit; a likely one is also stored in another place, to restore it from there, or stored right after a fingerprinting burst.';

function storedStatement(script: ScriptDetail): Statement | null {
    if (script.stored.length === 0) return null;
    const likely = script.stored.filter((item) => item.identifier === 'likely');
    const possible = script.stored.filter((item) => item.identifier === 'possible');
    const shown = likely.length > 0 ? likely : possible;
    if (shown.length === 0) {
        return { key: 'stored', text: ['Stored ', { value: plural(script.stored.length, 'value') }, ' in the browser'], detail: storagePlaces(script.stored), explanation: STORED_EXPLANATION };
    }
    const others = script.stored.length - likely.length - possible.length;
    const besides = [
        likely.length > 0 && possible.length > 0 ? plural(possible.length, 'possible identifier') : '',
        others > 0 ? plural(others, 'other value') : '',
    ].filter(Boolean);
    return {
        key: 'stored',
        text: ['Stored ', { value: plural(shown.length, `${likely.length > 0 ? 'likely' : 'possible'} identifier`) }, ' in the browser'],
        detail: `${storagePlaces(shown)}${besides.length > 0 ? `, besides ${listWords(besides)}` : ''}`,
        explanation: STORED_EXPLANATION,
    };
}

/** Where items are, by count: "2 cookies and 1 in local storage". */
function storagePlaces(items: { kind: StorageKind }[]): string {
    const counts = new Map<StorageKind, number>();
    for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    return listWords([...counts.entries()].map(([kind, count]) => (kind === 'cookie' ? plural(count, 'cookie') : `${count} in ${STORAGE_WORDS[kind]}`)));
}

/**
 * Statements shown in one section of the script's page together, each under its own line, as they
 * are about the same: how identifying what it read is, is part of what it read; and the signs in
 * how the code reads (generated code, one place) go together, whichever of them shows. On the card,
 * lines of one section share one way to it (see FingerprintCard). Others have a section of their
 * own, by their key.
 */
const SECTIONS: Record<string, string> = {
    identifying: 'read',
    'generated-code': 'code',
    'one-place': 'code',
};

/** The section of the script's page a statement is shown in, by its key. */
export function sectionOf(key: string): string {
    return SECTIONS[key] ?? key;
}

/** The statements by the section they are shown in, each section where its first statement is. */
export function bySection(list: Statement[]): Statement[][] {
    const sections = new Map<string, Statement[]>();
    for (const statement of list) {
        const section = sectionOf(statement.key);
        sections.set(section, [...(sections.get(section) ?? []), statement]);
    }
    return [...sections.values()];
}

// Items named in a list under a statement, the rest as "and N more": kinds of detail are short
// words, sites long names, so fewer of them fit in about two lines. One more than these is named in
// full rather than as "and 1 more" (see listWords): up to 4 sites, from 5 on 3 and the rest.
const SHOWN_KINDS = 6;
const SHOWN_SITES = 3;

/**
 * How identifying all it read is together, in bits (see identifyingBits): "Up to 18 bits of
 * identifying information" over "One browser in about 260,000". "Up to", as details still overlap
 * beyond what the sum takes into account. From EVERYONE_BITS on, enough to single out anyone instead
 * of a count past the people online. None under a bit: hardly anything to tell.
 */
function identifyingStatement(script: ScriptDetail): Statement | null {
    const bits = Math.round(identifyingBits(script.apiDetails));
    if (bits < 1) return null;
    return {
        key: 'identifying',
        text: ['Up to ', { value: plural(bits, 'bit') }, ' of identifying information'],
        detail: bits >= EVERYONE_BITS ? 'Enough to single out one browser among everyone online' : `One browser in about ${roughCount(2 ** bits)}`,
        explanation: `The bits of each API read, added up, those revealing the same value once. Of details that overlap, such as the screen's and the window's sizes, or the user agent and the platform, the strongest counts fully and the others only what they add beyond it, as measured on 4 million fingerprints. Overlaps between other details remain, so the real figure is lower. ${EVERYONE_BITS} bits tell apart everyone online, about 5 billion people.`,
    };
}

/**
 * All the requests with data in one line, the sites below it, the most data first: "Sent 6 KB to
 * 3 sites right after reading" over "To digitec.ch, doubleclick.net, google.com", like "About …"
 * under what it read; past SHOWN_SITES, "and N more". A single site is named in the line itself.
 * Aliases the data went through have a line of their own (see sentThroughAliasStatement). Only
 * requests from a burst until shortly after it count (see fp-analysis), and only after bursts that
 * are possible fingerprinting on their own (see fingerprintingDetails); the requests themselves
 * are for a screen of their own.
 */
/** How "Sent …" is measured, for its tip. */
const SENT_EXPLANATION =
    'Requests with data the script made during a burst of fingerprinting API calls, or right after it (\u201cRight after\u201d in the settings, 1 second by default), counted after bursts that are possible fingerprinting on their own. Collected details are usually sent right after collecting them. The size is what the request carries: its URL\u2019s parameters and its body.';

function sentStatement(script: ScriptDetail): Statement | null {
    const bySite = new Map<string, number>();
    for (const { site, bytes } of script.sent) bySite.set(site, (bySite.get(site) ?? 0) + bytes);
    const sites = [...bySite.entries()].map(([site, total]) => ({ site, total })).sort((a, b) => b.total - a.total);
    if (sites.length === 0) return null;

    const total = bytes(sites.reduce((sum, site) => sum + site.total, 0));
    if (sites.length === 1) {
        return { key: 'sent', text: ['Sent ', { value: total }, ' to ', { value: sites[0]!.site }, ' right after reading'], explanation: SENT_EXPLANATION };
    }
    return {
        key: 'sent',
        text: ['Sent ', { value: total }, ' to ', { value: plural(sites.length, 'site') }, ' right after reading'],
        detail: `To ${listWords(
            sites.map(({ site }) => site),
            SHOWN_SITES
        )}`,
        explanation: SENT_EXPLANATION,
    };
}

/**
 * The site's own addresses that requests went through to another site, as CNAME aliases, at any
 * time, written like the sites under "Sent …": "Sent data through smetrics.walgreens.com alias" over
 * "To omtrdc.net (through smetrics.walgreens.com)", several as "Sent data through 2 aliases" over "To
 * omtrdc.net (through smetrics.walgreens.com and target.walgreens.com)", the rest as "and N more".
 * Not only right after reading: a tracker hiding behind the site's name is worth seeing whenever it
 * is sent to; the score counts only those right after reading (see the sentThroughAlias signal).
 */
function sentThroughAliasStatement(script: ScriptDetail): Statement | null {
    // The aliases by the site they lead to.
    const bySite = new Map<string, string[]>();
    for (const { site, host: via } of script.aliased) {
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
    return {
        key: 'sent-alias',
        text,
        detail,
        explanation:
            'Requests went to an address of the site that is an alias (a CNAME record) for another company\u2019s server, which hides the other company behind the site\u2019s name. The browser sends the site\u2019s cookies there as its own, often including the login, so the other company gets them too, and blockers that only know the other company miss it.',
    };
}
