// The script viewer page (entrypoints/viewer) gets everything it shows through its query string,
// built by the popup and parsed by the viewer with the functions below.
import { browser } from 'wxt/browser';

/** Positions passed per API; the most-called ones come first, so the cap keeps the important ones. */
const MAX_POSITIONS_PER_API = 50;

export interface SourcePosition {
    /** 1-based, as in stack traces. */
    line: number;
    column: number;
}

export interface ViewerApi {
    id: string;
    /** Calls recorded in the page; null if unknown. */
    calls: number | null;
    /** Positions in the script the API was called from, as recorded from the call stack. */
    positions: SourcePosition[];
}

export interface ViewerParams {
    /** The script to show, or for inline scripts the page; only http and https URLs are accepted. */
    url: string;
    name: string;
    apis: ViewerApi[];
    /** True for scripts inline in the page at `url`; their positions are positions in the page. */
    inline: boolean;
}

/** The extension's script viewer showing `params`. */
export function viewerUrl(params: ViewerParams): string {
    return browser.runtime.getURL('/viewer.html') + viewerQuery(params);
}

/** Each API is encoded as `id[:calls][@line:column;line:column…]`, separated by commas. */
export function viewerQuery({ url, name, apis, inline }: ViewerParams): string {
    const encoded = apis.map(({ id, calls, positions }) => {
        const count = calls === null ? '' : `:${calls}`;
        const at = positions
            .slice(0, MAX_POSITIONS_PER_API)
            .map((p) => `${p.line}:${p.column}`)
            .join(';');
        return `${id}${count}${at ? `@${at}` : ''}`;
    });
    const query = new URLSearchParams({ url, name, apis: encoded.join(',') });
    if (inline) query.set('inline', '1');
    return `?${query}`;
}

export function parseViewerQuery(search: string): ViewerParams | null {
    const params = new URLSearchParams(search);
    const url = params.get('url') ?? '';
    try {
        const { protocol } = new URL(url);
        if (protocol !== 'http:' && protocol !== 'https:') return null;
    } catch {
        return null;
    }

    const apis = (params.get('apis') ?? '')
        .split(',')
        .filter(Boolean)
        .map((entry): ViewerApi => {
            const [head = '', at = ''] = entry.split('@');
            const [id = '', calls] = head.split(':');
            const count = Number(calls);
            const positions = at
                .split(';')
                .map((pair) => pair.split(':').map(Number))
                .filter(([line, column]) => Number.isInteger(line) && Number.isInteger(column) && line! > 0 && column! > 0)
                .map(([line, column]) => ({ line: line!, column: column! }));
            return { id, calls: calls !== undefined && Number.isFinite(count) ? count : null, positions };
        });

    return { url, name: params.get('name') || url, apis, inline: params.get('inline') === '1' };
}
