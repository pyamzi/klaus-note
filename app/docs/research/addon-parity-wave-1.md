# Add-on parity: first implementation wave

Date: 2026-10-06. Status: local changes, not committed, released, or full parity acceptance.

## Tracker alignment

The [parity umbrella #116](https://github.com/pyamzi/klausnote/issues/116) is linked from the [existing design map #37](https://github.com/pyamzi/klausnote/issues/37). Eleven capability tickets, #117 through #127, are registered as sub-issues with native dependency edges. The approved lecture follow-up is [#128](https://github.com/pyamzi/klausnote/issues/128), blocked by full parity acceptance #127.

The full mapping and source inventory are in [the GitHub map](addon-parity-github-map.md) and [feature inventory](addon-app-parity.md). Existing issue scopes and blockers remain intact. No implementation issue was closed.

## Local implementation

| Area | Changes | Existing issues |
| --- | --- | --- |
| Home | Dashboard, deck overview, review heatmap, widget order/size/visibility persistence and drag editing, navigation | #60 |
| Study | Review chrome, counts/intervals, Edit, More actions, Card Info, undo, bar preferences and modal grading guards | #13, #61 |
| Browse | Persistent panes, search highlighting, visible-row retention estimates, multi-selection, bulk actions, duplicate search and undo | #12, #62, #63 |
| Settings and shell | Persisted rollover/sync/bar visibility/backup retention, native menus, separate Settings window, fullscreen notifications | #19, #64 |
| Bridge | Explicit allowlist additions, engine-backed duplicate matching, add-on retention semantics | #12, #13, #63 |
| Save ordering | Drain pending editor field/tag writes; prevent input during bulk changes; await reload before permitting edits | #12; guards against the focus/data risks described by #115 |

Primary source: [Home](../../src/routes/+page.svelte), [Study](../../src/routes/review/+page.svelte), [Browse](../../src/routes/browse/+page.svelte), [Settings](../../src/routes/settings/+page.svelte), [menus](../../src-tauri/src/menus.rs), [retention](../../crates/bridge/src/retention.rs), [duplicates](../../crates/bridge/src/browser.rs), [editor host](../../static/anki-host.js).

## Verification completed

- `cargo test -p klaus-bridge`: 25 integration tests and one retention unit test passed. Includes real temporary collections, undo/redo, duplicate groups, retention and preference persistence after reopen. [Bridge tests](../../crates/bridge/tests/bridge.rs).
- Browse unit checks: 13 passed, covering selection, search tokens and asynchronous save success/failure drainage. [Tests](../../src/lib/browse/save-barrier.test.mjs).
- Svelte check with the app config: zero errors and warnings. Frontend production build and native debug build passed.
- Headless browser against the actual Rust bridge and a scratch collection: Home/overview/heatmap, review render/reveal/grade/undo, mark/suspend persistence, Card Info, delete cancellation and Escape navigation passed.
- Same real bridge: Browse tags, suspend/unsuspend, deck changes, find/replace, duplicate groups, due date, reset, delete and applicable undo passed. Typing immediately before bulk tags and undo preserved the field after the autosave delay. Pane width/persistence and new-card retention display passed.
- Settings changed rollover, auto-sync and backup interval against the real bridge, survived page reload, and were restored to original test values.
- Thirteen separate fixture-backed Home/Study UI checks passed. These are not native acceptance evidence.
- Desktop/mobile browser screenshots inspected. Real native KlausNote Home and existing Anki PDF view were opened and visually inspected before the user requested Desktop 4 isolation.

Logs and screenshots are local temporary evidence under `/tmp/klaus-parity-*`, `/tmp/klaus-browse-*`, `/tmp/klaus-real-*`, and `/tmp/klaus-settings-*`. They are not published artifacts.

## Native verification limitation

The first native Settings window opened blank. The shell was changed to give the auxiliary window its own authenticated launch URL, and the native build passed. The fix has not been accepted by a subsequent successful native visual check.

The user requested all visible testing occur on Desktop 4 without disturbing Desktop 1. Foreground automation was stopped. A background/hidden launch attempt did not honor hidden state, and the attempted programmatic Space move was not confirmed. The isolated native test app was then hidden and terminated. No Desktop 4 isolation claim is made. Remaining behavioral tests used a headless bridge and browser; further visible testing is paused until placement can be verified without disturbing the active desktop.

## Remaining delivery work

This is the first implementation wave. The full add-on migration is not complete.

- #12: native acceptance and large-collection performance remain; the implemented bulk workflows passed real-engine headless checks.
- #13/#61: reviewer audio, full in-place editor workflow, background behavior, fuller Custom Study and congratulations behavior remain.
- #17: remaining import/export formats, periodic backups and round-trip acceptance remain.
- #19/#64: native auxiliary-window retest, custom server configuration, context-sensitive collection Cmd+Z and dynamic Undo wording remain.
- #60: global task readout, per-deck export, full heatmap settings/forecast/streak parity remain.
- #62: Library/reader integration and global tasks remain. The hosted Anki editor remains interim under #57.
- #117–#126: Library migration, durable PDF annotations, shared reader hosts, model operations, OCR, index jobs, curation, document retention, external tools/MCP and extended drawing/occlusion need their implementation waves.
- #127 remains the complete acceptance gate. #128 lecture expansion remains parked.

No real user collection was used for mutation tests. Existing shared add-on changes were preserved. No commits, pushes or releases were made.
