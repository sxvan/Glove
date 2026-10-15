<script lang="ts">
    // A sign that a script hides what it does, with a warning icon.
    let { text }: { text: string } = $props();
</script>

<li class="signal">
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M8 1.8 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
        <path d="M8 6.2v3.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <circle cx="8" cy="11.7" r="0.9" fill="currentColor" />
    </svg>
    <span>{text}</span>
</li>

<style>
    .signal {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: start;
        gap: 8px;
        font-size: 12px;
    }

    svg {
        margin-top: 1px;
        color: var(--possible);
    }
</style>
