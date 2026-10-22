import type { TabSnapshot } from '@/types/snapshot';
import { pageApiDetails } from './apis';
import { pageSent } from './requests';
import { pageTree, type ScoreNode } from './score-tree';
import { learnedKinds, type ScriptDetail, type SignalId } from './scripts';
import { fpLikelihood, type Likelihood, rareBitsOf, strongest } from './shared';
import { pageStored } from './stored';
import { cloakedHosts, pageUrl, realSite } from './urls';

interface PageScore {
    score: number;
    likelihood: Likelihood;
    tree: ScoreNode[];
}

/** The fingerprinting score of the page's most suspicious document (a frame), and its tree. */
function fingerprintingPage(snapshot: TabSnapshot): PageScore {
    const documents = snapshot.frames.filter((f) => f !== null).map((f) => f.document);
    const document = strongest(documents, (document) => document.fpMetrics?.score ?? 0);
    const score = document?.fpMetrics?.score ?? 0;
    return { score, likelihood: fpLikelihood(score, snapshot.cutoffs), tree: document ? pageTree(document, score) : [] };
}

/**
 * The page as a whole, shown like a script: its score, and what all its scripts (see
 * fingerprintingDetails) read and sent together. Of the signs, each shows its strongest script's
 * count, as APIs from different scripts don't add up to one place or one piece of generated code.
 */
export function fingerprintingPageDetail(snapshot: TabSnapshot, scripts: ScriptDetail[]): ScriptDetail {
    const page = fingerprintingPage(snapshot);
    const url = pageUrl(snapshot) ?? '';

    const calls = new Map<string, number | null>();
    for (const script of scripts) {
        for (const api of script.apis) {
            const known = calls.get(api.id);
            calls.set(api.id, api.calls === null && !known ? null : (known ?? 0) + (api.calls ?? 0));
        }
    }
    const apis = [...calls.entries()]
        .map(([id, count]) => ({ id, calls: count, positions: [] }))
        .sort((a, b) => (b.calls ?? 0) - (a.calls ?? 0) || a.id.localeCompare(b.id));

    const signals = (['generated-code', 'one-place'] as SignalId[])
        .map((id) =>
            scripts
                .flatMap((script) => script.signals.filter((signal) => signal.id === id))
                .sort((a, b) => b.count - a.count)[0]
        )
        .filter((signal) => signal !== undefined);

    return {
        key: 'page',
        // Named by what it is about: the header names the page, over everything said about it.
        name: 'Fingerprinting',
        path: false,
        origin: 'Page activity',
        originTitle: url,
        url,
        viewer: null,
        via: null,
        likelihood: page.likelihood,
        score: page.score,
        tree: page.tree,
        calls: scripts.reduce((sum, script) => sum + script.calls, 0),
        capped: snapshot.callsCapped === true || scripts.some((script) => script.capped),
        learned: learnedKinds(
            apis.map((api) => api.id),
            rareBitsOf(snapshot)
        ),
        signals,
        apis,
        sent: pageSent(scripts),
        // The details page lists the requests by script.
        requests: [],
        // All the page's requests, also those no recorded script made, such as images in its HTML.
        aliased: [...cloakedHosts(snapshot).keys()].map((host) => ({ host, site: realSite(host, cloakedHosts(snapshot)) ?? host })),
        stored: pageStored(scripts),
        apiDetails: pageApiDetails(snapshot, scripts),
    };
}
