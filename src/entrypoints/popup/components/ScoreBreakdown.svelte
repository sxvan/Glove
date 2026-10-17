<script lang="ts">
    import type { ScoreNode } from '../model';
    import ScoreTree from './ScoreTree.svelte';

    // A toggle that opens the signals a score was combined from; the score itself is shown as a
    // ring by the card it belongs to.
    let { tree, label = 'Score breakdown' }: { tree: ScoreNode[]; label?: string } = $props();

    let open = $state(false);
</script>

{#if tree.length > 0}
    <div class="breakdown">
        <button type="button" class="toggle" aria-expanded={open} onclick={() => (open = !open)}>
            <span class="chevron" class:open aria-hidden="true"></span>{label}
        </button>
        {#if open}
            <div class="signals">
                <ScoreTree nodes={tree} />
            </div>
        {/if}
    </div>
{/if}

<style>
    .toggle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--muted);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
    }

    .toggle:hover {
        color: var(--text);
    }

    .chevron {
        width: 0;
        height: 0;
        border-top: 4px solid transparent;
        border-bottom: 4px solid transparent;
        border-left: 5px solid currentColor;
        transition: transform 0.1s;
    }

    .chevron.open {
        transform: rotate(90deg);
    }

    .signals {
        margin-top: 12px;
    }
</style>
