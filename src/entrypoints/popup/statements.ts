// The info lines of a script's card, each leading to a table of the details page (see tableOf).
import { EVERYONE_BITS } from '@/lib/scoring';
import { bytes, listWords, plural, roughCount, STORAGE_WORDS } from '@/ui/format';
import { identifyingBits, type ScriptDetail } from '@/ui/model';
import type { TextPart } from '@/ui/text-parts';
import type { StorageKind } from '@/types/snapshot';

// Only facts: the card's rating is its only judgment.
interface Statement {
    key: string;
    text: TextPart[];
    detail?: string;
    /** How it is measured, for its tip. */
    explanation?: string;
}

export function statements(script: ScriptDetail): Statement[] {
    // Requests through an alias are worth telling even so.
    if (script.apis.length === 0) {
        const alias = sentThroughAliasStatement(script);
        return [{ key: 'read', text: [script.likelihood === 'unknown' ? 'Not checked yet' : 'No fingerprinting APIs read so far'] }, ...(alias ? [alias] : [])];
    }
    const kinds = listWords(
        script.learned.map(({ kind }) => kind.toLowerCase()),
        SHOWN_KINDS
    );
    const list: Statement[] = [
        {
            key: 'read',
            text: ['Read ', { value: plural(script.apis.length, 'fingerprinting API') }, ' in ', { value: script.capped ? `${script.calls}+ calls` : plural(script.calls, 'call') }],
            detail: kinds ? `About ${kinds}` : '',
            explanation:
                'Fingerprinting APIs are the browser\u2019s features that reveal details of the device, such as the graphics card, the screen or the fonts. Every call to them is noted with the script that made it. Ordinary scripts read some too: what counts toward the score is how rare and identifying they are. The kinds of detail are named the most identifying first.',
        },
    ];
    const identifying = identifyingStatement(script);
    if (identifying) list.push(identifying);
    for (const signal of script.signals) {
        const about = listWords(
            signal.kinds.map((kind) => kind.toLowerCase()),
            SHOWN_KINDS
        );
        list.push({ key: signal.id, text: [{ value: plural(signal.count, 'API') }, ` ${signal.rest}`], detail: about ? `About ${about}` : '', explanation: signal.explanation });
    }
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

const STORED_EXPLANATION =
    'Values the script wrote to cookies and the page\u2019s storage, as recorded when written. An identifier stored there lets a script recognize the browser on later visits without fingerprinting again, and a cookie keeps being sent after the script is blocked. A possible identifier is kept long enough (a cookie for 3 months by default; local storage until cleared) and holds a part of 8 to 200 characters with a digit; a likely one is also stored in another place, to restore it from there, or stored right after a fingerprinting burst.';

// Values that don't look like an identifier aren't a sign of tracking on their own, so without one
// there is no line; the details page still lists them.
function storedStatement(script: ScriptDetail): Statement | null {
    const likely = script.stored.filter((item) => item.identifier === 'likely');
    const possible = script.stored.filter((item) => item.identifier === 'possible');
    const shown = likely.length > 0 ? likely : possible;
    if (shown.length === 0) return null;
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

function storagePlaces(items: { kind: StorageKind }[]): string {
    const counts = new Map<StorageKind, number>();
    for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    return listWords([...counts.entries()].map(([kind, count]) => (kind === 'cookie' ? plural(count, 'cookie') : `${count} in ${STORAGE_WORDS[kind]}`)));
}

// On the card, lines of one table share one way to it (see FingerprintCard).
const TABLES: Record<string, string> = {
    read: 'apis',
    identifying: 'apis',
    'generated-code': 'apis',
    'one-place': 'apis',
    cloaked: 'apis',
    sent: 'requests',
    'sent-alias': 'requests',
    stored: 'stored',
};

export function tableOf(key: string): string {
    return TABLES[key] ?? 'apis';
}

export function byTable(list: Statement[]): Statement[][] {
    const tables = new Map<string, Statement[]>();
    for (const statement of list) {
        const table = tableOf(statement.key);
        tables.set(table, [...(tables.get(table) ?? []), statement]);
    }
    return [...tables.values()];
}

// Kinds of detail are short words, sites long names: fewer of them fit in about two lines.
const SHOWN_KINDS = 6;
const SHOWN_SITES = 3;

// "Up to", as details still overlap beyond what the sum takes into account.
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

// At any time, not only right after reading: a tracker hiding behind the site's name is worth seeing
// whenever it is sent to. The score counts only those right after reading (see sentThroughAlias).
function sentThroughAliasStatement(script: ScriptDetail): Statement | null {
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
