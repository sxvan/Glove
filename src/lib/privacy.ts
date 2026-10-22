// What the extension may contact on the user's behalf: DNS lookups (see dns-lookup), the page's own
// subdomains asked at a resolver (Quad9) to find CNAME cloaking, off by default; and the script
// viewer's download of a script again from its server, asked about first by default.
import { browser } from 'wxt/browser';

export interface PrivacyOptions {
    dnsLookups: boolean;
    /** Whether the script viewer asks before downloading a script again (see entrypoints/viewer). */
    askBeforeDownload: boolean;
}

// Nothing leaves the browser unless the user chooses so: no lookups, so cloaking isn't detected and
// its signals in the scores stay at nothing (see cnameCloaked and sentThroughAlias); and the viewer
// asks before contacting a script's server.
export const DEFAULT_PRIVACY: PrivacyOptions = { dnsLookups: false, askBeforeDownload: true };

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
