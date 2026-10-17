<script module lang="ts">
    // One canvas to measure text with, shared by all instances.
    let context: CanvasRenderingContext2D | null = null;
    function measure(text: string, font: string): number {
        context ??= document.createElement('canvas').getContext('2d');
        if (!context) return 0;
        context.font = font;
        return context.measureText(text).width;
    }

    // Re-measures once the bundled font has loaded, as it is wider than the fallback.
    let fontsLoaded = $state(false);
    if (typeof document !== 'undefined') document.fonts?.ready.then(() => (fontsLoaded = true));
</script>

<script lang="ts">
    // A name on one line that, when too long, is shortened in the middle, keeping its end:
    // - a URL path (`path`) keeps its file name, from its last "/", and shortens the folders before
    //   it: "/d6u0JtnNFN/8-uXtx…/OCw". If the file name alone doesn't fit, it is shortened like any
    //   other name, after "…" for the folders: "…/launch-ENdd5c…1000d75.min.js". Its parameters
    //   (from the first "?" or ";") are cut first, from their end, and its last "/" is the one before
    //   them, as their values can hold URLs: "/ddm/trackimp/N17…/B36957478.459407447…";
    // - anything else keeps its last `tail` characters: "resources.digital-clo…medallia.com".
    // CSS has no ellipsis in the middle, and two boxes would leave a gap after it, so the text is
    // fitted to the width here.
    // `plain` keeps a path in one color, for text that is toned down as a whole.
    let { text, path = false, tail = 12, plain = false }: { text: string; path?: boolean; tail?: number; plain?: boolean } = $props();

    let box = $state<HTMLElement>();
    let width = $state(0);

    /** Where a path's parameters start: its first "?" or ";", or its length without any. */
    function paramsAt(text: string): number {
        const at = text.search(/[?;]/);
        return at >= 0 ? at : text.length;
    }

    /** The part that always shows. */
    function endOf(text: string): string {
        if (path) {
            const lastSlash = text.lastIndexOf('/');
            // A file at the root ("/launch-….min.js") is all file name, its slash at index 0.
            return lastSlash >= 0 ? text.slice(lastSlash) : '';
        }
        return text.length > tail * 2 ? text.slice(-tail) : '';
    }

    /**
     * `text` with as much of its start as fits before "…" and `end`, between `prefix` and
     * `suffix`; null if not even those fit.
     */
    function fit(text: string, end: string, prefix: string, font: string, suffix = ''): string | null {
        const fits = (n: number) => measure(prefix + text.slice(0, n) + '…' + end + suffix, font) <= width;
        if (!fits(0)) return null;
        // The longest start that still fits, by binary search.
        let low = 0;
        let high = text.length - end.length;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (fits(mid)) low = mid;
            else high = mid - 1;
        }
        return prefix + text.slice(0, low) + '…' + end;
    }

    const shown = $derived.by(() => {
        void fontsLoaded;
        if (!box || width <= 0) return text;
        const font = getComputedStyle(box).font;
        if (measure(text, font) <= width) return text;

        if (!path) return fit(text, endOf(text), '', font) ?? text;

        // A path: its parameters go first, shortened from their end while the rest fits.
        const base = text.slice(0, paramsAt(text));
        const params = text.slice(base.length);
        if (params && measure(base + '…', font) <= width) return fit(params, '', base, font) ?? text;

        // Then the folders, keeping the file name, with "…" for any parameters after it.
        const more = params ? '…' : '';
        const end = endOf(base);
        const shortened = fit(base, end, '', font, more);
        if (shortened !== null || !end) return shortened ?? text;

        // The file name alone doesn't fit: shorten it, keeping its last characters, after "…" for
        // the folders before it (if any).
        const prefix = end.length < base.length ? '…' : '';
        const fileEnd = end.length > tail * 2 ? end.slice(-tail) : '';
        return fit(end, fileEnd, prefix, font, more) ?? prefix + end + more;
    });

    // The shown path split into its folders (up to the last "/" before any parameters), its file
    // name, and its parameters. The file name never contains a slash, also when shortened.
    const paramsStart = $derived(path ? paramsAt(shown) : shown.length);
    const folders = $derived(path ? shown.slice(0, shown.lastIndexOf('/', paramsStart - 1) + 1) : '');
    const file = $derived(shown.slice(folders.length, paramsStart));
    const params = $derived(shown.slice(paramsStart));
</script>

<!-- A path's folders and parameters are toned down, so the file name stands out. -->
<span class="truncate" bind:this={box} bind:clientWidth={width}
    >{#if path && folders}<span class="folders" class:plain>{folders}</span>{/if}{file}{#if params}<span class="folders" class:plain>{params}</span>{/if}</span
>

<style>
    .truncate {
        display: block;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .folders {
        color: var(--muted);
    }

    .folders.plain {
        color: inherit;
    }
</style>
