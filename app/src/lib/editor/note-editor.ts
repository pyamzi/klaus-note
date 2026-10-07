import { getNote } from "@generated/backend";

type NoteTarget = { noteId: bigint; notetypeId: bigint; cardId?: bigint; deckId?: bigint };
type Host = {
  ready: Promise<void>;
  loadNote: (target: NoteTarget) => Promise<void>;
  save: () => Promise<void>;
  insertText: (text: string) => Promise<void>;
  canLeave: () => Promise<boolean>;
};
type EditorWindow = Window & { klausNoteEditor?: Host };
export type NoteEditor = {
  show: (noteId: bigint | Promise<bigint>, context?: { cardId: bigint; deckId: bigint }) => Promise<boolean>;
  settle: () => Promise<boolean>;
  insert: (text: string) => Promise<void>;
};
type Options = {
  mode: "existing" | "add";
  attach: (editor: NoteEditor | undefined) => void;
  onready?: () => void;
  onupdated?: () => void;
  onpreview?: () => void;
  onshown?: (noteId: bigint) => void;
  onbusy?: (busy: boolean) => void;
};

/** Attach to the existing iframe. Anki's editor internals stay behind this seam. */
export function noteEditor(frame: HTMLIFrameElement, options: Options) {
  let disposed = false, generation = 0, busy = 0;
  let host: Host | undefined, connecting: Host | undefined;
  let resolveReady: (host: Host) => void, rejectReady: (error: unknown) => void;
  const ready = new Promise<Host>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Readiness may fail before a screen requests its first operation.
  void ready.catch(() => {});
  const waiting = new Set<(error: Error) => void>();
  const closed = () => new DOMException("Note editor was closed", "AbortError");
  function alive<T>(promise: Promise<T>): Promise<T> {
    if (disposed) { void promise.catch(() => {}); return Promise.reject(closed()); }
    return new Promise((resolve, reject) => {
      waiting.add(reject);
      promise.then(value => { waiting.delete(reject); resolve(value); },
        error => { waiting.delete(reject); reject(error); });
    });
  }
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>, lock = true): Promise<T> {
    if (lock && !disposed) { busy++; options.onbusy?.(true); }
    const result = alive(queue.then(async () => {
      if (disposed) throw closed();
      return operation();
    }));
    queue = result.catch(() => {});
    return result.finally(() => {
      if (lock && !disposed && --busy === 0) options.onbusy?.(false);
    });
  }
  function connect(required = false) {
    if (disposed) return;
    try {
      const candidate = (frame.contentWindow as EditorWindow | null)?.klausNoteEditor;
      if (!candidate) {
        if (required) rejectReady(new Error("Note editor host is unavailable"));
        return;
      }
      if (candidate === connecting) return;
      connecting = candidate;
      void alive(candidate.ready).then(() => {
        if (disposed || connecting !== candidate) return;
        host = candidate; resolveReady(candidate); options.onready?.();
      }).catch(error => { if (!disposed) rejectReady(error); });
    } catch (error) { rejectReady(error); }
  }
  function receive(event: MessageEvent) {
    if (disposed || event.origin !== location.origin || event.source !== frame.contentWindow) return;
    switch (event.data?.klausEditor) {
      case "editorReady": connect(true); break;
      case "noteUpdated": options.onupdated?.(); break;
      case "preview": options.onpreview?.(); break;
    }
  }
  const loaded = () => connect(true);
  addEventListener("message", receive);
  frame.addEventListener("load", loaded);
  connect();
  async function currentHost() {
    const current = await alive(ready);
    if ((frame.contentWindow as EditorWindow | null)?.klausNoteEditor !== current || host !== current) {
      throw new Error("Note editor frame changed");
    }
    return current;
  }
  const editor: NoteEditor = {
    show(noteId, context) {
      if (options.mode !== "existing") return Promise.reject(new Error("Cannot load an existing Note in the Add editor"));
      const request = ++generation;
      // Observe lookups immediately, including requests superseded while queued.
      const target = Promise.resolve(noteId).then(id => ({ id }), error => ({ error }));
      return enqueue(async () => {
        try {
          if (request !== generation) return false;
          const current = await currentHost();
          if (request !== generation) return false;
          await alive(current.save());
          if (request !== generation) return false;
          const result = await alive(target);
          if (request !== generation) return false;
          if ("error" in result) throw result.error;
          const note = await alive(getNote({ nid: result.id }, { alertOnError: false }));
          if (request !== generation) return false;
          await alive(current.loadNote({ noteId: result.id, notetypeId: note.notetypeId, ...context }));
          if (!disposed) options.onshown?.(result.id);
          return request === generation;
        } catch (error) {
          if (!disposed && request !== generation) return false;
          throw error;
        }
      });
    },
    settle() {
      return enqueue(async () => {
        const current = await currentHost();
        if (options.mode === "add") return alive(current.canLeave());
        await alive(current.save());
        return true;
      });
    },
    insert(text) {
      return enqueue(async () => {
        const current = await currentHost();
        frame.focus();
        await alive(current.insertText(text));
      }, false);
    },
  };
  options.attach(editor);
  return { destroy() {
    disposed = true; generation++;
    removeEventListener("message", receive);
    frame.removeEventListener("load", loaded);
    rejectReady(closed());
    for (const reject of waiting) reject(closed());
    waiting.clear();
    options.attach(undefined);
  } };
}
