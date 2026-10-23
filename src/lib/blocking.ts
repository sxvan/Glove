// Scripts the user chose to block, kept in storage and enforced by the browser through
// declarativeNetRequest. A script is blocked by its address without query or fragment, so a new
// version parameter doesn't let it through again, on every site, as the same tracker runs on many.
// An address edited in the settings may hold * for any characters, for a part a site randomizes.
import { browser } from 'wxt/browser';
import { listOf, loadStored, watchStored } from './storage';

export interface BlockedScript {
    key: string;
    /** When it was blocked (ms since the epoch). */
    since: number;
    /** Set when it was blocked automatically: the score it had then (0 to 1). */
    auto?: { score: number };
}

const STORAGE_KEY = 'blockedScripts';
// Scripts the user let run again, by what they are blocked by: never blocked automatically after.
const EXEMPT_KEY = 'autoBlockExempt';

/** A script that runs even where a pattern blocks its address, and is never blocked automatically. */
export interface AllowedScript {
    key: string;
    /** When it was allowed (ms since the epoch). */
    since: number;
}

const ALLOWED_KEY = 'allowedScripts';

// Null for a script that can't be blocked by address (inline, generated, other schemes) or that a rule can't express.
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

/**
 * An address typed in the settings as a key: http(s), without query or fragment, with * for any
 * characters; null if it isn't one. Not | or ^, which a rule's pattern reads as anchors.
 */
export function blockPattern(text: string): string | null {
    const pattern = text.trim();
    if (!/^https?:\/\/[^/?#\s|^]+\/[^?#\s|^]*$/.test(pattern)) return null;
    try {
        new URL(pattern.replaceAll('*', 'x'));
        return pattern;
    } catch {
        return null;
    }
}

// As the rule's urlFilter `|key^` matches (see syncBlockingRules): from the start of the full address,
// ignoring case, * for any characters, and ^ for a separator (not a letter, digit, _ - . or %) or the end.
function covers(key: string, url: string): boolean {
    const pattern = key.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${pattern}(?:[^\\w\\-.%]|$)`, 'i').test(url);
}

/** The entry blocking the script at `url`, by its address or a pattern covering it; none for an allowed script. */
export function blockedBy(url: string, list: BlockedScript[], allowed: AllowedScript[]): BlockedScript | undefined {
    const key = blockKey(url);
    if (key === null || allowed.some((script) => script.key === key)) return undefined;
    return list.find((script) => script.key === key) ?? list.find((script) => covers(script.key, url));
}

export async function loadBlocked(): Promise<BlockedScript[]> {
    return listOf(await loadStored(STORAGE_KEY));
}

export async function loadAllowed(): Promise<AllowedScript[]> {
    return listOf(await loadStored(ALLOWED_KEY));
}

/** Allows the scripts at `urls` (or with these keys), or takes that back. */
export async function setAllowed(urls: string[], allowed: boolean): Promise<void> {
    const keys = new Set(urls.map(blockKey).filter((key) => key !== null));
    const list = (await loadAllowed()).filter((script) => !keys.has(script.key));
    if (allowed) for (const key of keys) list.push({ key, since: Date.now() });
    await browser.storage.local.set({ [ALLOWED_KEY]: list });
}

export function watchAllowed(onChange: (list: AllowedScript[]) => void): () => void {
    return watchStored(ALLOWED_KEY, (value) => onChange(listOf(value)));
}

export async function loadExempt(): Promise<string[]> {
    return listOf(await loadStored(EXEMPT_KEY));
}

export async function removeExempt(keys: string[]): Promise<void> {
    const exempt = (await loadExempt()).filter((key) => !keys.includes(key));
    await browser.storage.local.set({ [EXEMPT_KEY]: exempt });
}

// Letting a script run again exempts it from being blocked automatically; blocking it by hand takes that back.
// `urls` may also be entries' keys, patterns included; letting a script run again removes the pattern covering it.
export async function setBlocked(urls: string[], blocked: boolean, auto?: Map<string, number>): Promise<void> {
    const keys = new Map(urls.map((url) => [blockKey(url) ?? blockPattern(url), url] as const).filter((entry): entry is [string, string] => entry[0] !== null));
    if (keys.size === 0) return;
    const covering = (script: BlockedScript) => [...keys.keys()].some((key) => script.key === key || (!blocked && covers(script.key, key)));
    const list = (await loadBlocked()).filter((script) => !covering(script));
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

/** Changes what an entry blocks to `key` (see blockPattern), keeping when and how it was blocked. */
export async function editBlocked(from: string, key: string): Promise<void> {
    const list = (await loadBlocked()).filter((script) => script.key !== key || script.key === from);
    await browser.storage.local.set({ [STORAGE_KEY]: list.map((script) => (script.key === from ? { ...script, key } : script)) });
}

export function watchBlocked(onChange: (list: BlockedScript[]) => void): () => void {
    return watchStored(STORAGE_KEY, (value) => onChange(listOf(value)));
}

export function watchExempt(onChange: (keys: string[]) => void): () => void {
    return watchStored(EXEMPT_KEY, (value) => onChange(listOf(value)));
}

// Allowed scripts, and on sites the extension is off for all of a page's requests, its frames' too,
// are allowed by rules of higher priority than the blocking ones.
export async function syncBlockingRules(list: BlockedScript[], allowed: AllowedScript[], offSites: string[]): Promise<void> {
    const existing = await browser.declarativeNetRequest.getDynamicRules();
    const blockRules = list.map((script, i) => ({
        id: i + 1,
        priority: 1,
        action: { type: 'block' as const },
        condition: { urlFilter: `|${script.key}^`, resourceTypes: ['script' as const] },
    }));
    const allowScriptRules = allowed.map((script, i) => ({
        id: blockRules.length + i + 1,
        priority: 2,
        action: { type: 'allow' as const },
        condition: { urlFilter: `|${script.key}^`, resourceTypes: ['script' as const] },
    }));
    // requestDomains covers each name's subdomains too, as an off site does.
    const allowRules =
        offSites.length > 0
            ? [
                  {
                      id: blockRules.length + allowScriptRules.length + 1,
                      priority: 2,
                      action: { type: 'allowAllRequests' as const },
                      condition: { requestDomains: offSites, resourceTypes: ['main_frame' as const] },
                  },
              ]
            : [];
    await browser.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existing.map((rule) => rule.id),
        addRules: [...blockRules, ...allowScriptRules, ...allowRules],
    });
}

export interface BlockingOptions {
    reload: boolean;
    /** So the script's stored identifiers are gone too. */
    clearData: boolean;
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
    return { ...DEFAULT_BLOCKING_OPTIONS, ...(await loadStored<Partial<BlockingOptions>>(OPTIONS_KEY)) };
}

export function saveBlockingOptions(options: BlockingOptions): Promise<void> {
    return browser.storage.local.set({ [OPTIONS_KEY]: options });
}

export function watchBlockingOptions(onChange: (options: BlockingOptions) => void): () => void {
    return watchStored<Partial<BlockingOptions>>(OPTIONS_KEY, (value) => onChange({ ...DEFAULT_BLOCKING_OPTIONS, ...value }));
}
