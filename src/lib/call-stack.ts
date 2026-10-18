// Reads which page scripts are on the call stack, for the recorders running in the page. Uses V8's
// structured stack frames (see https://v8.dev/docs/stack-trace-api) rather than parsing the stack
// text, so generated code and URLs with ports are handled.

// URLs of scripts, as opposed to e.g. "" for generated code; the scheme can't contain "-", so
// extension URLs (chrome-extension://) don't match and the extension's own frames are skipped.
const SCRIPT_URL = /^(?:\w+:\/\/|blob:|data:|about:|file:)/;
// The script and position in an eval origin, e.g. "eval at f (https://example.com/a.js:1:200)".
const EVAL_ORIGIN = /((?:\w+:\/\/|blob:|data:|about:|file:).*?):(\d+):(\d+)\)/;

export interface StackLocation {
    url: string;
    /** 1-based, as in stack traces. */
    line: number;
    column: number;
    /** True for code generated at runtime (new Function, eval); the position is where it was generated. */
    generated: boolean;
    /** For generated code, the position of the call inside it (1-based, relative to the generated source). */
    inner?: { line: number; column: number };
}

/** Where a call was made from, enough to tell places apart (see placeKey). */
export interface CallPlace {
    line: number | null;
    column: number | null;
    generated?: boolean;
    innerLine?: number | null;
    innerColumn?: number | null;
}

/**
 * A place in the code, as a key: its position in the script, and for generated code also the
 * position inside it. All of a piece of generated code has the position it was generated at, so
 * without the inner position everything it calls would look like one place.
 */
export function placeKey(place: CallPlace): string {
    const inner = place.generated && place.innerLine != null && place.innerColumn != null ? `>${place.innerLine}:${place.innerColumn}` : '';
    return `${place.line}:${place.column}${inner}`;
}

/**
 * The browser's types don't include V8's frames, as they're V8-specific; Node's types do, since
 * Node runs on V8 as well.
 */
type CallSite = NodeJS.CallSite;

/**
 * Creates a reader for the page scripts on the stack, reading up to `maxFrames` frames. Call it
 * before page scripts run: it captures Error.captureStackTrace then, so a page that patches it
 * can't affect the reader.
 */
export function createStackReader(maxFrames: number): (hook: Function) => StackLocation[] {
    const captureStackTrace = (Error as unknown as { captureStackTrace: (target: object, skipAbove: Function) => void }).captureStackTrace;

    /** Captures the stack from the caller of `hook` on, leaving out the extension's own frames. */
    function captureSites(hook: Function): CallSite[] {
        const holder: { stack?: CallSite[] } = {};
        const savedLimit = Error.stackTraceLimit;
        const savedPrepare = Error.prepareStackTrace;
        let sites: CallSite[] | undefined;

        // Assigning can throw if the page froze Error; the capture then fails or uses the page's limit.
        try {
            Error.stackTraceLimit = maxFrames;
            Error.prepareStackTrace = (_error, callSites) => callSites;
        } catch {}

        try {
            captureStackTrace(holder, hook);
            // The stack is prepared when first read, so it has to be read before restoring.
            sites = holder.stack;
        } catch {
        } finally {
            try {
                Error.stackTraceLimit = savedLimit;
                Error.prepareStackTrace = savedPrepare;
            } catch {}
        }

        return Array.isArray(sites) ? sites : [];
    }

    /**
     * The page script positions on the stack, from the caller of `hook` outwards. Code generated with
     * new Function or eval has no URL of its own; it counts for the script that generated it, at the
     * place it did, with the position inside the generated code as well.
     */
    return (hook) => {
        const locations: StackLocation[] = [];
        for (const site of captureSites(hook)) {
            const generated = site.isEval();
            const origin = generated ? EVAL_ORIGIN.exec(site.getEvalOrigin() ?? '') : null;
            const url = generated ? origin?.[1] : site.getFileName();
            const line = generated ? Number(origin?.[2]) : site.getLineNumber();
            const column = generated ? Number(origin?.[3]) : site.getColumnNumber();
            if (!url || !SCRIPT_URL.test(url) || !line || !column) continue;
            const innerLine = generated ? site.getLineNumber() : null;
            const innerColumn = generated ? site.getColumnNumber() : null;
            locations.push({ url, line, column, generated, ...(innerLine && innerColumn ? { inner: { line: innerLine, column: innerColumn } } : {}) });
        }
        return locations;
    };
}
