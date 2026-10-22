// Registered at runtime rather than in the manifest, so they leave out the sites the extension is off
// for: there, nothing of it is in the page. Chrome keeps registered scripts across sessions.
import { browser, type Browser } from 'wxt/browser';
import { matchPatternsOf, type OffSite } from './sites';

const RECORDERS: { id: string; world: 'MAIN' | 'ISOLATED' }[] = [
    { id: 'fp-recorder', world: 'MAIN' },
    { id: 'http-recorder', world: 'MAIN' },
    { id: 'bridge', world: 'ISOLATED' },
];

export async function registerRecorders(offSites: OffSite[]): Promise<void> {
    const excludeMatches = matchPatternsOf(offSites);
    const wanted: Browser.scripting.RegisteredContentScript[] = RECORDERS.map(({ id, world }) => ({
        id,
        js: [`content-scripts/${id}.js`],
        world,
        matches: ['<all_urls>'],
        excludeMatches,
        runAt: 'document_start',
        allFrames: true,
        matchOriginAsFallback: true,
        persistAcrossSessions: true,
    }));
    const existing = new Map((await browser.scripting.getRegisteredContentScripts()).map((script) => [script.id, script]));
    const register = wanted.filter((script) => !existing.has(script.id));
    // Only those whose exclusions changed: an update every time the background starts would be in vain.
    const update = wanted.filter((script) => {
        const known = existing.get(script.id);
        return known && JSON.stringify(known.excludeMatches ?? []) !== JSON.stringify(excludeMatches);
    });
    if (register.length > 0) await browser.scripting.registerContentScripts(register);
    if (update.length > 0) await browser.scripting.updateContentScripts(update);
}
