(function injectHttpScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('page/http-recorder.js');
    document.documentElement.prepend(script);
    script.remove();
})();

document.documentElement.addEventListener(
    'http-monkey',
    /** @param {CustomEvent<HttpMonkeyEvent>} event  */ (event) => {
        if (event.detail) {
            chrome.runtime.sendMessage({ type: 'http', payload: event.detail });
        }
    }
);
