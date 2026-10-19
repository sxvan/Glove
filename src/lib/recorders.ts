// The content scripts that record pages (the recorders in the page's world, and the bridge that hands
// their events to the background), registered by the background rather than the manifest, so they
// leave out the sites the user turned the extension off for (see lib/sites): there, nothing of the
// extension is in the page. Chrome keeps registered scripts across sessions; the background brings
// them in step with the list when it starts and whenever the list changes.
import { browser, type Browser } from 'wxt/browser';
import { matchPatternsOf, type OffSite } from './sites';

const RECORDERS: { id: string; world: 'MAIN' | 'ISOLATED' }[] = [
    { id: 'fp-recorder', world: 'MAIN' },
    { id: 'http-recorder', world: 'MAIN' },
    { id: 'bridge', world: 'ISOLATED' },
];

/** Registers the recorders for every page but those of `offSites`, or updates them to that. */
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
