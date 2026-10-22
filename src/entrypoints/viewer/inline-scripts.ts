// Inline scripts have no file of their own: their code is part of the page's HTML, and the call
// positions recorded for them are positions in that HTML. This finds the page's inline scripts and
// turns the positions into positions in each script, so they can be shown like any other script.
import type { SourcePosition, ViewerApi } from '@/lib/script-viewer';
import { lineStarts } from './locations';

interface InlineScript {
    source: string;
    /** Line of the page the script starts on, 1-based. */
    line: number;
    /** The APIs called from this script, with positions relative to it. */
    apis: ViewerApi[];
}

// Script elements and their code; the code ends at the first "</script", as in HTML.
const SCRIPT_ELEMENT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
// Types that run as JavaScript; other script elements hold data such as JSON or templates.
const JAVASCRIPT_TYPE = /^(?:|module|(?:text|application)\/(?:x-)?(?:java|ecma)script)$/i;

/**
 * The page's inline scripts that recorded calls fall into, with each call's position moved into
 * its script. `matched` is false when no recorded position falls into any inline script, e.g. for a
 * page that differs per visit; all inline scripts are returned then, without positions, for the
 * names to be searched in.
 */
export function inlineScripts(html: string, apis: ViewerApi[]): { scripts: InlineScript[]; matched: boolean } {
    const pageLines = lineStarts(html);
    const elements = scriptElements(html, pageLines);

    // Per script element, per API: the positions falling into it.
    const found = new Map<number, Map<string, SourcePosition[]>>();
    for (const api of apis) {
        for (const position of api.positions) {
            const lineStart = pageLines[position.line - 1];
            if (lineStart === undefined) continue;
            const offset = lineStart + position.column - 1;
            const index = elements.findIndex((e) => e.start <= offset && offset < e.start + e.source.length);
            if (index === -1) continue;

            const element = elements[index]!;
            const byApi = found.get(index) ?? new Map<string, SourcePosition[]>();
            byApi.set(api.id, [...(byApi.get(api.id) ?? []), relativePosition(element, offset)]);
            found.set(index, byApi);
        }
    }

    if (found.size === 0) {
        const withoutPositions = apis.map((api) => ({ ...api, positions: [] }));
        return { scripts: elements.map((e) => ({ source: e.source, line: e.line, apis: withoutPositions })), matched: false };
    }

    const scripts = [...found.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, byApi]) => {
            const element = elements[index]!;
            const scriptApis = apis.filter((api) => byApi.has(api.id)).map((api) => ({ ...api, positions: byApi.get(api.id)! }));
            return { source: element.source, line: element.line, apis: scriptApis };
        });
    return { scripts, matched: true };
}

interface ScriptElement {
    source: string;
    /** Offset of the code in the page. */
    start: number;
    line: number;
    lineStarts: number[];
}

/** The page's inline JavaScript elements: without a src attribute, and of a JavaScript type. */
function scriptElements(html: string, pageLines: number[]): ScriptElement[] {
    const elements: ScriptElement[] = [];
    for (const match of html.matchAll(SCRIPT_ELEMENT)) {
        const attributes = match[1] ?? '';
        const source = match[2] ?? '';
        if (/\bsrc\s*=/i.test(attributes) || !source.trim()) continue;
        const type = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(attributes)?.[1] ?? '';
        if (!JAVASCRIPT_TYPE.test(type)) continue;

        const start = match.index + match[0].indexOf('>') + 1; // the opening tag can't contain ">"
        elements.push({ source, start, line: lineOf(pageLines, start), lineStarts: lineStarts(source) });
    }
    return elements;
}

/** The position of a page offset within the script element containing it. */
function relativePosition(element: ScriptElement, offset: number): SourcePosition {
    const relative = offset - element.start;
    const line = lineOf(element.lineStarts, relative);
    return { line, column: relative - element.lineStarts[line - 1]! + 1 };
}

/** The 1-based line an offset is on, given the lines' start offsets. */
function lineOf(starts: number[], offset: number): number {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (starts[middle]! <= offset) low = middle;
        else high = middle - 1;
    }
    return low + 1;
}
