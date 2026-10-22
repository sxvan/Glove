// What the extension may contact on the user's behalf.
import { browser } from 'wxt/browser';
import { loadStored, watchStored } from './storage';

export interface PrivacyOptions {
    dnsLookups: boolean;
    askBeforeDownload: boolean;
}

// Nothing leaves the browser unless the user chooses so; without lookups, cloaking isn't detected.
export const DEFAULT_PRIVACY: PrivacyOptions = { dnsLookups: false, askBeforeDownload: true };

const STORAGE_KEY = 'privacyOptions';

export async function loadPrivacy(): Promise<PrivacyOptions> {
    return { ...DEFAULT_PRIVACY, ...(await loadStored<Partial<PrivacyOptions>>(STORAGE_KEY)) };
}

export function savePrivacy(options: PrivacyOptions): Promise<void> {
    return browser.storage.local.set({ [STORAGE_KEY]: options });
}

export function watchPrivacy(onChange: (options: PrivacyOptions) => void): () => void {
    return watchStored<Partial<PrivacyOptions>>(STORAGE_KEY, (value) => onChange({ ...DEFAULT_PRIVACY, ...value }));
}
