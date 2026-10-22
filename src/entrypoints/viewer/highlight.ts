import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import type { CodeLocation } from './locations';

hljs.registerLanguage('javascript', javascript);

// Private-use characters that mark where locations start and end while highlight.js runs; they pass
// through as plain text and are then replaced with <mark> elements.
const START = '';
const END = '';

// A mark crossing a highlight.js span is still shown: the browser repairs the nesting.
export function highlightWithLocations(code: string, locations: CodeLocation[], firstId = 0): string {
    // Same-length replacement, so the locations' offsets stay valid.
    const clean = code.replace(/[]/g, '�');

    let marked = '';
    let position = 0;
    for (const { start, end } of locations) {
        marked += clean.slice(position, start) + START + clean.slice(start, end) + END;
        position = end;
    }
    marked += clean.slice(position);

    const html = hljs.highlight(marked, { language: 'javascript', ignoreIllegals: true }).value;

    let hit = 0;
    return html.replace(/[]/g, (char) => {
        if (char === END) return '</mark>';
        const location = locations[hit]!;
        const kind = !location.exact ? 'search' : location.confirmed ? 'exact' : 'exact unconfirmed';
        const title = (location.generated ? 'Called from code generated here: ' : '') + location.apis.join(', ');
        return `<mark class="hit ${kind}" id="hit-${firstId + hit++}" title="${escapeHtml(title)}">`;
    });
}

function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
