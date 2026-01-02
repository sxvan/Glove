import { FP_APIS } from '../common/fp-apis.js';

(function installFpHooks() {
    for (const target of FP_APIS) {
        const proto = getProtoForOwner(target.owner);
        hookAny(proto, target.prop, target.id);
    }

    console.log('FP hooks installed');
})();

function getProtoForOwner(owner) {
    switch (owner) {
        case 'Navigator':
            return Navigator.prototype;
        case 'Screen':
            return Screen.prototype;
        case 'Window':
            return window;
        case 'Document':
            return Document.prototype;
        case 'HTMLCanvasElement':
            return HTMLCanvasElement.prototype;
        case 'CanvasRenderingContext2D':
            return CanvasRenderingContext2D.prototype;
        case 'WebGLRenderingContext':
            return window.WebGLRenderingContext && WebGLRenderingContext.prototype;
        case 'WebGL2RenderingContext':
            return window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
        case 'AudioContext':
            return window.AudioContext && AudioContext.prototype;
        case 'OfflineAudioContext':
            return window.OfflineAudioContext && OfflineAudioContext.prototype;
        case 'AudioBuffer':
            return AudioBuffer.prototype;
        case 'MediaDevices':
            return navigator.mediaDevices;
        case 'RTCPeerConnection':
            return window.RTCPeerConnection && RTCPeerConnection.prototype;
        case 'IntlDateTimeFormat':
            return Intl.DateTimeFormat.prototype;
        default:
            return null;
    }
}

function recordFpEvent(id) {
    /** @type {FpMonkeyEvent} */
    const fpMonkeyEvent = {
        id: id,
        timeStamp: Date.now(),
        scriptUrl: getCallerScriptUrl(),
    };

    document.documentElement.dispatchEvent(new CustomEvent('fp-monkey', { detail: fpMonkeyEvent }));
}

function hookAny(proto, prop, id) {
    if (!proto) {
        return;
    }

    const descriptor = Object.getOwnPropertyDescriptor(proto, prop);

    if (descriptor && typeof descriptor.get === 'function') {
        hookGetter(proto, prop, id);
        return;
    }

    if (typeof proto[prop] === 'function') {
        hookMethod(proto, prop, id);
    }
}

function hookMethod(proto, prop, id) {
    const original = proto && proto[prop];
    if (typeof original !== 'function') {
        return;
    }

    if (original.__is_hooked__) {
        return;
    }

    const wrapped = function (...args) {
        recordFpEvent(id);
        return original.apply(this, args);
    };

    wrapped.__is_hooked__ = true;
    proto[prop] = wrapped;
}

function hookGetter(proto, prop, id) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
    const original = descriptor?.get;
    if (!original || typeof original !== 'function') {
        return;
    }

    // @ts-ignore
    if (descriptor.get.__is_hooked__) {
        return;
    }

    const wrapped = function () {
        recordFpEvent(id);
        return original.apply(this);
    };

    wrapped.__is_hooked__ = true;

    Object.defineProperty(proto, prop, {
        ...descriptor,
        get: wrapped,
    });
}

function getCallerScriptUrl() {
    const err = new Error();

    if (!err.stack) {
        return null;
    }

    const lines = err.stack.split('\n').slice(1); // skip "Error" line

    for (const line of lines) {
        // capture full URL (including ports) before :line:col
        const m = line.match(/((?:\w+:\/\/|blob:|data:|about:|file:).*?):\d+:\d+/);
        if (!m) {
            continue;
        }

        const url = m[1];

        // skip extension scripts (chrome-extension://...)
        if (url.startsWith('extension://')) {
            continue;
        }

        return url;
    }

    console.warn('Could not determine caller script URL from stack trace:', err.stack);
    return null;
}
