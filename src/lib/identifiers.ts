// Whether a value a script stored is an identifier: one that tells this browser apart and stays.
// After the rules measurement studies use for identifier cookies (Englehardt et al. 2015, "Cookies
// that give you away"; Englehardt and Narayanan 2016, "Online Tracking: A 1-million-site
// Measurement and Analysis"): kept for at least 3 months, and holding a token of 8 or more
// characters (up to 100 there, up to 200 here). Their third rule, that the value differs between
// browsers, needs a second browser, so it is left out: some values the same for everyone, such as
// timestamps, count too. Only for scripts the user chose to look at or block, where marking too
// much does little harm.
//
// Such a value is a possible identifier; a likely one when the script also shows it means to keep
// it: it stored the value in a second place too, to restore it from there when one is cleared (as
// "evercookies" do), or stored it right after reading fingerprinting APIs.
import type { StoredItem } from '@/types/snapshot';

/**
 * Stored values are recorded up to this length: twice the longest token that counts as an
 * identifier by default, so one fits in full beside some other data before it.
 */
export const STORED_VALUE_MAX = 400;

/** What counts as a possible identifier (see the user's scoring settings). */
export interface IdentifierRules {
    /** How many days a cookie must be kept to identify across visits. */
    lastingDays: number;
    /** The lengths of a token that can be an identifier. */
    minLength: number;
    maxLength: number;
}

/**
 * Three months, as in the studies. 8 characters at least, as fewer are too few to tell browsers
 * apart; 200 at most, as the longest are data rather than an identifier, with room above the
 * longest common form of one (128 characters, a SHA-512 hash in hex).
 */
export const DEFAULT_IDENTIFIER_RULES: IdentifierRules = { lastingDays: 90, minLength: 8, maxLength: 200 };

export type IdentifierLevel = 'possible' | 'likely';

interface IdentifierFinding {
    level: IdentifierLevel | null;
    /** The other items on the page holding the same value (see isCopy). */
    copies: StoredPlace[];
    /** Whether it was stored during or right after one of the script's bursts. */
    afterReading: boolean;
}

/** A cookie or storage item by where it is and what it holds. */
export type StoredPlace = Pick<StoredItem, 'kind' | 'name' | 'value'>;

const DAY = 24 * 60 * 60 * 1000;

/**
 * How identifying a stored item is: a possible identifier when kept long enough and holding an
 * identifier token (see identifierTokens); likely when also copied to another item of `page` (all
 * the page holds, see isCopy) or written within `afterMs` after one of `bursts` (start and end, in
 * ms).
 */
export function findIdentifier(item: StoredItem, page: StoredPlace[], bursts: { start: number; end: number }[], afterMs: number, rules: IdentifierRules): IdentifierFinding {
    const tokens = item.value === null ? [] : identifierTokens(item.value, rules);
    const copies = tokens.length === 0 ? [] : page.filter((other) => !(other.kind === item.kind && other.name === item.name) && isCopy(item.value!, other.value, rules));
    const afterReading = bursts.some(({ start, end }) => [item.first, item.last].some((time) => time >= start && time <= end + afterMs));
    if (tokens.length === 0 || !isLasting(item, rules)) return { level: null, copies, afterReading };
    return { level: copies.length > 0 || afterReading ? 'likely' : 'possible', copies, afterReading };
}

/**
 * Whether two values are the same one stored twice: equal, or one holding the other whole (an
 * identifier inside a JSON object), where the one held has an identifier token. A part they merely
 * share doesn't count: values written in the same second share their timestamp.
 */
function isCopy(value: string, other: string | null, rules: IdentifierRules): boolean {
    if (other === null) return false;
    const [shorter, longer] = value.length <= other.length ? [value, other] : [other, value];
    return longer.includes(shorter) && identifierTokens(shorter, rules).length > 0;
}

/**
 * Kept long enough to identify across visits: a cookie for `lastingDays`, local storage and
 * IndexedDB until cleared, session storage only until the tab closes.
 */
function isLasting(item: StoredItem, rules: IdentifierRules): boolean {
    // A cookie's expiry is noted a moment before the write is (see fp-recorder), so a minute of slack.
    if (item.kind === 'cookie') return item.expires !== null && item.expires - item.last >= rules.lastingDays * DAY - 60_000;
    return item.kind !== 'sessionStorage';
}

/**
 * The tokens in a value that look like identifiers. A value can hold several parts, as JSON
 * (`{"id":"f7c1…","ts":…}`) or joined with dots (`1.123456789.1729000000`), so it is split at
 * anything but letters, digits and the characters of base64 and UUIDs; a token then needs the
 * lengths of the rules and a digit (words such as "necessary" have none, while hex, base64 and
 * numeric IDs nearly always do).
 */
function identifierTokens(value: string, rules: IdentifierRules): string[] {
    let decoded = value;
    try {
        decoded = decodeURIComponent(value);
    } catch {}
    return decoded
        .split(/[^A-Za-z0-9+/=_-]+/)
        .map((token) => token.replace(/=+$/, ''))
        .filter((token) => token.length >= rules.minLength && token.length <= rules.maxLength && /\d/.test(token));
}
