(function installHttpHooks() {
    hookFetch();
    hookXHR();
})();

function recordHttpEvent(id, url, method, credentials) {
    /** @type {HttpMonkeyEvent} */
    const httpMonkeyEvent = {
        id: id,
        timeStamp: Date.now(),
        scriptUrl: getCallerScriptUrl(),
        requestUrl: url,
        method: method,
        credentials: credentials,
    };

    document.documentElement.dispatchEvent(new CustomEvent('http-monkey', { detail: httpMonkeyEvent }));
}

function hookFetch() {
    const originalFetch = window.fetch;
    if (typeof originalFetch !== 'function') {
        return;
    }

    // @ts-ignore
    if (originalFetch.__is_hooked__) {
        return;
    }

    window.fetch = function (input, init) {
        let req;

        if (input instanceof Request) {
            req = init ? new Request(input, init) : input;
        } else {
            req = new Request(input, init);
        }

        recordHttpEvent('fetch', req.url, req.method, req.cache);

        return originalFetch.apply(this, arguments);
    };

    // @ts-ignore
    window.fetch.__is_hooked__ = true;
}

function hookXHR() {
    const OriginalXHR = window.XMLHttpRequest;
    if (typeof OriginalXHR !== 'function') {
        return;
    }

    function HookedXHR() {
        const xhr = new OriginalXHR();

        let url = null;
        let method = null;

        const originalOpen = xhr.open;

        // @ts-ignore
        xhr.open = function (m, u, async, user, password) {
            method = m ? String(m) : null;
            url = u ? String(u) : null;

            return originalOpen.apply(this, arguments);
        };

        let host = null;
        if (url) {
            host = new URL(url).host;
        }

        const originalSend = xhr.send;
        xhr.send = function (body) {
            recordHttpEvent('xhr', url, method, xhr.withCredentials ? 'include' : 'omit');

            return originalSend.apply(this, arguments);
        };

        return xhr;
    }

    HookedXHR.prototype = OriginalXHR.prototype;
    // @ts-ignore
    window.XMLHttpRequest = HookedXHR;

    // @ts-ignore
    window.XMLHttpRequest.__is_hooked__ = true;
}

function getCallerScriptUrl() {
    const err = new Error();

    if (!err.stack) {
        return null;
    }

    const lines = err.stack.split('\n').slice(1); // skip "Error" line

    for (const line of lines) {
        const m = line.match(/\(?(\w+:\/\/[^):]+):(\d+):(\d+)\)?$/);
        if (!m) {
            continue;
        }

        const url = m[1];

        if (url.startsWith('extension://')) {
            continue;
        }

        return url;
    }

    return null;
}
