<script lang="ts">
    // A switch that blocks a script, or lets it run again (see lib/blocking). It follows the stored
    // list, so other switches for the same script stay in step.
    import { onMount } from 'svelte';
    import { browser } from 'wxt/browser';
    import { blockKey, loadBlocked, watchBlocked, type BlockedScript } from '@/lib/blocking';
    import type { SetBlockedMessage, SetBlockedResult } from '@/types/messages';

    let { url, label, detail = '' }: { url: string; label: string; detail?: string } = $props();

    const key = $derived(blockKey(url));
    let list = $state<BlockedScript[]>([]);
    const entry = $derived(list.find((script) => script.key === key));
    const blocked = $derived(entry !== undefined);
    const autoText = $derived(entry?.auto ? `Blocked automatically at score ${Math.round(entry.auto.score * 100)}` : '');
    // What was done after it was switched (see changeBlocked in background).
    let done = $state<SetBlockedResult | null>(null);

    onMount(() => {
        loadBlocked().then((loaded) => (list = loaded));
        return watchBlocked((changed) => (list = changed));
    });

    async function toggle() {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        const message: SetBlockedMessage = { type: 'SET_BLOCKED', url, blocked: !blocked, tabId: tab?.id ?? null };
        done = await browser.runtime.sendMessage(message);
    }

    function doneText(result: SetBlockedResult): string {
        if (!blocked) return result.reloaded ? 'Reloaded the page: the script runs again' : 'Reload the page to let this script run again';
        if (result.cleared) return "Cleared the site's cookies and storage and reloaded the page: it loads without this script and what it stored";
        const clear = "Clear the site's cookies and storage too, as what the script stored stays (see the settings)";
        return result.reloaded ? `Reloaded the page without this script. ${clear}` : `Reload the page to load it without this script. ${clear}`;
    }
</script>

<div class="toggle">
    <span class="text">
        <span class="label">{label}</span>
        {#if done}
            <span class="detail">{doneText(done)}</span>
        {:else if detail || autoText}
            <span class="detail">{[autoText, detail].filter(Boolean).join(' · ')}</span>
        {/if}
    </span>
    <button type="button" class="switch" role="switch" aria-checked={blocked} aria-label={label} onclick={toggle}></button>
</div>

<style>
    .toggle {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
    }

    .text {
        display: grid;
        gap: 2px;
    }

    .label {
        font-size: 14px;
        font-weight: 500;
    }

    .detail {
        color: var(--muted);
        font-size: 12px;
    }

    .switch {
        position: relative;
        width: 34px;
        height: 20px;
        padding: 0;
        border: 0;
        border-radius: 10px;
        background: color-mix(in srgb, var(--muted) 45%, var(--surface));
        cursor: pointer;
        transition: background 0.15s;
    }

    .switch::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 2px var(--shadow);
        transition: transform 0.15s;
    }

    .switch[aria-checked='true'] {
        background: var(--likely);
    }

    .switch[aria-checked='true']::after {
        transform: translateX(14px);
    }
</style>
