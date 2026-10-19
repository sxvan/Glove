// Scripts the user chose to block, kept in storage and enforced by the browser through
// declarativeNetRequest. A script is blocked by its address without query or fragment, so a new
// version parameter doesn't let it through again, on every site, as the same tracker runs on many.
// The background keeps the rules in step with the list (see syncBlockingRules), notes when a
// blocked script tried to load, and, if the user chose so, blocks scripts that reach a score by
// itself (see BlockingOptions.autoBlock and background).
import { browser } from 'wxt/browser';

export interface BlockedScript {
    /** What it is blocked by: its address without query or fragment (see blockKey). */
    key: string;
    /** When it was blocked (ms since the epoch). */
    since: number;
    /** Set when it was blocked automatically: the score it had then (0 to 1). */
    auto?: { score: number };
}

const STORAGE_KEY = 'blockedScripts';
// Scripts the user let run again, by what they are blocked by: never blocked automatically after.
const EXEMPT_KEY = 'autoBlockExempt';

/**
 * What a script is blocked by: its http(s) address without query or fragment; null for one that can't
 * be blocked by address (inline, generated, other schemes) or that a rule can't express.
 */
export function blockKey(url: string): string | null {
    try {
        const { protocol, origin, pathname } = new URL(url);
        if (protocol !== 'http:' && protocol !== 'https:') return null;
        const key = origin + pathname;
        // A rule's pattern treats these as wildcards and anchors.
        return /[*|^]/.test(key) ? null : key;
    } catch {
        return null;
    }
}

export async function loadBlocked(): Promise<BlockedScript[]> {
    const stored = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    return Array.isArray(stored) ? (stored as BlockedScript[]) : [];
}

/** The scripts the user let run again (see EXEMPT_KEY). */
export async function loadExempt(): Promise<string[]> {
    const stored = (await browser.storage.local.get(EXEMPT_KEY))[EXEMPT_KEY];
    return Array.isArray(stored) ? (stored as string[]) : [];
}

/**
 * Blocks the scripts at `urls`, or lets them run again; takes effect on their next load. `auto`
 * gives the score each was blocked automatically at, by URL. Letting a script run again exempts it
 * from being blocked automatically; blocking it by hand takes that back.
 */
export async function setBlocked(urls: string[], blocked: boolean, auto?: Map<string, number>): Promise<void> {
    const keys = new Map(urls.map((url) => [blockKey(url), url] as const).filter((entry): entry is [string, string] => entry[0] !== null));
    if (keys.size === 0) return;
    const list = (await loadBlocked()).filter((script) => !keys.has(script.key));
    if (blocked) {
        for (const [key, url] of keys) {
            const score = auto?.get(url);
            list.push({ key, since: Date.now(), ...(score === undefined ? {} : { auto: { score } }) });
        }
    }
    const exempt = (await loadExempt()).filter((key) => !keys.has(key));
    if (!blocked) exempt.push(...keys.keys());
    await browser.storage.local.set({ [STORAGE_KEY]: list, ...(auto ? {} : { [EXEMPT_KEY]: exempt }) });
}

/** Calls `onChange` with the stored value of `key` whenever it changes. */
function watchStored<T>(key: string, onChange: (value: T | undefined) => void): () => void {
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
        if (area === 'local' && key in changes) onChange(changes[key]!.newValue as T | undefined);
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
}

/** Calls `onChange` with the list whenever it changes. */
export function watchBlocked(onChange: (list: BlockedScript[]) => void): () => void {
    return watchStored<unknown>(STORAGE_KEY, (value) => onChange(Array.isArray(value) ? (value as BlockedScript[]) : []));
}

/** Calls `onChange` with the exempt scripts whenever they change. */
export function watchExempt(onChange: (keys: string[]) => void): () => void {
    return watchStored<unknown>(EXEMPT_KEY, (value) => onChange(Array.isArray(value) ? (value as string[]) : []));
}

/**
 * Replaces the browser's blocking rules with one per blocked script: its address, with any query
 * after it ("^": the end, or a separator such as "?"), loaded as a script.
 */
export async function syncBlockingRules(list: BlockedScript[]): Promise<void> {
    const existing = await browser.declarativeNetRequest.getDynamicRules();
    await browser.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existing.map((rule) => rule.id),
        addRules: list.map((script, i) => ({
            id: i + 1,
            priority: 1,
            action: { type: 'block' as const },
            condition: { urlFilter: `|${script.key}^`, resourceTypes: ['script' as const] },
        })),
    });
}

/** What happens right after the user blocks a script, or lets it run again (see the options page). */
export interface BlockingOptions {
    /** Load the page again, so the change takes effect at once. */
    reload: boolean;
    /** After blocking, clear the site's cookies and storage before loading it again, so the script's stored identifiers are gone too. */
    clearData: boolean;
    /** Block every script that reaches `autoBlockFrom` (0 to 1), as the switch does, with reloading and clearing as set. */
    autoBlock: boolean;
    autoBlockFrom: number;
}

// Reloading only takes effect sooner; clearing logs the user out of the site, and blocking by itself
// can break sites, so those are choices to make. Automatically from 85: above the security checks
// that sign-ins and shops depend on, measured at 64 to 77 (Google's sign-in, Amazon's device script,
// see the cutoffs in scoring), whose blocking breaks the site, while the collectors measured score 90
// and more (Akamai, FingerprintJS, CNN's).
export const DEFAULT_BLOCKING_OPTIONS: BlockingOptions = { reload: true, clearData: false, autoBlock: false, autoBlockFrom: 0.85 };

const OPTIONS_KEY = 'blockingOptions';

export async function loadBlockingOptions(): Promise<BlockingOptions> {
    const stored = (await browser.storage.local.get(OPTIONS_KEY))[OPTIONS_KEY] as Partial<BlockingOptions> | undefined;
    return { ...DEFAULT_BLOCKING_OPTIONS, ...stored };
}

export function saveBlockingOptions(options: BlockingOptions): Promise<void> {
    return browser.storage.local.set({ [OPTIONS_KEY]: options });
}

/** Calls `onChange` with the options whenever the user changes them. */
export function watchBlockingOptions(onChange: (options: BlockingOptions) => void): () => void {
    return watchStored<Partial<BlockingOptions>>(OPTIONS_KEY, (value) => onChange({ ...DEFAULT_BLOCKING_OPTIONS, ...value }));
}
