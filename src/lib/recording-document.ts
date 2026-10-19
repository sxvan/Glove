/**
 * The document whose bridge the recorders in a frame hand their events to (see bridge.content):
 * the frame's own, or, for a frame without an address of its own (about:blank, about:srcdoc), the
 * nearest document above it that has one. Such a frame shares that document's origin and is filled
 * by its scripts, often created just to read from (`iframe.contentWindow.navigator`), so what is
 * read in it is recorded and scored with that document, not as a page of its own. Done here, in
 * the page, as some of these frames never tell the background who made them: one a javascript: URL
 * fills commits no navigation. Frames whose parent can't be reached from them, data: and sandboxed
 * ones (an opaque origin), are joined by the background instead (see recordingTarget).
 */
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
