<script lang="ts">
    // The way back from a screen, above it.
    let { onBack }: { onBack: () => void } = $props();
</script>

<div class="head">
    <button class="back" type="button" onclick={onBack}>
        <span class="arrow" aria-hidden="true"></span>Back
    </button>
</div>

<style>
    .back {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--muted);
        font-size: 12px;
        cursor: pointer;
    }

    .back:hover {
        color: var(--text);
    }

    .arrow {
        width: 6px;
        height: 6px;
        border-left: 2px solid currentColor;
        border-bottom: 2px solid currentColor;
        transform: rotate(45deg);
    }
</style>
