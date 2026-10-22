import type { FpSpike } from '@/types/analysis';
import type { FpMonkeyEvent } from '@/types/events';
import type { BurstDetection } from './scoring';

/**
 * Finds bursts of fingerprinting calls with a sliding window: of all windows of `windowMs` reading
 * at least `minDistinctApis` different APIs, the one whose different APIs weigh the most (see
 * `weight`) becomes a burst, then the next heaviest not overlapping a burst, and so on. Each call
 * belongs to one burst at most. Unlike splitting at pauses, the result doesn't jump with small
 * timing differences: a collection is found as a whole wherever it starts. Takes O(n log n), as a
 * tab open for long has tens of thousands of calls and is analyzed again with every few new ones.
 * Sorts `events` in place by timestamp; the bursts come in time order.
 */
export function detectSpikes(events: FpMonkeyEvent[], detection: BurstDetection, weight: (apiId: string) => number): FpSpike[] {
    events.sort((a, b) => a.timeStamp - b.timeStamp);

    const windows = windowsOf(events, detection, weight).sort((a, b) => b.total - a.total || b.distinct - a.distinct || a.start - b.start);
    const taken = new TakenCalls(events.length);
    const chosen: Window[] = [];
    for (const window of windows) {
        if (taken.any(window.start, window.end)) continue;
        taken.take(window.start, window.end);
        chosen.push(window);
    }
    return chosen.sort((a, b) => a.start - b.start).map(({ start, end }) => ({ events: events.slice(start, end) }));
}

/** A window of calls: the range of `events` in it, and the weight and number of its different APIs. */
interface Window {
    start: number;
    end: number;
    total: number;
    distinct: number;
}

/**
 * The window starting at each call, up to `windowMs` after it, that reads at least
 * `minDistinctApis` different APIs, in one pass over `events` (sorted by time).
 */
function windowsOf(events: FpMonkeyEvent[], { windowMs, minDistinctApis }: BurstDetection, weight: (apiId: string) => number): Window[] {
    const weights = new Map<string, number>();
    const weightOf = (id: string) => weights.get(id) ?? weights.set(id, weight(id)).get(id)!;

    // The calls per API in the window, and the weight and number of the different APIs in it.
    const counts = new Map<string, number>();
    let total = 0;
    let distinct = 0;
    const windows: Window[] = [];

    let end = 0;
    for (let start = 0; start < events.length; start++) {
        while (end < events.length && events[end]!.timeStamp - events[start]!.timeStamp <= windowMs) {
            const id = events[end]!.id;
            const count = counts.get(id) ?? 0;
            if (count === 0) {
                total += weightOf(id);
                distinct += 1;
            }
            counts.set(id, count + 1);
            end++;
        }

        if (distinct >= minDistinctApis) windows.push({ start, end, total, distinct });

        const id = events[start]!.id;
        const count = counts.get(id)! - 1;
        counts.set(id, count);
        if (count === 0) {
            total -= weightOf(id);
            distinct -= 1;
        }
    }
    return windows;
}

/** Which calls already belong to a burst, as a Fenwick tree: marking and asking about a range take O(log n). */
class TakenCalls {
    private readonly tree: Int32Array;

    constructor(size: number) {
        this.tree = new Int32Array(size + 1);
    }

    /** True if any call in [start, end) is taken. */
    any(start: number, end: number): boolean {
        return this.countBefore(end) - this.countBefore(start) > 0;
    }

    /** Marks the calls in [start, end), none of which are taken yet. */
    take(start: number, end: number) {
        for (let i = start; i < end; i++) {
            for (let j = i + 1; j < this.tree.length; j += j & -j) this.tree[j]! += 1;
        }
    }

    /** How many calls before `index` are taken. */
    private countBefore(index: number): number {
        let sum = 0;
        for (let j = index; j > 0; j -= j & -j) sum += this.tree[j]!;
        return sum;
    }
}
