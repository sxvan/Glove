// Where in a script's source the fingerprinting APIs are used. Exact locations come from the call
// positions the fp-recorder takes from stack traces; APIs without recorded positions are found by
// searching the code for their names, which misses obfuscated access (e.g. obj["to"+"DataURL"]).
import { FP_APIS_BY_ID } from '@/lib/fp-apis';
import type { ViewerApi } from '@/lib/script-viewer';

export interface CodeLocation {
    /** The APIs called here; several when one expression reads many, e.g. `{ width, height } = screen`. */
    apis: string[];
    /** Character range in the formatted code. */
    start: number;
    end: number;
    /** True for positions recorded from the call stack, false for search results. */
    exact: boolean;
    /**
     * For exact locations: whether the position lands on the API's name or a bracket expression, as
     * expected. If many don't, the downloaded script differs from the version that ran.
     */
    confirmed: boolean;
    /**
     * For exact locations: the calls came from code this script generates at runtime (new Function,
     * eval), which V8 reports at the place the code is generated.
     */
    generated: boolean;
}

/** Bracketed expressions longer than this are only marked at their opening bracket. */
const MAX_BRACKET_LENGTH = 300;

/**
 * Locations of the APIs in the formatted code: recorded positions where available, search results
 * for the rest. `exactAvailable` is false when the formatted code can't be matched to the original,
 * in which case every API is searched for.
 */
export function locateApis(original: string, formatted: string, apis: ViewerApi[]): { locations: CodeLocation[]; exactAvailable: boolean } {
    const mapper = createPositionMapper(original, formatted);
    const exact: CodeLocation[] = [];
    const searchFor: string[] = [];

    for (const api of apis) {
        if (!mapper || api.positions.length === 0) {
            searchFor.push(api.id);
            continue;
        }
        const prop = FP_APIS_BY_ID[api.id]?.prop ?? '';
        for (const position of api.positions) {
            const offset = mapper(position.line, position.column);
            if (offset !== null) exact.push({ apis: [api.id], generated: false, ...markRange(formatted, offset, prop), exact: true });
        }
    }

    return { locations: merge([...exact, ...searchApiNames(formatted, searchFor)]), exactAvailable: mapper !== null };
}

/**
 * Maps a 1-based line/column in the original to an offset in the formatted code. Formatting only
 * changes whitespace, so the n-th non-whitespace character is the same in both; returns null if
 * that doesn't hold (e.g. the formatter changed something else).
 */
function createPositionMapper(original: string, formatted: string): ((line: number, column: number) => number | null) | null {
    const isSpace = (char: string) => /\s/.test(char);

    // Offsets of the non-whitespace characters, and a check that both sequences are identical.
    const formattedChars: number[] = [];
    for (let i = 0; i < formatted.length; i++) if (!isSpace(formatted[i]!)) formattedChars.push(i);

    const nonSpaceBefore = new Uint32Array(original.length + 1);
    let count = 0;
    for (let i = 0; i < original.length; i++) {
        nonSpaceBefore[i] = count;
        const char = original[i]!;
        if (isSpace(char)) continue;
        const target = formattedChars[count];
        if (target === undefined || formatted[target] !== char) return null;
        count++;
    }
    nonSpaceBefore[original.length] = count;
    if (count !== formattedChars.length) return null;

    const starts = lineStarts(original);

    return (line, column) => {
        const lineStart = starts[line - 1];
        if (lineStart === undefined) return null;
        const offset = lineStart + column - 1;
        if (offset >= original.length) return null;
        const target = formattedChars[nonSpaceBefore[offset]!];
        return target === undefined ? null : target;
    };
}

/** Start offset of each line, using the line terminators V8 counts in stack traces. */
export function lineStarts(text: string): number[] {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '\r' && text[i + 1] === '\n') continue;
        if (char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029') starts.push(i + 1);
    }
    return starts;
}

/**
 * The range to mark for a call recorded at `offset`. V8 points at:
 * - the property name for dot access: `canvas.toDataURL()`, `navigator.userAgent`
 * - `[` for bracket access: `navigator[k]`, and `{` for destructuring: `{ platform } = navigator`
 * - `(` for calls through a computed name: `ctx[k](…)`; the name expression before it is marked
 * - `call`/`apply`/`bind` for indirect calls: `getter.call(document)`
 * - the variable's name for calls through a variable: `fn(…)` with `fn = canvas.toDataURL`
 * - `new Function`, `Function` or `eval` for calls from code generated there at runtime
 * Anything else suggests the code differs from the version that ran, so it's flagged unconfirmed.
 */
