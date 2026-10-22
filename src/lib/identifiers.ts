// The rules measurement studies use for identifier cookies (Englehardt et al. 2015, "Cookies that
// give you away"; Englehardt and Narayanan 2016, "Online Tracking: A 1-million-site Measurement and
// Analysis"): kept at least 3 months, with a token of 8 or more characters (up to 100 there, 200
// here). Their third rule, that the value differs between browsers, needs a second browser, so it is
// left out: values the same for everyone, such as timestamps, count too. Identifiers are only shown,
// never scored, so marking too much does little harm. A likely identifier is also stored in a second
// place, to restore it when one is cleared (as "evercookies" do), or right after fingerprinting.
import type { StoredItem } from '@/types/snapshot';

// Twice the longest identifier token by default, so one fits in full beside other data before it.
export const STORED_VALUE_MAX = 400;

export interface IdentifierRules {
    lastingDays: number;
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
    copies: StoredPlace[];
    afterReading: boolean;
}

export type StoredPlace = Pick<StoredItem, 'kind' | 'name' | 'value'>;

const DAY = 24 * 60 * 60 * 1000;

/** `page`: all the page stores; `bursts`: start and end in ms. */
export function findIdentifier(item: StoredItem, page: StoredPlace[], bursts: { start: number; end: number }[], afterMs: number, rules: IdentifierRules): IdentifierFinding {
    const tokens = item.value === null ? [] : identifierTokens(item.value, rules);
    const copies = tokens.length === 0 ? [] : page.filter((other) => !(other.kind === item.kind && other.name === item.name) && isCopy(item.value!, other.value, rules));
    const afterReading = bursts.some(({ start, end }) => [item.first, item.last].some((time) => time >= start && time <= end + afterMs));
    if (tokens.length === 0 || !isLasting(item, rules)) return { level: null, copies, afterReading };
    return { level: copies.length > 0 || afterReading ? 'likely' : 'possible', copies, afterReading };
}

// Equal, or one holding the other whole (an identifier inside JSON). A part they merely share doesn't
// count: values written in the same second share their timestamp.
function isCopy(value: string, other: string | null, rules: IdentifierRules): boolean {
    if (other === null) return false;
    const [shorter, longer] = value.length <= other.length ? [value, other] : [other, value];
    return longer.includes(shorter) && identifierTokens(shorter, rules).length > 0;
}

function isLasting(item: StoredItem, rules: IdentifierRules): boolean {
    // A cookie's expiry is noted a moment before the write is (see fp-recorder), so a minute of slack.
    if (item.kind === 'cookie') return item.expires !== null && item.expires - item.last >= rules.lastingDays * DAY - 60_000;
    return item.kind !== 'sessionStorage';
}

// A value can hold several parts, as JSON or joined with dots (`1.123456789.1729000000`). A token
// needs a digit: words such as "necessary" have none, while hex, base64 and numeric IDs nearly always do.
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
