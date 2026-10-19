// Scripts the user chose to block, kept in storage and enforced by the browser through
// declarativeNetRequest. A script is blocked by its address without query or fragment, so a new
// version parameter doesn't let it through again, on every site, as the same tracker runs on many.
// The background keeps the rules in step with the list (see syncBlockingRules) and notes when a
// blocked script tried to load (see background).
import { browser } from 'wxt/browser';

export interface BlockedScript {
    /** What it is blocked by: its address without query or fragment (see blockKey). */
    key: string;
    /** When it was blocked (ms since the epoch). */
    since: number;
}

const STORAGE_KEY = 'blockedScripts';

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

/** Blocks the script at `url`, or lets it run again; takes effect on its next load. */
export async function setBlocked(url: string, blocked: boolean): Promise<void> {
    const key = blockKey(url);
    if (!key) return;
    const list = (await loadBlocked()).filter((script) => script.key !== key);
    if (blocked) list.push({ key, since: Date.now() });
    await browser.storage.local.set({ [STORAGE_KEY]: list });
}

/** Calls `onChange` with the list whenever it changes. */
export function watchBlocked(onChange: (list: BlockedScript[]) => void): () => void {
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
        if (area === 'local' && STORAGE_KEY in changes) onChange(Array.isArray(changes[STORAGE_KEY]!.newValue) ? (changes[STORAGE_KEY]!.newValue as BlockedScript[]) : []);
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
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
}

// Reloading only takes effect sooner; clearing logs the user out of the site, so it is a choice to make.
export const DEFAULT_BLOCKING_OPTIONS: BlockingOptions = { reload: true, clearData: false };

const OPTIONS_KEY = 'blockingOptions';

export async function loadBlockingOptions(): Promise<BlockingOptions> {
    const stored = (await browser.storage.local.get(OPTIONS_KEY))[OPTIONS_KEY] as Partial<BlockingOptions> | undefined;
    return { ...DEFAULT_BLOCKING_OPTIONS, ...stored };
}

export function saveBlockingOptions(options: BlockingOptions): Promise<void> {
    return browser.storage.local.set({ [OPTIONS_KEY]: options });
}
