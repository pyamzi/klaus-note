# Add-on parity: GitHub plan mapping

Checked 2026-10-06 against the live GitHub API, including all 86 issues, issue bodies, map sub-issues, and native dependency edges. This is a planning audit, not a claim that any feature is implemented or accepted. The source inventory is [addon-app-parity.md](addon-app-parity.md).

## Conclusion

The requested priority fits the existing **mirror the add-on first** decision in [#37](https://github.com/pyamzi/klausnote/issues/37). Its existing tickets cover the main screens and the Anki foundation. They do **not** cover the full current add-on feature set. Library, PDF authoring, OCR, model management, semantic indexes, curated decks, document retention, and external tools need explicit app migration tickets.

The canonical repository returned by GitHub is [pyamzi/klausnote](https://github.com/pyamzi/klausnote). The checked `pyamzi/klaus-note` API and CLI requests redirect successfully. Use the canonical name for new issue links. The old add-on repository and separate-repository language in #37/#54 have been superseded by the monorepo, as recorded in [shared context](../../../../shared-context/CONTEXT.md).

[#4](https://github.com/pyamzi/klausnote/issues/4) explicitly excludes Documents, OCR, embeddings and Recordings from Milestone 1. The user's new priority expands delivery after those Anki foundations: finish current add-on parity before extending the new lecture workflow. Preserve the Milestone 1 issue's scope; add a parity umbrella linked to #4 and #37 instead of treating every new feature as already covered by them.

## Existing tickets and their actual gates

Every issue below is open at this audit unless marked closed. Dependencies were read from GitHub's native `dependencies/blocked_by` API, not inferred solely from prose. A `ready-for-agent` label does not mean the ticket is unblocked.

| Existing issue | Scope to reuse | Open blockers | Consequence |
| --- | --- | --- | --- |
| [#12 Browser bulk actions](https://github.com/pyamzi/klausnote/issues/12) | Multi-selection deck/tag/suspend/reset/due/delete, replace, duplicates and undo | None; #11 closed | Start with behavior audit and finish missing actions. Unblocks #62 and #63. |
| [#13 Review actions](https://github.com/pyamzi/klausnote/issues/13) | Edit current, bury/suspend/flag/mark, info, audio, leeches | None; #7/#8 closed | Start with behavior audit. Unblocks part of Study parity. |
| [#16 Note types and image occlusion](https://github.com/pyamzi/klausnote/issues/16) | Native Anki note-type management and image-occlusion host | None; #8 closed | Does not cover the add-on's entire crop/Excalidraw/IOE workflow. |
| [#17 Import, export and backups](https://github.com/pyamzi/klausnote/issues/17) | `.colpkg`/CSV import, deck/collection export, periodic backups, preserved-history round trip | None; #6 closed | Required before Home parity acceptance. |
| [#18 Stats and maintenance](https://github.com/pyamzi/klausnote/issues/18) | Graphs, check database/media, collection undo/redo, too-new schema rejection | None; #5 closed | Required for corresponding actions; extra stats widgets still need specification. |
| [#19 macOS shell and preferences](https://github.com/pyamzi/klausnote/issues/19) | Menus, shortcuts, system appearance, rollover/sync/backups/appearance persistence | None; #14 closed | Unblocks Home and Study. Coordinate shell edits with #18/#64. |
| [#20 Smoke and performance](https://github.com/pyamzi/klausnote/issues/20) | Scratch collection smoke and 100k+ card responsiveness | None; #7/#11/#14 closed | Existing end-to-end gate; broaden acceptance via a new parity checklist. |
| [#60 Home](https://github.com/pyamzi/klausnote/issues/60) | Widget dashboard, Decks/Add/Browse/Sync chips, overview, heatmap, bottom row, widget persistence | #17, #19 | Do not declare complete until foundation gates close. |
| [#61 Study](https://github.com/pyamzi/klausnote/issues/61) | Add-on reviewer chrome, bar hiding, untouched cards, counts/intervals/Edit/More | #13, #19; #59 closed | Implement on verified review actions and shell preferences. |
| [#62 Browse](https://github.com/pyamzi/klausnote/issues/62) | Full sidebar/table/editor layout, pane toggles, stable widths, row tints, preview | #12; #59 closed | Keep hosted editor interim until #57 is ready. |
| [#63 Retention and search highlighting](https://github.com/pyamzi/klausnote/issues/63) | Add-on retention calculation and search tokenizer | #12 | App-specific migration already has a ticket. |
| [#64 Feedback](https://github.com/pyamzi/klausnote/issues/64) | Anki wording in toasts, failures in dialogs, Undo menu | None; #59 closed | Toast/dialog work can start. Body explicitly defers Edit menu to #19 despite no native edge for it. |
| [#53 Rebuilt page order](https://github.com/pyamzi/klausnote/issues/53) | Decide scope/order of import, options and editor rebuild | None; #52 closed | Planning decision remains open. |
| [#57 Shared Svelte pages](https://github.com/pyamzi/klausnote/issues/57) | Shared source for app and add-on, using Anki's engine | #53 | Split into implementation tickets once #53 settles. |
| [#54 Cross-surface parity mechanism](https://github.com/pyamzi/klausnote/issues/54) | Token location, drift checks and parity process | None | Adapt proposal to the current monorepo. |
| [#58 Generated theme](https://github.com/pyamzi/klausnote/issues/58) | Generate app/add-on tokens and detect drift | #54 | Reuse existing tokens until location/process is settled. |
| [#44 Palette scope](https://github.com/pyamzi/klausnote/issues/44) and [#56 implementation](https://github.com/pyamzi/klausnote/issues/56) | Command set and keyboard palette | #56 waits on #44; #59 closed | Secondary to existing workflow parity. |
| [#45 Phone previews](https://github.com/pyamzi/klausnote/issues/45) | Responsive design decisions | None; two native predecessors closed | Not a prerequisite for desktop parity. |
| [#48 Import appearance](https://github.com/pyamzi/klausnote/issues/48) | Hosted import dark-mode handling | None | Already assigned to pyamzi and Copilot; coordinate before taking over. |

The closed foundation issues [#5](https://github.com/pyamzi/klausnote/issues/5), [#6](https://github.com/pyamzi/klausnote/issues/6), [#7](https://github.com/pyamzi/klausnote/issues/7), [#8](https://github.com/pyamzi/klausnote/issues/8), [#9](https://github.com/pyamzi/klausnote/issues/9), [#10](https://github.com/pyamzi/klausnote/issues/10), [#11](https://github.com/pyamzi/klausnote/issues/11), [#14](https://github.com/pyamzi/klausnote/issues/14) and [#15](https://github.com/pyamzi/klausnote/issues/15) establish historical delivery, not fresh live acceptance for this migration. Reuse their implementations and verify the current app.

## Complete inventory mapping

The feature names and source-module references come from the checked [parity inventory](addon-app-parity.md). “New” below means no corresponding app migration issue was found among all issues returned by the live API, including closed issues.

| Inventory area | Existing coverage | Missing app scope |
| --- | --- | --- |
| Main window and hosted surfaces | #19, #60, #61, #62, #57 | New shared authoring/reader host ticket for Add/Browse/review context and persistence. |
| Home and overview | #60, with #18 for extra stats | None for specified Home parity; extra widgets remain a design decision in #37. |
| Study and review | #13, #61 | New reader host ticket for review-linked document panes. |
| Browse/editor panes | #12, #62, #57 | Library sidebar and document viewer data are new. |
| Retention column/highlighting | #63 | No duplicate ticket needed. |
| PDF-assisted Add | #8 closed, #57 pending | New authoring host and image/region transfer ticket. |
| Library/local files | No app migration issue | New Library store, file operations, external changes and migration ticket. |
| PDF reading/annotations | Add-on #102/#105/#107 are references only | New shared app PDF reader, durable marks, export/bake, and external reconciliation ticket. |
| Reader hosts/tabs/context | #62 only covers generic Browse panes | New shared host/tabs/context ticket. |
| Extraction/OCR | No app migration issue | New extraction/page records/OCR ticket. |
| Card/PDF indexes/matching | Add-on #108 is reference only | New embeddings, invalidation, queue, cancellation and sensitivity ticket. |
| Library tags/curation | Add-on #104 is reference only | New tag synchronization and curated-copy ticket. |
| Per-document retention/charts | #63 is a different browser-column feature | New document scores/history/charts/study-actions ticket. |
| Local models/setup | #19 covers general app preferences; add-on #111 is reference only | New runtime/model operations and student-facing settings ticket. |
| External tools/MCP | No app migration issue | New authenticated tools/current-view/approval boundary ticket. |
| Crop/occlusion/drawing | #16 covers Anki native IO, add-on #100 is reference only | New crop, reader IO, Excalidraw, existing-note/review preservation ticket. |
| Appearance/preferences/progress | #19, #54/#58, #64; #106 is add-on only | Background task readouts belong with new app job/index work and #60 bottom row. |
| Native Anki foundations | #12/#13/#16/#17/#18/#19/#20 | Current behavior and real-app acceptance remain required. |

## Proposed tickets to fill the gaps

These are ready to turn into explicit issue briefs after the umbrella exists. The identifiers P1 through P11 below are local planning labels, not GitHub numbers. Dependencies are proposed, not already registered on GitHub.

| Proposed ticket | Acceptance scope | Proposed dependencies |
| --- | --- | --- |
| P1: Library and safe local-file migration | Import/drop, folders, rename/move/delete, document identity, collision behavior, interrupted move recovery, external change detection; originals preserved in migration fixtures | Existing #19 preferences as needed; agree file-store seam with P2 before concurrent writes. |
| P2: Shared PDF reader and durable annotations | Scroll/zoom/find/selection, range loading, highlights/text/sticky notes, save to PDF, external edit reconciliation, Preview round trip and preserved page/zoom | P1 document identity; resolve app-specific marks schema from add-on behavior. |
| P3: Shared Add/Browse/review reader hosts | Library/reader/editor panes, tabs, context, persistent size/visibility/page/selection, region-to-editor media ownership | P1, P2; #62 for Browse integration; coordinate #57 editor host contract. |
| P4: Local models and student setup | Installed model capabilities, Ollama status, download/progress/cancel, basic and advanced settings, runtime lifecycle, selected embedding/OCR models and index controls | #19 settings; publish backend runtime contract before P5/P6 integration. |
| P5: Extraction and OCR | Text/page extraction, garbled-text detection/repair, source provenance, OCR readiness and truthful failures | P1, P4; P2 page references. |
| P6: Embeddings and index jobs | Card/PDF indexes, incremental invalidation, sensitivity, queue ownership, progress/cancel/resume and truthful task readouts | P1, P4, P5; coordinate #60 task display. |
| P7: Library tags and curated decks | Namespaced tag sync, collision/rename behavior, document matches, curated copies, original card preservation and undo | P1, P6, #12. |
| P8: Per-document retention and study | Calculations, snapshot history, charts, counts, matched/curated study actions | P6, P7; use #63's shared calculation only where semantics actually match. |
| P9: External tools and MCP | Explicit tool inventory, document/page/current-view context, discovery, authentication, preview/approval for collection writes, read/write rejection tests | Foundation operations, P1/P3, P6 for matching tools; keep internal bridge allowlist separate. |
| P10: Crop, reader occlusion and drawing | Image crop, full-page/region transfer, photo masks, Draw workflow, re-edit compatibility, collection media and review preservation | #16, P2, P3; use #100's checklist as reference evidence, not completion. |
| P11: Full parity acceptance | Every inventory row linked to implementation evidence; real Anki vs real KlausNote appearance and behavior; migration fixtures, external PDF round trip, restart persistence, task/error/cancel checks | All applicable existing and new parity tickets; #20 covers the native smoke/performance subset. |

Track the new lecture work as a separate follow-up blocked by P11. Keep its approved design and existing local implementation available; do not silently replace Library/PDF parity with the experimental lecture store. [Priority and parked-work record](addon-app-parity.md#parked-lecture-implementation).

## Add-on tickets to honor as source risks

These issues remain open and concern add-on code. They are not app migration tickets or blanket blockers requiring every Python refactor to finish first.

- [#107 Marks document](https://github.com/pyamzi/klausnote/issues/107): preserve reread-before-write, validation, tombstones, unreadable/save-failed state and failure handling in P2; the app implementation need not import Qt/Python.
- [#108 Index owner](https://github.com/pyamzi/klausnote/issues/108): P6 must not reproduce parallel indexing paths or conflicting busy ownership.
- [#109 Task readout](https://github.com/pyamzi/klausnote/issues/109): one derived task state feeds app status surfaces.
- [#110 Shared Library model](https://github.com/pyamzi/klausnote/issues/110): P1/P3 need one store backing both Library views.
- [#111 Model operations](https://github.com/pyamzi/klausnote/issues/111): P4 should separate runtime operations from dialog bindings.
- [#112 Interrupted Library move](https://github.com/pyamzi/klausnote/issues/112): P1 must protect partially moved files, unplugged roots, incomplete copies, later moves and deletion behavior.
- [#104 Sidebar name clashes](https://github.com/pyamzi/klausnote/issues/104): P7 must not silently split directories or drop colliding mappings.
- [#115 Reviewer/editor focus](https://github.com/pyamzi/klausnote/issues/115): acceptance must demonstrate that autosave cannot redirect typing or review shortcuts unexpectedly.
- [#102 Reader acceptance](https://github.com/pyamzi/klausnote/issues/102) and [#100 IO acceptance](https://github.com/pyamzi/klausnote/issues/100): use the detailed checklists, but do not claim sustained study use or another-device testing from a short automated run.
- [#105 pdf.js upgrade](https://github.com/pyamzi/klausnote/issues/105): select the app's dependency deliberately rather than blindly copying the add-on bundle.
- [#106 Default Zinc](https://github.com/pyamzi/klausnote/issues/106): add-on design convergence remains open; preserve explicit user-selected accents while using shared app tokens.

The architecture proposals [#66 dispatch](https://github.com/pyamzi/klausnote/issues/66) and [#67 typed client](https://github.com/pyamzi/klausnote/issues/67) are unblocked, but not native blockers for parity. Do not force broad refactors unless needed for a concrete feature seam. [#68 server bridge](https://github.com/pyamzi/klausnote/issues/68) explicitly says not to start until the web bridge begins.

## Concrete swarm order and ownership

### Wave 1: finish unblocked foundation behavior

1. **Browser worker, #12:** own `src/routes/browse/+page.svelte` and browser-specific new modules. Audit all bulk operations and implement missing behavior. Request bridge changes through a single bridge owner. Acceptance: multi-row operations plus undo against a scratch Collection, then live Browse.
2. **Study worker, #13:** own `src/routes/review/+page.svelte` and review-specific new modules. Finish in-place edit/More/info/audio behavior. Acceptance: actual card state changes, audio, editor focus and return to review, with native observation.
3. **Foundation owner, #17/#19:** serialize changes to `crates/bridge/src/lib.rs`, `proto/klaus.proto`, `src-tauri/src/main.rs`, shared settings and bridge integration tests. Start with missing import/export/backup behavior and shell/preferences persistence. Accept data round trips before Home/Study redesign.
4. **Orchestrator:** own integration and GitHub evidence. Check #16/#18 for gaps, prepare #53/#54 decisions from existing sources, maintain the inventory, and run app/Anki comparison. Do not let multiple workers modify the bridge or shell concurrently.

With a four-agent concurrency cap, the orchestrator plus three workers is one wave. Rotate completed workers onto #16/#18/#64 and #20 rather than oversubscribing the same shared files. Each ticket needs its own before/after evidence, not just a combined type check.

### Wave 2: release the existing screen gates

After #12, #13, #17 and #19 meet acceptance, use #60, #61, #62 and #63 for the screen migration. Build viewable proposals using the current design system before major visual changes, following the user's standing request. Shared top-bar/status/feedback edits get one owner. Keep the Anki editor hosted until #53/#57 define the replacement.

### Wave 3: migrate the add-on capabilities

Run independent P1/P4 implementation work while P2/P3 contracts are fixed. Then P2/P3/P5, then P6, then P7/P8/P9/P10 according to actual dependencies. Reuse the currently implemented behavior where proven; do not infer native app parity from a Python source port or hosted-page presence.

### Acceptance and reporting

Use real app windows and Anki for feature comparisons after each relevant round. Report structural tests, browser checks, native checks and data round trips separately. P11 closes only with the full inventory accounted for. Resume the approved lecture feature after that gate.

## Suggested GitHub bookkeeping

1. Add a concise priority/scope update to #37 linking the parity umbrella and retaining its established screen decisions.
2. Create the umbrella with a task list of reused issue numbers and the missing migration tickets. Register sub-issues and native dependency edges following [issue-tracker.md](../agents/issue-tracker.md).
3. Cross-link #4 as the native Anki foundation without rewriting its historical out-of-scope section as if it had already covered Library or models.
4. Update #54 to the current monorepo topology when resolving its parity process.
5. Retain human/design gates where actual choices remain. Do not close tickets from route presence, a mocked UI, or a passing build alone.

The initial read-only audit was followed by the coordinating agent registering the tracker state below.

## Registered tracker state (2026-10-06)

Umbrella [#116](https://github.com/pyamzi/klausnote/issues/116) is open and linked from #37. Its eleven sub-issues and native dependency edges are registered. No implementation issue was closed.

| Planning label | GitHub issue |
| --- | --- |
| P1 | [#117](https://github.com/pyamzi/klausnote/issues/117) |
| P2 | [#118](https://github.com/pyamzi/klausnote/issues/118) |
| P3 | [#119](https://github.com/pyamzi/klausnote/issues/119) |
| P4 | [#120](https://github.com/pyamzi/klausnote/issues/120) |
| P5 | [#121](https://github.com/pyamzi/klausnote/issues/121) |
| P6 | [#122](https://github.com/pyamzi/klausnote/issues/122) |
| P7 | [#123](https://github.com/pyamzi/klausnote/issues/123) |
| P8 | [#124](https://github.com/pyamzi/klausnote/issues/124) |
| P9 | [#125](https://github.com/pyamzi/klausnote/issues/125) |
| P10 | [#126](https://github.com/pyamzi/klausnote/issues/126) |
| P11 | [#127](https://github.com/pyamzi/klausnote/issues/127) |

The approved lecture follow-up is [#128](https://github.com/pyamzi/klausnote/issues/128), natively blocked by #127. Current local results and acceptance limits are recorded in [wave 1](addon-parity-wave-1.md).
