<script lang="ts">
    // Its chevron like the one of "How the score came about" (see FingerprintCard).
    let { title, count, open = $bindable(true) }: { title: string; count: number; open?: boolean } = $props();
</script>

<h3>
    <button type="button" aria-expanded={open} onclick={() => (open = !open)}>
        {title} <span class="count">{count}</span>
        <span class="chevron" class:open aria-hidden="true"></span>
    </button>
</h3>

<style>
    h3 {
        margin: 8px 0 -8px;
        font-size: 14px;
        font-weight: 600;
    }

    button {
        display: inline-flex;
        align-items: center;
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        cursor: pointer;
    }

    .count {
        margin-left: 4px;
        color: var(--muted);
        font-weight: 400;
    }

    .chevron {
        margin-left: 8px;
        width: 6px;
        height: 6px;
        margin-top: -4px;
        border-right: 1.5px solid var(--muted);
        border-bottom: 1.5px solid var(--muted);
        transform: rotate(45deg);
    }

    .chevron.open {
        margin-top: 4px;
        transform: rotate(-135deg);
    }

    button:hover .chevron {
        border-color: var(--text);
    }
</style>