function markRange(code: string, offset: number, prop: string): { start: number; end: number; confirmed: boolean; generated?: boolean } {
    if (prop && code.startsWith(prop, offset)) return { start: offset, end: offset + prop.length, confirmed: true };

    const char = code[offset];
    if (char === '[' || char === '{') {
        const end = matchForward(code, offset);
        return { start: offset, end: end ?? offset + 1, confirmed: true };
    }

    if (char === '(') {
        // Mark the callee's last part: `[…]` or a name right before the parenthesis.
        let before = offset - 1;
        while (before >= 0 && /\s/.test(code[before]!)) before--;
        if (code[before] === ']') {
            const start = matchBackward(code, before);
            if (start !== null) return { start, end: before + 1, confirmed: true };
        }
        const name = /[\w$]+$/.exec(code.slice(Math.max(0, before - 100), before + 1));
        if (name) return { start: before + 1 - name[0].length, end: before + 1, confirmed: true };
        return { start: offset, end: offset + 1, confirmed: true };
    }

    const generator = /^(?:new\s+Function|Function|eval)\b/.exec(code.slice(offset, offset + 50))?.[0];
    if (generator) return { start: offset, end: offset + generator.length, confirmed: true, generated: true };

    const word = /^[\w$]+/.exec(code.slice(offset, offset + 100))?.[0];
    const indirect = word === 'call' || word === 'apply' || word === 'bind';
    // A call through a variable holding the API's function: `fn(…)`.
    const called = word !== undefined && /^\s*\(/.test(code.slice(offset + word.length, offset + word.length + 20));
    return { start: offset, end: offset + (word?.length ?? 1), confirmed: indirect || called };
}

/** Offset after the bracket closing the one at `open`, or null if it's too far or missing. */
function matchForward(code: string, open: number): number | null {
    const opening = code[open]!;
    const closing = opening === '[' ? ']' : opening === '{' ? '}' : ')';
    let depth = 0;
    for (let i = open; i < code.length && i - open < MAX_BRACKET_LENGTH; i++) {
        if (code[i] === opening) depth++;
        else if (code[i] === closing && --depth === 0) return i + 1;
    }
    return null;
}

/** Offset of the `[` matching the `]` at `close`, or null if it's too far or missing. */
function matchBackward(code: string, close: number): number | null {
    let depth = 0;
    for (let i = close; i >= 0 && close - i < MAX_BRACKET_LENGTH; i--) {
        if (code[i] === ']') depth++;
        else if (code[i] === '[' && --depth === 0) return i;
    }
    return null;
}

/** Owners whose property names are too generic to search for on their own, with their globals. */
const OWNER_GLOBALS: Record<string, string> = {
    Navigator: 'navigator',
    Screen: 'screen',
    Window: 'window',
    Document: 'document',
};

function searchApiNames(code: string, apiIds: string[]): CodeLocation[] {
    const locations: CodeLocation[] = [];

    for (const api of apiIds) {
        const definition = FP_APIS_BY_ID[api];
        if (!definition) continue;

        for (const pattern of searchPatterns(definition.owner, definition.prop)) {
            for (const match of code.matchAll(pattern)) {
                // The `d` flag gives the range of the "prop" group, so only the name itself is marked.
                const [start, end] = match.indices?.groups?.prop ?? [];
                if (start === undefined || end === undefined || isObjectKey(code, start, end)) continue;
                locations.push({ apis: [api], start, end, exact: false, confirmed: false, generated: false });
            }
        }
    }

    return locations;
}

function searchPatterns(owner: string, prop: string): RegExp[] {
    const name = escapeRegExp(prop);

    // Names with a capital letter (toDataURL, hardwareConcurrency) are distinctive enough on their own.
    if (/[A-Z]/.test(prop) || !OWNER_GLOBALS[owner]) {
        return [new RegExp(`\\b(?<prop>${name})\\b`, 'dg')];
    }

    // Generic names (width, language, cookie) only count when used on their owner, e.g. screen.width.
    const global = OWNER_GLOBALS[owner];
    return [
        new RegExp(`\\b${global}\\s*\\.\\s*(?<prop>${name})\\b`, 'dg'),
        new RegExp(`\\b${global}\\s*\\[\\s*["'](?<prop>${name})["']\\s*\\]`, 'dg'),
    ];
}

/**
 * True for a name used as an object literal key, as in `{ userAgent: … }`: it only names a property
 * and doesn't access the API. Recognized by `{` or `,` before it and `:` after it.
 */
function isObjectKey(code: string, start: number, end: number): boolean {
    const before = code.slice(Math.max(0, start - 200), start).trimEnd();
    const after = code.slice(end, end + 50).trimStart();
    return /[{,]$/.test(before) && after.startsWith(':');
}

/**
 * Combines locations so each piece of code is marked once, sorted by position. Exact locations win
 * over search results; identical ranges merge their APIs; other overlaps keep the earlier location.
 */
function merge(locations: CodeLocation[]): CodeLocation[] {
    const exact = dedupe(locations.filter((l) => l.exact));
    const search = locations.filter((l) => !l.exact && !exact.some((e) => l.start < e.end && e.start < l.end));
    return dedupe([...exact, ...dedupe(search)]);
}

function dedupe(locations: CodeLocation[]): CodeLocation[] {
    const sorted = [...locations].sort((a, b) => a.start - b.start || b.end - a.end);
    const result: CodeLocation[] = [];
    for (const location of sorted) {
        const previous = result[result.length - 1];
        if (previous && previous.start === location.start && previous.end === location.end) {
            for (const api of location.apis) if (!previous.apis.includes(api)) previous.apis.push(api);
        } else if (!previous || location.start >= previous.end) {
            result.push({ ...location, apis: [...location.apis] });
        }
    }
    return result;
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
