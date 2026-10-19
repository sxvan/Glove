// What the extension may send off the browser. Today only DNS lookups (see dns-lookup): the page's
// own subdomains, asked at a resolver to find CNAME cloaking. Off, nothing is looked up, and cloaking
// isn't detected.
import { browser } from 'wxt/browser';

export interface PrivacyOptions {
    dnsLookups: boolean;
}

// On: cloaking is part of the scores (see the cnameCloaked and sentThroughAlias signals).
export const DEFAULT_PRIVACY: PrivacyOptions = { dnsLookups: true };

const STORAGE_KEY = 'privacyOptions';

export async function loadPrivacy(): Promise<PrivacyOptions> {
    const stored = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as Partial<PrivacyOptions> | undefined;
    return { ...DEFAULT_PRIVACY, ...stored };
}

export function savePrivacy(options: PrivacyOptions): Promise<void> {
    return browser.storage.local.set({ [STORAGE_KEY]: options });
}

/** Calls `onChange` with the options whenever the user changes them. */
export function watchPrivacy(onChange: (options: PrivacyOptions) => void): () => void {
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
        if (area === 'local' && STORAGE_KEY in changes) onChange({ ...DEFAULT_PRIVACY, ...(changes[STORAGE_KEY]!.newValue as Partial<PrivacyOptions> | undefined) });
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
}
