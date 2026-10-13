<script lang="ts">
    let {
        rows,
        withTitles = false,
        style,
    }: {
        rows: [string, string][];
        /** Show the full value on hover, for values that may be truncated. */
        withTitles?: boolean;
        style?: string;
    } = $props();
</script>

<div class="list" {style}>
    {#each rows as [k, v] (k)}
        <div class="row">
            <div class="k">{k}</div>
            <div class="v" title={withTitles ? v : undefined}>{v}</div>
        </div>
    {/each}
</div>
