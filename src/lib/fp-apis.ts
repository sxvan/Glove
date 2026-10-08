export type FpApiOwner =
    | 'Navigator'
    | 'Screen'
    | 'Window'
    | 'Document'
    | 'HTMLCanvasElement'
    | 'CanvasRenderingContext2D'
    | 'WebGLRenderingContext'
    | 'WebGL2RenderingContext'
    | 'AudioContext'
    | 'OfflineAudioContext'
    | 'AudioBuffer'
    | 'MediaDevices'
    | 'RTCPeerConnection'
    | 'IntlDateTimeFormat';

export interface FpApi {
    id: string;
    owner: FpApiOwner;
    prop: string;
    category: string;
    weight: number;
}

export const FP_APIS: FpApi[] = [
    // Navigator – medium FP (some strong ones)
    { id: 'navigator.userAgent', owner: 'Navigator', prop: 'userAgent', category: 'Navigator', weight: 1.5 },
    { id: 'navigator.platform', owner: 'Navigator', prop: 'platform', category: 'Navigator', weight: 1.5 },
    { id: 'navigator.language', owner: 'Navigator', prop: 'language', category: 'Navigator', weight: 1.5 },
    { id: 'navigator.languages', owner: 'Navigator', prop: 'languages', category: 'Navigator', weight: 1.5 },
    { id: 'navigator.hardwareConcurrency', owner: 'Navigator', prop: 'hardwareConcurrency', category: 'Navigator', weight: 2 },
    { id: 'navigator.deviceMemory', owner: 'Navigator', prop: 'deviceMemory', category: 'Navigator', weight: 2 },
    { id: 'navigator.maxTouchPoints', owner: 'Navigator', prop: 'maxTouchPoints', category: 'Navigator', weight: 1.5 },
    { id: 'navigator.vendor', owner: 'Navigator', prop: 'vendor', category: 'Navigator', weight: 1 },
    { id: 'navigator.webdriver', owner: 'Navigator', prop: 'webdriver', category: 'Navigator', weight: 2 }, // bot / automation hint
    { id: 'navigator.plugins', owner: 'Navigator', prop: 'plugins', category: 'Navigator', weight: 2.5 },
    { id: 'navigator.mimeTypes', owner: 'Navigator', prop: 'mimeTypes', category: 'Navigator', weight: 2 },

    // Screen – mostly low/medium entropy
    { id: 'screen.width', owner: 'Screen', prop: 'width', category: 'Screen', weight: 1 },
    { id: 'screen.height', owner: 'Screen', prop: 'height', category: 'Screen', weight: 1 },
    { id: 'screen.availWidth', owner: 'Screen', prop: 'availWidth', category: 'Screen', weight: 1 },
    { id: 'screen.availHeight', owner: 'Screen', prop: 'availHeight', category: 'Screen', weight: 1 },
    { id: 'screen.colorDepth', owner: 'Screen', prop: 'colorDepth', category: 'Screen', weight: 1.5 },
    { id: 'screen.pixelDepth', owner: 'Screen', prop: 'pixelDepth', category: 'Screen', weight: 1.5 },
    { id: 'screen.orientation', owner: 'Screen', prop: 'orientation', category: 'Screen', weight: 1 },

    // Window geometry / zoom – needed, but also noisy
    { id: 'window.innerWidth', owner: 'Window', prop: 'innerWidth', category: 'Window', weight: 1 },
    { id: 'window.innerHeight', owner: 'Window', prop: 'innerHeight', category: 'Window', weight: 1 },
    { id: 'window.outerWidth', owner: 'Window', prop: 'outerWidth', category: 'Window', weight: 1 },
    { id: 'window.outerHeight', owner: 'Window', prop: 'outerHeight', category: 'Window', weight: 1 },
    { id: 'window.devicePixelRatio', owner: 'Window', prop: 'devicePixelRatio', category: 'Window', weight: 2 },
    { id: 'window.screenX', owner: 'Window', prop: 'screenX', category: 'Window', weight: 1.5 },
    { id: 'window.screenY', owner: 'Window', prop: 'screenY', category: 'Window', weight: 1.5 },

    // Document – more “tracking” than FP, so low
    { id: 'document.referrer', owner: 'Document', prop: 'referrer', category: 'Document', weight: 0.5 },
    { id: 'document.cookie', owner: 'Document', prop: 'cookie', category: 'Document', weight: 0.5 },

    // Canvas 2D – classic strong FP
    { id: 'canvas.toDataURL', owner: 'HTMLCanvasElement', prop: 'toDataURL', category: 'Canvas', weight: 3 },
    { id: 'canvas.toBlob', owner: 'HTMLCanvasElement', prop: 'toBlob', category: 'Canvas', weight: 2 },
    { id: 'canvas.getImageData', owner: 'CanvasRenderingContext2D', prop: 'getImageData', category: 'Canvas', weight: 3 },
    { id: 'canvas.measureText', owner: 'CanvasRenderingContext2D', prop: 'measureText', category: 'Canvas', weight: 2.5 },

    // WebGL – very strong FP
    { id: 'webgl.getParameter', owner: 'WebGLRenderingContext', prop: 'getParameter', category: 'WebGL', weight: 2.5 },
    { id: 'webgl.getExtension', owner: 'WebGLRenderingContext', prop: 'getExtension', category: 'WebGL', weight: 2 },
    { id: 'webgl.getSupportedExtensions', owner: 'WebGLRenderingContext', prop: 'getSupportedExtensions', category: 'WebGL', weight: 2 },
    { id: 'webgl.readPixels', owner: 'WebGLRenderingContext', prop: 'readPixels', category: 'WebGL', weight: 3 },

    // WebGL2 – same story
    { id: 'webgl2.getParameter', owner: 'WebGL2RenderingContext', prop: 'getParameter', category: 'WebGL2', weight: 2.5 },
    { id: 'webgl2.getExtension', owner: 'WebGL2RenderingContext', prop: 'getExtension', category: 'WebGL2', weight: 2 },
    { id: 'webgl2.getSupportedExtensions', owner: 'WebGL2RenderingContext', prop: 'getSupportedExtensions', category: 'WebGL2', weight: 2 },
    { id: 'webgl2.readPixels', owner: 'WebGL2RenderingContext', prop: 'readPixels', category: 'WebGL2', weight: 3 },

    // Audio – audio fingerprinting is strong
    { id: 'audiocontext.createAnalyser', owner: 'AudioContext', prop: 'createAnalyser', category: 'AudioContext', weight: 2.5 },
    { id: 'audiocontext.createOscillator', owner: 'AudioContext', prop: 'createOscillator', category: 'AudioContext', weight: 2 },
    { id: 'offlineaudiocontext.startRendering', owner: 'OfflineAudioContext', prop: 'startRendering', category: 'AudioContext', weight: 3 },
    { id: 'audiobuffer.getChannelData', owner: 'AudioBuffer', prop: 'getChannelData', category: 'AudioBuffer', weight: 3 },

    // Media / devices – very revealing
    { id: 'mediadevices.enumerateDevices', owner: 'MediaDevices', prop: 'enumerateDevices', category: 'MediaDevices', weight: 3 },
    { id: 'mediadevices.getUserMedia', owner: 'MediaDevices', prop: 'getUserMedia', category: 'MediaDevices', weight: 2.5 },

    // WebRTC – can expose network / IP
    { id: 'webrtc.createDataChannel', owner: 'RTCPeerConnection', prop: 'createDataChannel', category: 'WebRTC', weight: 2 },
    { id: 'webrtc.addIceCandidate', owner: 'RTCPeerConnection', prop: 'addIceCandidate', category: 'WebRTC', weight: 3 },
    { id: 'webrtc.setLocalDescription', owner: 'RTCPeerConnection', prop: 'setLocalDescription', category: 'WebRTC', weight: 3 },

    // Intl / timezone – useful for FP, but not crazy
    { id: 'intl.datetimeformat.resolvedOptions', owner: 'IntlDateTimeFormat', prop: 'resolvedOptions', category: 'Intl', weight: 2 },
];

export const FP_APIS_BY_ID: Record<string, FpApi> = Object.fromEntries(FP_APIS.map((api) => [api.id, api]));

export const FP_TOTAL_WEIGHT = FP_APIS.reduce((sum, api) => sum + api.weight, 0);

export const FP_CATEGORY_WEIGHTS: Record<string, number> = (() => {
    const map = new Map<string, { sum: number; count: number }>(); // category -> { sum, count }

    for (const api of FP_APIS) {
        const cat = api.category || 'Unknown';
        const w = api.weight ?? 1;

        let entry = map.get(cat);
        if (!entry) {
            entry = { sum: 0, count: 0 };
            map.set(cat, entry);
        }

        entry.sum += w;
        entry.count += 1;
    }

    // Convert to final constant object
    const out: Record<string, number> = {};
    for (const [cat, { sum, count }] of map.entries()) {
        out[cat] = sum / count; // average weight
    }

    return out;
})();

export const FP_CATEGORIES_TOTAL_WEIGHT = Object.values(FP_CATEGORY_WEIGHTS).reduce((acc, w) => acc + w, 0);
