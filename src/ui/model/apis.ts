import { FP_APIS_BY_ID, fpCategoryName } from '@/lib/fp-apis';
import { identifyingBits as addedUpBits, type ApiTraits, rareAmounts } from '@/lib/scoring';
import type { ViewerApi } from '@/lib/script-viewer';
import type { CallLocation, ScriptSnapshot, TabSnapshot } from '@/types/snapshot';
import { capitalize } from '../format';
import type { ScriptDetail } from './scripts';

export interface ApiDetail {
    id: string;
    kind: string;
    reveals: string;
    bits: number;
    adds: number;
    rarity: number;
    calls: number;
    /** In ms since the page started. */
    first: number | null;
    /** Among everything the script (or the page) read. */
    rareBits: number;
}

export function apiDetails(script: ScriptSnapshot, startTime: number | undefined, traits: Record<string, ApiTraits>, power: number): ApiDetail[] {
    const ids = new Set([...Object.keys(script.apiCounts), ...(script.fpMetrics?.distinctFpApis ?? [])]);
    const since = (time: number | undefined) => (time === undefined || startTime === undefined ? null : Math.max(0, time - startTime));
    return sortApiDetails(
        [...ids].map((id): ApiDetail => {
            const api = FP_APIS_BY_ID[id];
            const times = script.apiTimes[id];
            return {
                id,
                kind: api ? capitalize(fpCategoryName(api.category)) : 'Other',
                reveals: api?.reveals ?? '',
                bits: traits[id]?.bits ?? 0,
                adds: traits[id]?.adds ?? 0,
                rarity: traits[id]?.rarity ?? 0,
                calls: script.apiCounts?.[id] ?? 0,
                first: since(times?.first),
                rareBits: 0,
            };
        }),
        power
    );
}

export function pageApiDetails(snapshot: TabSnapshot, scripts: ScriptDetail[]): ApiDetail[] {
    const byId = new Map<string, ApiDetail>();
    for (const detail of scripts.flatMap((script) => script.apiDetails)) {
        const known = byId.get(detail.id);
        if (!known) {
            byId.set(detail.id, { ...detail });
            continue;
        }
        known.calls += detail.calls;
        known.first = minOf(known.first, detail.first);
    }
    return sortApiDetails([...byId.values()], snapshot.rarityPower);
}

// An upper bound: what an API adds is measured beside the one API telling the most about it, and
// APIs of different groups can overlap too.
export function identifyingBits(apis: ApiDetail[]): number {
    return addedUpBits(
        apis.map((api) => api.id),
        Object.fromEntries(apis.map((api) => [api.id, { bits: api.bits, adds: api.adds, rarity: api.rarity }]))
    );
}

function minOf(a: number | null, b: number | null): number | null {
    return a === null ? b : b === null ? a : Math.min(a, b);
}

function sortApiDetails(details: ApiDetail[], power: number): ApiDetail[] {
    const amounts = rareAmounts(
        details.map((api) => api.id),
        Object.fromEntries(details.map((api) => [api.id, { bits: api.bits, adds: api.adds, rarity: api.rarity }])),
        power
    );
    for (const api of details) api.rareBits = amounts.get(api.id)?.amount ?? 0;
    return details.sort((a, b) => b.rareBits - a.rareBits || b.bits - a.bits || b.calls - a.calls || a.id.localeCompare(b.id));
}

export function apiList(
    apiCounts: Record<string, number> | undefined,
    apiLocations: Record<string, CallLocation[]> | undefined,
    distinctApis: string[]
): ViewerApi[] {
    const counted = Object.entries(apiCounts ?? {});
    if (counted.length === 0) {
        return [...distinctApis].sort().map((id) => ({ id, calls: null, positions: [] }));
    }
    return counted
        .map(([id, calls]) => ({ id, calls, positions: (apiLocations?.[id] ?? []).map(({ line, column }) => ({ line, column })) }))
        .sort((a, b) => b.calls - a.calls || a.id.localeCompare(b.id));
}
