# KlausNote

<!-- impeccable:product-schema 1 -->

## Platform

web

The existing Svelte interface runs inside the Tauri desktop shell. This record describes that interface, not a new native design language.

## Product Purpose

KlausNote is the standalone study app defined in [CONTEXT.md](CONTEXT.md), using Anki's Collection and Card engine.

## Operating Context

The user confirmed that Library should mirror KlausNote for Anki's three-pane authoring workspace: folders and Documents on the left, a PDF reader in the middle, and Card creation on the right. Library replaces the top-level Add destination; the editor's action for submitting a Note remains Add.

## Capabilities and Constraints

- Build and verify the Anki foundation first, using [upstream Anki](https://github.com/ankitects/anki) and the pinned local source as the primary reference. Layer KlausNote for Anki features on top, following [the reference order](AGENTS.md#reference-and-delivery-order).
- Documents in this workspace are plain PDF files, separate from the experimental Lecture store.
- Reuse the hosted Anki Add editor and its existing Collection and media operations.
- Reach the backend only through the existing `/_anki` bridge, as required by [AGENTS.md](AGENTS.md).
- Preserve unfinished editor input while changing panes. Leaving the workspace requires Anki's existing discard confirmation when input remains.
- Use the existing app's components and semantic tokens. The task extends the incumbent interface.

## Brand Commitments

Keep the names KlausNote and KlausNote for Anki, as recorded in [CONTEXT.md](CONTEXT.md).

## Evidence on Hand

The workspace behavior is implemented in `../addon/klaus_note/single_window.py` and described in `../addon/docs/superpowers/specs/2026-10-01-add-tab-design.md`. Current app styling is implemented in `src/app.css` and the existing routes.

## Open Decisions

The current task confirms the PDF-assisted Card workflow. It does not define new audiences, marketing claims, or a visual rebrand.
