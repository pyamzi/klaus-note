# Hosted Note editing

## Decision

Use one frame-scoped Note editing module for Browser, Study, and Library. Keep the existing iframe markup and visible controls. A module that owns the iframe would also own unrelated layout decisions; separate mode-specific handles would duplicate readiness and lifetime management.

The screen-facing interface is `show`, `settle`, and `insert`, with attachment and notification callbacks. `show` loads an existing Note, saving the current Note first. The newest requested selection wins, and loads run in order. `settle` waits behind pending selections: it saves an existing Note or checks whether an Add draft can be discarded. `insert` sends plain text to the last focused field. [Module](../../src/lib/editor/note-editor.ts), [host adapter](../../static/anki-host.js).

## Ownership

- [The module](../../src/lib/editor/note-editor.ts) owns iframe readiness, trusted notifications, serialized transitions, and disposal. Operations reject when their frame closes or its host is unavailable.
- [The host adapter](../../static/anki-host.js) owns Anki initialization, Note loading arguments, RichTextInput and caret handling, text escaping, write completion, and the Add close check. Embedded Browser and Add editors share this adapter. Standalone Anki pages retain their existing handlers.
- [Browser](../../src/routes/browse/+page.svelte) owns row selection, Card-to-Note lookup, search highlighting, and preview. Its rollback snapshots identify the Note actually displayed, including after Cards/Notes mode changes.
- [Study](../../src/routes/review/+page.svelte) owns its current Card, answer side, and scheduling. Saving an edit rerenders the same Card.
- [Library](../../src/routes/library/+page.svelte) owns files, PDF reading, pane visibility, and layout. Showing a pane does not remount its draft.

## Failure behavior

Anki may catch an unsuccessful Note write internally. The host therefore records write failures and reports them to the next save or close operation. A clean drain cannot clear a failure; an acknowledged later write for the same displayed Note can. Whole-Note writes run in request order, including tags. Failed saves keep the draft available and block switching or closing. [Upstream editor](../../vendor/anki/ts/routes/editor/NoteEditor.svelte), [host adapter](../../static/anki-host.js).

Pending Add tracking covers the HTTP write. Anki owns the subsequent sticky-field reset and draft close check. Disposal removes listeners and rejects pending parent operations; it cannot cancel a backend write already dispatched. [Upstream editor](../../vendor/anki/ts/routes/editor/NoteEditor.svelte), [host adapter](../../static/anki-host.js), [module](../../src/lib/editor/note-editor.ts).

## Verification

[Controller tests](../../tests/note-editor.test.mjs) cover late readiness, duplicate notifications, selection ordering, save failure and recovery, bulk-action settling, trusted messages, unavailable hosts, and disposal. [Host tests](../../tests/editor-host.test.cjs) and [Add tests](../../tests/library-host.test.cjs) cover ordered writes, tags, retained failures, Add attempts and close decisions, text escaping and caret handling, and standalone behavior. The [scratch browser test](../../tests/library-workspace.test.mjs) exercises actual Anki editing in Library, Browser, and Study using temporary collection data.

Verified on 2026-10-06:

- 36 controller and host tests passed. [Log](/tmp/klaus-note-editor-all-unit.log).
- Svelte check returned zero errors and zero warnings. [Log](/tmp/klaus-note-editor-check.log).
- The frontend build passed. [Log](/tmp/klaus-note-editor-build.log).
- Chromium and WebKit each passed 21 workflow checks with zero page errors. This includes Browser fields and tags, failed selection/navigation/mode changes, empty-search draft retention, acknowledged recovery, and Study Card, answer side, queue, and scheduling preservation without answering. [Chromium results](/tmp/klaus-note-editing-verification/result-chromium.json), [WebKit results](/tmp/klaus-note-editing-verification/result-webkit.json).
- `npm run install:local` refreshed `/Applications/Klaus.app`. Its signature, complete release bundle, frontend files, and host source were checked. The previous bundle is preserved in `target/local-install-backups/previous.75d4wo/Klaus.app`. [Install log](/tmp/klaus-note-editor-install.log), [delivery evidence](/tmp/klaus-note-editing-verification/verification.json).

Native window appearance has not been verified during this refactor. Browser tests used scratch collections and headless engines; they did not open the user's installed app. [Harness](../../tests/library-workspace.test.mjs), [delivery evidence](/tmp/klaus-note-editing-verification/verification.json).
