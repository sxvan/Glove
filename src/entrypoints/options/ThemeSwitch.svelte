<script lang="ts">
    // The extension's appearance as a segmented control: the system's, light or dark.
    import { setTheme, storedTheme, type Theme } from '@/lib/theme';

    const THEMES: { theme: Theme; label: string }[] = [
        { theme: 'system', label: 'System' },
        { theme: 'light', label: 'Light' },
        { theme: 'dark', label: 'Dark' },
    ];
    let theme = $state<Theme>(storedTheme());

    function choose(next: Theme) {
        theme = next;
        setTheme(next);
    }
</script>

<div class="segments" role="radiogroup" aria-label="Appearance">
    {#each THEMES as option (option.theme)}
        <button type="button" role="radio" class="segment" class:active={theme === option.theme} aria-checked={theme === option.theme} onclick={() => choose(option.theme)}>
            {option.label}
        </button>
    {/each}
</div>

<style>
    /* One rounded track with the chosen segment raised on it, as in Apple's segmented controls. */
    .segments {
        display: inline-grid;
        grid-auto-columns: 1fr;
        grid-auto-flow: column;
        gap: 2px;
        padding: 2px;
        border-radius: 9px;
        background: var(--bg);
    }

    .segment {
        min-width: 80px;
        padding: 5px 14px;
        border: 0;
        border-radius: 7px;
        background: none;
        color: var(--muted);
        font: inherit;
        font-size: 14px;
        cursor: pointer;
    }

    .segment:hover {
        color: var(--text);
    }

    .segment.active {
        background: var(--surface);
        box-shadow: 0 1px 3px var(--shadow);
        color: var(--text);
        font-weight: 500;
    }
</style>
