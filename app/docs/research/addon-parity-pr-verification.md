# KlausNote app parity PR verification

Date: 2026-10-07. Scope: completed Home, Study, Browser, settings, transfers/backups, Local models, Library, shared Note editing, and startup error handling.

The PR is based on remote `main` at `ca653b5545d255821466d96357a91cee8882e8ce`, which includes the full-upload sync settlement fix. Only app changes are selected. Add-on edits stay in the shared checkout. The lecture proposal documents remain available, while experimental lecture routes, bridge storage, recording hooks, and PDF export code are excluded from this PR.

## Verification of this branch

Verification runs from an isolated Git worktree with disposable collections. It does not use the user's real collection or add-on files. Native windows remain unverified because visible testing requires confirmed Desktop 4 placement.

| Check | Command | Result |
| --- | --- | --- |
| Anki engine and bridge | `cargo test -p klaus-bridge` | 47 passed: retention 1, bridge 26, Library 7, models 4, reviewer 2, transfers 7 |
| JavaScript regressions | `node --experimental-strip-types --test src/lib/browse/*.test.mjs tests/review/audio.test.mjs tests/note-editor.test.mjs tests/editor-host.test.cjs tests/library-host.test.cjs tests/highlight-lifecycle.test.mjs` | 53 passed |

Browser-backed JavaScript tests need Playwright. Set `KLAUS_PLAYWRIGHT` to an installed Playwright package path when it is not a local dependency. These regressions cover editor save ordering, retained write failures, trusted frame messages, disposal, Add draft handling, field insertion, highlight observer cleanup and audio queues. [Tests](../../tests/), [Browse tests](../../src/lib/browse/).

- `npm run check`: zero errors and warnings. `npm run build` and `cargo build -p klaus` passed.
- Actual bridge, Chromium and WebKit: 21 Library/Browser/Study checks passed per engine, including persisted fields/tags, failed-save draft recovery and unchanged Study scheduling. [Chromium](../../.impeccable/review/library/result-chromium.json), [WebKit](../../.impeccable/review/library/result-webkit.json).
- `python3 tests/test_startup_lock.py` passed: two locked starts exited cleanly, and repeat-launch IPC ran before collection opening. No window was created.
- `tests/anki-foundation-workflows.test.mjs`: four checks passed in Chromium and WebKit for opaque-frame preview, committed grading followed by successor failure, selective unbury and retention retry behavior. The grading check verifies Retry never submits a second answer; unbury preserves suspended Cards.

## Regression resolved while preparing the PR

The retention test initially failed: stationary failed rows were requested again. Retention requests are now deferred until column configuration finishes, failures remain suppressed until rows leave and return, and ordinary Note updates preserve retention state. The same strict regression passed afterward in Chromium and WebKit. [Browser](../../src/routes/browse/+page.svelte), [regression](../../tests/anki-foundation-workflows.test.mjs).

The published branch includes the correction in the Browser source. Its narrow column-save and Note-update changes were also applied to the shared source without replacing peers' edits.

## Acceptance limits

Actual sound output, local TTS voices, codecs, native file pickers, auxiliary Settings windows and ordinary native launch/focus remain pending. Startup regression checks deliberately exit before opening a window. Speech transcription, managed Ollama lifecycle, OCR execution, indexing, MCP and full add-on parity are incomplete. The pinned Anki restore may update media before final database replacement, so a late media failure does not guarantee media rollback. The restore confirmation states the safety backup excludes media.

Partial issue work remains open under [#116](https://github.com/pyamzi/klausnote/issues/116), including [#13](https://github.com/pyamzi/klausnote/issues/13), [#17](https://github.com/pyamzi/klausnote/issues/17), [#117](https://github.com/pyamzi/klausnote/issues/117), [#120](https://github.com/pyamzi/klausnote/issues/120), and [#127](https://github.com/pyamzi/klausnote/issues/127). Lecture expansion remains gated by #128.
