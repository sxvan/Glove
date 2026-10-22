// What the extension may contact on the user's behalf: DNS lookups (see dns-lookup), the page's own
// subdomains asked at a resolver (Quad9) to find CNAME cloaking, off by default; and the script
// viewer's download of a script again from its server, asked about first by default.
import { browser } from 'wxt/browser';
import { loadStored, watchStored } from './storage';

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
    return { ...DEFAULT_PRIVACY, ...(await loadStored<Partial<PrivacyOptions>>(STORAGE_KEY)) };
}

export function savePrivacy(options: PrivacyOptions): Promise<void> {
    return browser.storage.local.set({ [STORAGE_KEY]: options });
}

/** Calls `onChange` with the options whenever the user changes them. */
export function watchPrivacy(onChange: (options: PrivacyOptions) => void): () => void {
    return watchStored<Partial<PrivacyOptions>>(STORAGE_KEY, (value) => onChange({ ...DEFAULT_PRIVACY, ...value }));
}
