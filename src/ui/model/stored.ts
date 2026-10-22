import { findIdentifier, type IdentifierLevel, type StoredPlace } from '@/lib/identifiers';
import type { ScriptSnapshot, StoredItem, TabSnapshot } from '@/types/snapshot';
import type { ScriptDetail } from './scripts';

/** A cookie or storage item a script wrote, and how likely it is an identifier (see findIdentifier). */
export interface StoredDetail extends StoredItem {
    identifier: IdentifierLevel | null;
}

const IDENTIFIER_ORDER: Record<IdentifierLevel, number> = { likely: 2, possible: 1 };

/** Likely identifiers first, then possible ones, then the rest, each in the order first written. */
function byIdentifier(a: StoredDetail, b: StoredDetail): number {
    return (b.identifier ? IDENTIFIER_ORDER[b.identifier] : 0) - (a.identifier ? IDENTIFIER_ORDER[a.identifier] : 0) || a.first - b.first;
}

/**
 * What a script stored, as recorded, each judged against all the page's scripts stored and the
 * script's bursts. Only bursts that are possible fingerprinting on their own count: a few APIs read
 * together, as analytics and players do, don't make what is stored after them suspicious.
 */
export function storedDetails(snapshot: TabSnapshot, script: ScriptSnapshot): StoredDetail[] {
    const page: StoredPlace[] = snapshot.frames.flatMap((frame) => frame?.document.scripts.flatMap((other) => other.stored) ?? []);
    const possible = snapshot.cutoffs.fingerprinting.possible;
    const bursts = script.bursts
        .filter((burst) => (burst.fpMetrics?.score ?? 0) >= possible)
        .map((burst) => burst.events.map((event) => event.timeStamp))
        .filter((times) => times.length > 0)
        .map((times) => ({ start: Math.min(...times), end: Math.max(...times) }));
    const rules = snapshot.identifiers;
    const afterMs = snapshot.rightAfterMs;
    return script.stored
        .map((item): StoredDetail => {
            return { ...item, identifier: findIdentifier(item, page, bursts, afterMs, rules).level };
        })
        .sort(byIdentifier);
}

/**
 * What the page's scripts stored, once per cookie or item, as several can write the same one: with
 * the strongest of their judgments, as each judges by its own bursts.
 */
export function pageStored(scripts: ScriptDetail[]): StoredDetail[] {
    const byItem = new Map<string, StoredDetail>();
    for (const script of scripts) {
        for (const item of script.stored) {
            const key = `${item.kind}|${item.name}`;
            const known = byItem.get(key);
            if (!known || byIdentifier(item, known) < 0) byItem.set(key, item);
        }
    }
    return [...byItem.values()].sort(byIdentifier);
}
