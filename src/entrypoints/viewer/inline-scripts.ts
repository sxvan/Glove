// Calls recorded in inline scripts have positions in the page's HTML; here they become positions in
// each script.
import type { SourcePosition, ViewerApi } from '@/lib/script-viewer';
import { lineStarts } from './locations';

interface InlineScript {
    source: string;
    /** Line of the page the script starts on, 1-based. */
    line: number;
    apis: ViewerApi[];
}

// The code ends at the first "</script", as in HTML.
const SCRIPT_ELEMENT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
// Types that run as JavaScript; other script elements hold data such as JSON or templates.
const JAVASCRIPT_TYPE = /^(?:|module|(?:text|application)\/(?:x-)?(?:java|ecma)script)$/i;

// `matched` is false when no recorded position falls into an inline script, e.g. a page that differs
// per visit: all inline scripts come back then, without positions, to search for the names.
export function inlineScripts(html: string, apis: ViewerApi[]): { scripts: InlineScript[]; matched: boolean } {
    const pageLines = lineStarts(html);
    const elements = scriptElements(html, pageLines);

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

function relativePosition(element: ScriptElement, offset: number): SourcePosition {
    const relative = offset - element.start;
    const line = lineOf(element.lineStarts, relative);
    return { line, column: relative - element.lineStarts[line - 1]! + 1 };
}

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
