(function injectFpScript() {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = chrome.runtime.getURL('page/fp-recorder.js');
    document.documentElement.prepend(script);
    script.remove();
})();

document.documentElement.addEventListener(
    'fp-monkey',
    /** @param {CustomEvent<FpMonkeyEvent>} event */ (event) => {
        if (event.detail) {
            chrome.runtime.sendMessage({ type: 'fp', payload: event.detail });
        }
    }
);
