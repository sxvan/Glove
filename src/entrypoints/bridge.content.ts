import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import type { RecorderEvents } from '@/types/events';
import type { RecorderMessage } from '@/types/messages';

// Forwards the main-world recorders' events to the background, which only the isolated world can reach.
export default defineContentScript({
    registration: 'runtime',
    matches: ['<all_urls>'],
    runAt: 'document_start',
    allFrames: true,
    matchAboutBlank: true,
    matchOriginAsFallback: true,
    noScriptStartedPostMessage: true,

    main() {
        // Once the extension is gone (reloaded, updated, removed), this script can't reach it any more.
        const listening = new AbortController();

        // Only the background can stop the calls (see lib/limits), not the page's scripts.
        let callsStopped = false;

        function send(message: RecorderMessage) {
            // runtime.id is undefined once the extension context is invalidated.
            if (!browser.runtime?.id) {
                listening.abort();
                return;
            }
            try {
                // Rejects while the background isn't ready, e.g. as the extension is reloaded.
                browser.runtime.sendMessage(message).then(
                    (answer: { stop?: boolean } | undefined) => {
                        if (answer?.stop) callsStopped = true;
                    },
                    () => {}
                );
            } catch {
                // Throws "Extension context invalidated" when the extension went away meanwhile.
                listening.abort();
            }
        }

        function listen<K extends keyof RecorderEvents>(name: K, onEvent: (detail: RecorderEvents[K]) => void) {
            document.documentElement.addEventListener(name, (event) => onEvent((event as CustomEvent<RecorderEvents[K]>).detail), { signal: listening.signal });
        }

        listen('glove-api-calls', (detail) => {
            if (!callsStopped && Array.isArray(detail) && detail.length > 0) send({ type: 'fp-batch', payload: detail });
        });
        listen('glove-storage', (detail) => {
            if (Array.isArray(detail) && detail.length > 0) send({ type: 'storage-batch', payload: detail });
        });
        listen('glove-request', (detail) => {
            if (detail) send({ type: 'http', payload: detail });
        });
    },
});
