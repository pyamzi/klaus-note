# Add-on parity: second implementation wave

Date: 2026-10-06. Status: local implementation, not committed or published. Full parity remains incomplete.

## Scope and ownership

Three workers owned reviewer completion, transfer/backups, and local models. The integration owner handled protocol generation, bridge collection-operation coordination, native shell hooks, navigation, verification, and local installation. Work follows [#13](https://github.com/pyamzi/klausnote/issues/13), [#17](https://github.com/pyamzi/klausnote/issues/17), and [#120](https://github.com/pyamzi/klausnote/issues/120), under [#116](https://github.com/pyamzi/klausnote/issues/116). These issue links were read using GitHub CLI during this wave.

## Implemented

| Area | Behavior | Source |
| --- | --- | --- |
| Reviewer | Edit the current note in place, drain pending saves, keep current card and answer side, block native undo while editing | [Editor](../../src/routes/review/ReviewEditor.svelte), [review route](../../src/routes/review/+page.svelte) |
| Reviewer audio | Engine-extracted audio tags, autoplay and replay preferences, R/F5 shortcuts, validated local filenames, local speech voices when available | [Audio](../../src/lib/review/audio.ts), [bridge](../../crates/bridge/src/review_media.rs), [protocol](../../crates/bridge/proto/klaus.proto) |
| Card Info and actions | Scheduling details, history, mark/flag/bury/suspend shortcuts; deck-option leech behavior checked against real engine | [Review route](../../src/routes/review/+page.svelte), [engine tests](../../crates/bridge/tests/review_actions.rs) |
| Transfers | CSV/TSV/text import through Anki's hosted importer, whole-collection restore with confirmation, deck/all-deck APKG and full COLPKG exports | [Native hooks](../../src-tauri/src/main.rs), [export page](../../src/routes/transfer/+page.svelte) |
| Backups | Periodic backups using Anki's interval and retention rules; forced safety backup before collection restore; collection reopened after package operations | [Transfers](../../crates/bridge/src/transfers.rs) |
| Models | Actual Ollama connection, installed models with runtime capability labels, streamed downloads, cancellation/retry, confirmed removal, persisted model choices and sensitivity, collapsed Advanced endpoint settings | [Models page](../../src/routes/settings/models/+page.svelte), [backend](../../crates/bridge/src/models.rs) |
| Integration | Collection lifecycle gate around calls, sync, package operations and backups, with abort/progress calls allowed through; export links on Home/deck menu and Models link in Settings | [Bridge](../../crates/bridge/src/lib.rs), [sync](../../crates/bridge/src/sync.rs), [deck menu](../../src/routes/DeckRows.svelte) |

The local-model screen distinguishes unavailable indexing, OCR, MCP and speech integration. Persisting a model choice does not execute those unfinished workflows. Runtime installation/start/stop remains external to KlausNote. [Source](../../src/routes/settings/models/+page.svelte).

## Defects caught during review

- Editing now prevents collection-history shortcuts from racing pending saves. The dialog provides recovery if its editor fails to load. [Reviewer](../../src/routes/review/+page.svelte).
- Restore first stages the selected package so retention cannot delete or overwrite the source while creating the safety backup. The regression test actually prunes the selected old backup and verifies restoration succeeds. Temporary staged files are removed on success and failure. [Transfer tests](../../crates/bridge/tests/transfers.rs).
- Model preference validation rereads current settings under the mutation lock, preventing concurrent downloads/settings from using stale preferences. [Models](../../crates/bridge/src/models.rs).
- Card Info desktop width and new-card ease display were corrected after screenshot inspection. [Reviewer](../../src/routes/review/+page.svelte).

## Verification

- `cargo test -p klaus-bridge`: **39 passed**, comprising retention 1, existing bridge integration 25, models 4, reviewer 2, transfers 7. [Log](/tmp/klaus-wave2-all-final.log).
- JavaScript unit tests: **16 passed**, comprising Browse 13 and audio 3. [Log](/tmp/klaus-wave2-js-tests.log).
- Explicit app-config Svelte check: **0 errors, 0 warnings**. Production frontend build and native shell `cargo check -p klaus` passed. [Svelte](/tmp/klaus-wave2-svelte-final.log), [frontend](/tmp/klaus-wave2-web-final.log), [native check](/tmp/klaus-wave2-shell-check.log).
- Actual Rust bridge with a disposable collection: note editor save/persistence on the answer side, undo guard, extracted audio dispatch/replay, and Card Info passed. The audio device was mocked. [Test log](/tmp/klaus-wave2-review-final.log), [editor screenshot](/tmp/klaus-review-wave2-editor.png), [Card Info](/tmp/klaus-review-wave2-info.png).
- Actual bridge deck list and deck-specific export selection passed. APKG/COLPKG payloads, UI state, and 390px overflow passed with the native picker response mocked. [Log](/tmp/klaus-wave2-transfer-ui.log), [screenshot](/tmp/klaus-transfer-wave2.png).
- Actual bridge and installed Ollama were checked read-only: connected, `glm-ocr:latest` and `nomic-embed-text:latest` displayed with capabilities and sizes. No actual model downloads/deletions/settings writes were performed. Desktop/mobile screenshots inspected and no JavaScript errors reported. [Desktop](/tmp/klaus-models-live-desktop.png), [mobile](/tmp/klaus-models-live-mobile.png).
- Model pull progress, cancellation, retry/error, preference persistence and offline behavior use a controlled local runtime fixture in Rust integration tests. [Tests](../../crates/bridge/tests/models.rs).
- Package roundtrips use real temporary collections and verify notes, cards, review history, and media. [Tests](../../crates/bridge/tests/transfers.rs).

Headless reproduction entrypoint: [bridge example](../../crates/bridge/examples/headless.rs). Build web assets into `target/debug/web` and use a disposable directory under the system temporary directory. Its startup URL contains a session credential; keep that log private.

## Limits and remaining acceptance

No native app was launched during this wave. Visible testing is restricted to Desktop 4, and reliable placement there remains unverified. Headless screenshots are not native Anki/KlausNote comparison evidence.

- #13: actual speakers, local TTS voices, supported codecs and native reviewer behavior remain to be tested.
- #17: native import/export pickers, native collection-restore confirmation and long-running/background interaction acceptance remain. The pinned Anki engine writes imported media before final database replacement, so a late media I/O failure can leave partial media changes. The safety backup excludes media; the confirmation states this. [Engine restore order](../../vendor/anki/rslib/src/import_export/package/colpkg/import.rs), [confirmation](../../src-tauri/src/main.rs).
- #120: managed runtime lifecycle, real speech runtime, OCR execution and card indexing remain incomplete. MCP is tracked separately in #125. Basic/advanced settings do not claim these capabilities are connected.
- Previous native Settings-window acceptance and broader add-on migration gates remain. [Wave 1](addon-parity-wave-1.md).
- #127 full parity acceptance remains open. #128 lecture expansion remains parked.

No real user collection was used for mutation tests. Shared add-on and parked lecture edits were preserved. No commits, pushes, issue closures or releases were made.

## Local delivery

Release build succeeded and `/Applications/Klaus.app` was refreshed. Its signature passed strict verification and its contents matched the built bundle exactly. The previous app is preserved at `target/local-install-backups/previous.UBoEfv/Klaus.app`. Build and installation verification are recorded in [the installation log](/tmp/klaus-wave2-install.log). The installer refreshes `/Applications/Klaus.app`, preserves the previous bundle, and registers it without launching a window. [Installer](../../scripts/install-local.sh).
