// A frame without an address of its own (about:blank, about:srcdoc) is often made just to read from
// (`iframe.contentWindow.navigator`), so it records to the nearest document above it that has one.
// Done in the page, as a frame a javascript: URL fills commits no navigation the background sees;
// data: and sandboxed frames can't reach their parent and are joined by the background (see recordingTarget).
export function recordingDocument(): Document {
    let current: Window = window;
    while (current.location.protocol === 'about:' && current.parent !== current) {
        try {
            // Throws for a parent of another origin.
            void current.parent.document;
        } catch {
            break;
        }
        current = current.parent;
    }
    return current.document;
}
