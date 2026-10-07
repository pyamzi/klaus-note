// What Klaus provides on Anki pages in place of Anki's Qt window, injected
// before any page script runs. Anki's webview injects a QWebChannel
// `pycmd`/`bridgeCommand`; Klaus defines it here. Requests that need the host's
// data or native UI go to /_anki/<method> instead (the bridge and Klaus's shell
// answer those).
(() => {
    const page = location.pathname.split("/")[1];
    const embedded = window.parent !== window;
    const mode = new URLSearchParams(location.search).get("mode") ?? "add";
    const initialNote = { nid: null, notetypeId: null, focusTo: 0, originalNoteId: null,
        reviewerCardId: null, deckId: null, initial: true };
    let initializeEditor;
    const handlers = {
        // aqt/editor.py NewEditor._set_ready -> load_note, in add mode.
        editorReady() {
            if (initializeEditor) return initializeEditor();
            if (mode !== "add") return;
            globalThis.require("anki/ui").loaded.then(() => globalThis.loadNote(initialNote));
        },
        // Context-menu actions. Cut/copy work from script; paste doesn't (browsers
        // block it), so, like Anki's Qt host, Klaus's shell sends the native paste
        // action, which fires a real paste event with clipboard data.
        cut: () => document.execCommand("cut"),
        copy: () => document.execCommand("copy"),
        paste: () =>
            fetch("/_anki/klausPaste", { method: "POST", headers: { "Content-Type": "application/binary" } }),
    };
    // Everything else (focus:N, blur:N, key:N, saved, editorState:…) is a
    // notification Klaus doesn't need yet.
    // Embedded (the browser's side editor): the page hosting the editor plays Qt's
    // part, so it hears every command (editorReady, key:N, saved, preview).
    // Anki's browser redraws a row when the editor's save op completes
    // (operation_did_execute); tell the host page when updateNotes returns.
    let focusedField = 0;
    if (embedded && page === "editor") {
        const fetch = globalThis.fetch;
        let checkingClose = false;
        let closeAllowed = false;
        let closeCheck;
        let hasNote = false;
        let generation = 0;
        const pendingSaves = new Set();
        let saveError;
        let writeTail = Promise.resolve();
        const drain = async () => {
            while (pendingSaves.size) await Promise.all([...pendingSaves]);
            if (saveError) throw saveError;
        };
        let resolveReady, rejectReady;
        const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
        // Startup may fail before the parent acquires this frame. Keep the
        // rejection available to it without emitting an unhandled rejection.
        ready.catch(() => {});
        let initializing = false;
        initializeEditor = () => {
            if (initializing) return;
            initializing = true;
            (async () => {
                await globalThis.require("anki/ui").loaded;
                let richText;
                try { richText = globalThis.require("anki/RichTextInput"); } catch { /* Older bundles lack the lifecycle API. */ }
                // Register before loadNote creates the initial fields. The same
                // hook covers new fields after a notetype reset in every mode.
                richText?.lifecycle?.onMount?.(async (input) => {
                    const element = await input.element;
                    if (typeof element.getRootNode().getSelection === "function") return;
                    if (!input.editable?.focusHandler?.flushCaret) return;
                    const flush = () => input.editable.focusHandler.flushCaret();
                    element.addEventListener("focus", flush, true);
                    flush();
                    return () => element.removeEventListener("focus", flush, true);
                });
                if (mode === "add") { await globalThis.loadNote(initialNote); hasNote = true; }
                resolveReady();
            })().catch(rejectReady);
        };
        globalThis.klausNoteEditor = {
            ready,
            async loadNote(target) {
                await ready;
                await globalThis.loadNote({ nid: target.noteId, notetypeId: target.notetypeId,
                    reviewerCardId: target.cardId ?? null, deckId: target.deckId ?? null,
                    originalNoteId: null, focusTo: mode === "browser" && !target.cardId ? null : 0, initial: true });
                hasNote = true;
                generation++;
            },
            async save() {
                await ready;
                if (!hasNote) return;
                // Anki's tag commit launches updateNotes without awaiting it.
                await globalThis.saveNow();
                await drain();
            },
            async insertText(text) {
                await ready;
                if (!hasNote) throw new Error("The card editor is still loading.");
                let richText;
                try { richText = globalThis.require("anki/RichTextInput"); } catch { /* Older bundles use focusField. */ }
                const target = document.querySelectorAll(".rich-text-editable")[focusedField]?.shadowRoot?.querySelector("anki-editable");
                const candidates = await Promise.all((richText?.instances ?? []).map(async input => ({ input, element: await input.element })));
                const input = candidates.find(candidate => candidate.element === target)?.input;
                if (input) {
                    if (typeof (await input.element).getRootNode().getSelection !== "function") input.editable?.focusHandler?.flushCaret();
                    await input.focus();
                } else globalThis.focusField(focusedField);
                await new Promise(requestAnimationFrame);
                const node = document.createElement("div");
                node.textContent = text;
                globalThis.pasteHTML(node.innerHTML.replace(/\n/g, "<br>"), false, false);
            },
            async canLeave() {
                await ready;
                if (mode !== "add") { await this.save(); return true; }
                if (closeCheck) return closeCheck;
                closeCheck = (async () => {
                    await drain();
                    checkingClose = true;
                    closeAllowed = false;
                    try {
                        await globalThis.closeAddCards();
                        await drain();
                        return closeAllowed;
                    } finally { checkingClose = false; }
                })();
                try { return await closeCheck; } finally { closeCheck = undefined; }
            },
        };
        globalThis.fetch = (input, init) => {
            const url = typeof input === "string" ? input : input.url ?? String(input);
            if (mode === "add" && url.endsWith("/_anki/closeAddCards")) {
                return (async () => {
                    // Direct iframe Close obeys the same pending-write and
                    // failure guard as navigation from the outer workspace.
                    await drain();
                    const body = init?.body ?? await input.clone().arrayBuffer();
                    const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
                    // This endpoint takes generic.Bool: absent/default false or tag 1 true.
                    if (bytes.length && (bytes.length !== 2 || bytes[0] !== 8)) {
                        throw new Error("Could not check unfinished card input.");
                    }
                    const hasInput = bytes.length === 2 && bytes[1] !== 0;
                    closeAllowed = !hasInput || parent.confirm("Discard current input?");
                    if (closeAllowed && !checkingClose) parent.location.href = "/";
                    return new Response(new Uint8Array(), { status: 200 });
                })();
            }
            const update = mode !== "add" && url.endsWith("/_anki/updateNotes");
            const add = mode === "add" && url.endsWith("/_anki/addNote");
            if (!update && !add) return fetch(input, init);
            const noteGeneration = generation;
            const request = writeTail.then(() => fetch(input, init)).then((response) => {
                if (response.ok) {
                    if (noteGeneration === generation) saveError = undefined;
                    if (update) parent.postMessage({ klausEditor: "noteUpdated" }, location.origin);
                } else if (noteGeneration === generation) {
                    saveError = new Error(`The editor could not save (HTTP ${response.status}). Your edits are still open.`);
                }
                return response;
            }, (error) => {
                if (noteGeneration === generation) saveError = error;
                throw error;
            });
            // Track completion separately so Anki may catch its own request error
            // while the next host operation still receives that failure.
            const settled = request.then(() => {}, () => {});
            writeTail = settled;
            pendingSaves.add(settled);
            settled.then(() => pendingSaves.delete(settled));
            return request;
        };
    }
    globalThis.bridgeCommand = globalThis.pycmd = (cmd, callback) => {
        const focus = /^focus:(\d+)$/.exec(cmd);
        if (focus) focusedField = Number(focus[1]);
        if (embedded) parent.postMessage({ klausEditor: cmd }, location.origin);
        handlers[cmd]?.();
        callback?.(null);
        return false;
    };

    if (location.hash === "#night") {
        document.documentElement.classList.add("night-mode");
    }

    // Anki pages are closed with their Qt window; Klaus has none, so offer a way
    // back (e.g. from the import log, which has no Close of its own). Esc does the
    // same, as it closes Anki's dialogs. The editor has its own Close.
    if (page === "editor") return;
    // Deck options asks before discarding unsaved changes, as Anki does when its
    // window is closed; the page then calls deckOptionsRequireClose.
    const leave = (e) => {
        const pending = globalThis.anki?.deckOptionsPendingChanges;
        if (page !== "deck-options" || !pending) return void (location.href = "/");
        e?.preventDefault();
        pending();
    };
    addEventListener("keydown", (e) => e.key === "Escape" && leave(e));
    const link = document.createElement("a");
    link.addEventListener("click", leave);
    link.href = "/";
    link.className = "klaus-back";
    link.textContent = "← Decks";
    // SvelteKit replaces <body>'s children when the page mounts; put it back.
    addEventListener("DOMContentLoaded", () => {
        const ensure = () => link.isConnected || document.body.append(link);
        ensure();
        new MutationObserver(ensure).observe(document.body, { childList: true });
    });
})();
