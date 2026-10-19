<script lang="ts">
    // What the extension may send off the browser (see lib/privacy), saved as soon as switched.
    import { onMount } from 'svelte';
    import { DEFAULT_PRIVACY, loadPrivacy, savePrivacy, type PrivacyOptions } from '@/lib/privacy';
    import Switch from '../popup/components/Switch.svelte';

    let options = $state<PrivacyOptions>({ ...DEFAULT_PRIVACY });

    onMount(async () => {
        options = await loadPrivacy();
    });

    function setDnsLookups(on: boolean) {
        options.dnsLookups = on;
        savePrivacy($state.snapshot(options));
    }

    const changed = $derived(options.dnsLookups !== DEFAULT_PRIVACY.dnsLookups);
</script>

<label class="row">
    <div>
        <div class="name">DNS lookups</div>
        <div class="description">
            To find CNAME cloaking, another company's tracker behind an address of the site, the page's own subdomains are looked up at a DNS resolver
            (dns.google), which learns them and your IP address. Off, nothing is looked up, and cloaking isn't detected or scored.
        </div>
    </div>
    <Switch checked={options.dnsLookups} onchange={setDnsLookups} />
    <span class="default" class:changed>default {DEFAULT_PRIVACY.dnsLookups ? 'on' : 'off'}</span>
</label>

<style>
    /* The switch sits where the other settings have their input, at its end (see BlockingSettings). */
    .row > :global(input[role='switch']) {
        justify-self: end;
    }
</style>
