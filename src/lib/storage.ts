import { browser } from 'wxt/browser';

export async function loadStored<T>(key: string): Promise<T | undefined> {
    return (await browser.storage.local.get(key))[key] as T | undefined;
}

export function watchStored<T>(key: string, onChange: (value: T | undefined) => void): () => void {
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
        if (area === 'local' && key in changes) onChange(changes[key]!.newValue as T | undefined);
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
}

export function listOf<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}
