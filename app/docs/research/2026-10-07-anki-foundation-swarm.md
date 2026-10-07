# Anki foundation swarm audit

Date: 2026-10-07. Status: scoped local fixes; final integration verification pending. This report does not establish full Anki or add-on parity, native acceptance, installation, or the cause of the reported 140 GB memory incident.

## Reference order and scope

The swarm followed the [app's reference order](../../AGENTS.md#reference-and-delivery-order): inspect pinned upstream Anki first, preserve its Collection and scheduling contracts through the bridge, then assess Klaus-specific extensions. [ADR-0001](../adr/0001-build-on-anki-rslib.md) chooses Anki's engine; [ADR-0006](../adr/0006-ui-talks-only-to-the-bridge.md) defines the HTTP bridge boundary. The inspected `vendor/anki` HEAD was `29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba`.

This was a finite sweep of Browser preview/editor lifecycle, Study grading and recovery, deck unbury, settings persistence, bridge transfers/backups/preferences/sync, and visible native editor hooks. It was not a complete feature inventory or a sustained memory benchmark. The separate [add-on parity checklist](addon-app-parity.md) remains the broader migration inventory.

Workers assessed distinct areas in the shared checkout. Implementation leases limited edits to confirmed defects, regressions and this report. Behavioral checks used disposable Collections; the scratch [workflow harness](../../tests/anki-foundation-workflows.test.mjs) runs headless browsers against the real bridge and keeps authentication credentials out of output. Visible native testing remains subject to the Desktop 4 placement requirement in [AGENTS.md](../../AGENTS.md).

## Reproduced defects and scoped changes

| Area | Trigger and defect | Resulting behavior and evidence |
| --- | --- | --- |
| Browser preview messages | The sandboxed Card frame sends messages with opaque origin `null`; the previous same-origin gate rejected its flip commands. | [Browser](../../src/routes/browse/+page.svelte) accepts the actual preview frame's opaque-origin messages while checking its source and command envelope. It retains `sandbox="allow-scripts"`. The [preview regression](../../tests/anki-foundation-workflows.test.mjs) exercises real frame flipping and rejects an unrelated frame. Upstream reference: [Anki previewer](../../vendor/anki/qt/aqt/browser/previewer.py). Final engine runs pending. |
| Committed Study answer, failed successor load | A grade can be successfully committed before loading the next Card fails. Retaining the previously answered Card as actionable permits a second grading attempt against stale state. | [Study](../../src/routes/review/+page.svelte) clears actionable Card state before successor loading and displays Retry on failure. Retry loads the queue without submitting another answer. The [grading regression](../../tests/anki-foundation-workflows.test.mjs) injects successor failure after a successful grade, checks persisted review history, and asserts one `answerCard` request and no extra review-log entry after Retry. Upstream reference: [reviewer answer flow](../../vendor/anki/qt/aqt/reviewer.py). Final engine runs pending. |
| Unbury from deck overview | Deck overview offered no Unbury action, and the bridge denied Anki's existing deck operation. | [Home](../../src/routes/+page.svelte) uses Anki's burial flags and choices; the [bridge allowlist](../../crates/bridge/src/lib.rs) exposes `unburyDeck` without replacing scheduler logic. The [bridge regression](../../crates/bridge/tests/bridge.rs) checks scheduler-only, user-only and all burial modes, preserving suspended Cards and their scheduling fields. The [overview regression](../../tests/anki-foundation-workflows.test.mjs) checks the visible choices against persisted queues. Upstream: [protocol](../../vendor/anki/proto/anki/scheduler.proto), [bury/unbury implementation](../../vendor/anki/rslib/src/scheduler/bury_and_suspend.rs). Backend verified; frontend integration pending. |
| Profile settings failed save | A failed settings write returned an error after already changing the active in-memory profile. Scratch reproduction: `autoSync` was true on disk, false in memory after HTTP 500, and true again after restart. Direct overwrite also exposed the old destination to truncation before the new document was complete. | [Settings persistence](../../crates/bridge/src/lib.rs) now stages a cloned document in a unique sibling, flushes it, atomically replaces the destination, then commits the cache. Failure leaves the prior cache and existing destination content intact and cleans its temporary file. The [settings regression](../../crates/bridge/tests/bridge.rs) first failed against the original behavior, then passed; it also checks successful recovery and restart persistence. |
| Search-highlight detached roots | Replacing editor field shadow roots left retired roots in the highlighter's observation/style bookkeeping. | The [highlighter](../../src/lib/browse/highlight.ts) disconnects before each paint, removes detached roots, then observes only live roots. The [DOM lifecycle regression](../../tests/highlight-lifecycle.test.mjs) instruments observed targets through repeated replacement, checks unchanged field content/caret, and verifies disposal. This addresses that retained-root defect; it does not establish the cause or scale of the reported Anki memory incident. Final lifecycle verification pending. |

## Retention recovery still pending

The [Browser retention effect](../../src/routes/browse/+page.svelte) adds visible IDs to its in-flight set; a failed request needs to release that state so revisiting the rows can retry. Recovery must also avoid an immediate loop while the same rows remain visible. The added [retention regression](../../tests/anki-foundation-workflows.test.mjs) forces a failure, checks a stationary row gets one attempt, then revisits it after recovery and requires a successful second attempt. Implementation and execution remain pending until the coordinator records their result here. This is a Klaus extension above the Anki foundation, not scheduler functionality.

## Verification ledger

| Check | Evidence and current status |
| --- | --- |
| Settings and unbury RED checks | Both new [bridge regressions](../../crates/bridge/tests/bridge.rs) failed before production fixes: cached value changed after persistence failure; `unburyDeck` returned `NotAllowed`. |
| Bridge tests after fixes | `cargo test -p klaus-bridge --test bridge`: 27 passed. This includes the new regressions and existing Collection, deck, Note/media, preference, undo and fake-server sync coverage. [Test source](../../crates/bridge/tests/bridge.rs). |
| Transfer/backups tests | `cargo test -p klaus-bridge --test transfers`: seven passed. Coverage includes scheduling/history/media roundtrips, failed restore retaining the original Collection, invalid export preserving its destination, periodic backup behavior, and staging an old selected backup before safety-backup pruning. [Test source](../../crates/bridge/tests/transfers.rs). |
| Owned backend whitespace check | `git diff --check -- crates/bridge/src/lib.rs crates/bridge/tests/bridge.rs` passed after the backend edits. |
| Headless frontend regressions | [Foundation workflows](../../tests/anki-foundation-workflows.test.mjs): final Chromium and WebKit integration runs pending. [Highlight lifecycle](../../tests/highlight-lifecycle.test.mjs): final execution pending. |
| Frontend check/build and final combined backend run | Pending coordinator verification against the final shared source. Earlier results are not substituted for final integration. |
| Native delivery and long-idle memory behavior | No acceptance or memory-root-cause conclusion in this report. Headless correctness checks do not replace native or sustained idle-memory verification. |

The coordinator must update pending rows with actual outcomes before declaring the final build verified. Tests using a fake account/sync server establish that tested contract, not compatibility with the current hosted account service.

## Remaining foundation gaps

### Native editor hooks

The [bridge hook list](../../crates/bridge/src/lib.rs) permits calls that the [shell fallback](../../src-tauri/src/main.rs) still answers with no result. The HTTP bridge translates an empty hook reply into HTTP 204. The corresponding upstream controls therefore remain missing behavior, even when a hosted page renders:

- Fields and Cards dialogs: the visible [notetype toolbar](../../vendor/anki/ts/routes/editor/editor-toolbar/NotetypeButtons.svelte) calls `openFieldsDialog` and `openCardsDialog` after saving.
- Recording and attachment playback: [TemplateButtons](../../vendor/anki/ts/routes/editor/editor-toolbar/TemplateButtons.svelte) calls `recordAudio` and `playFile`.
- Clipboard image read/write: [data-transfer](../../vendor/anki/ts/routes/editor/rich-text-input/data-transfer.ts) calls `readClipboard` and `writeClipboard`.
- Open image and reveal its folder: the [image context menu](../../vendor/anki/ts/routes/editor/context-menu.svelte.ts) calls `openMedia` and `showInMediaFolder`.

Upstream [mediasrv host handlers](../../vendor/anki/qt/aqt/mediasrv.py) define these contracts. This sweep did not implement their native replacements. Each needs a working host action and a feature-level regression; HTTP 204 alone is not acceptance evidence. This gap concerns editor attachment playback, separate from Study's [browser audio controller](../../src/lib/review/audio.ts).

### Account migration

The [account implementation](../../crates/bridge/src/account.rs) still defaults to `klaus.ink`, hardcodes `/oauth/authorize` and `/oauth/token`, and expects email and a sync URL from the token response. The [sync implementation](../../crates/bridge/src/sync.rs) retains the old default sync host. [ADR-0008](../adr/0008-klaus-so-domains-and-shared-oidc-auth.md) requires the shared provider at `app.klaus.so`, discovery, and a separate KlausNote sync-key exchange. That migration remains pending. No live hosted sign-in attempt was used to assess it, and changing URLs alone would not satisfy the documented contract.

## Klaus extensions still pending

The [migration checklist](addon-app-parity.md) distinguishes the current Library subset from full add-on behavior. Current [Library](../../src/routes/library/+page.svelte), [storage](../../crates/bridge/src/library.rs), and [storage regressions](../../crates/bridge/tests/library.rs) provide a foundation, not completion of all extensions:

- Library drop import, rename/move/delete, automatic external-change reconciliation, virtual folders and tag semantics remain to migrate.
- Durable PDF annotation tools/saves, richer selection/search, shared reader hosts and context persistence remain feature-level work.
- Extraction/OCR, Card/PDF indexing, semantic matching and background queues remain pending. The [local-model bridge](../../crates/bridge/src/models.rs) and [model settings](../../src/routes/settings/models/+page.svelte) do not establish these workflows.
- Library tag synchronization, curated decks, per-document retention/history/charts, and extended crop/occlusion integration remain in the checklist.

The foundation-first order continues: complete and verify the relevant Anki workflow, then layer each extension on it with its own acceptance evidence.
