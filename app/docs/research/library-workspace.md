# Library workspace

## Confirmed request

Build the desktop Add panel and rename its navigation destination to Library. The user confirmed the add-on's three-pane workspace: folders and files, PDF reader, and Card creation.

## Direction contract

Mode: Operate. This is a precisely specified extension of the incumbent app, using its existing Svelte/shadcn components and semantic tokens. It is not a visual identity replacement and has no generated comp.

The first desktop viewport presents the main navigation and Files/Reader/Card controls together in the top bar above the workspace. Library files occupy the left pane, the selected PDF occupies the middle pane, and the real hosted Anki editor occupies the right pane. Initial proportions follow the add-on's 24/46/30 layout. Pane toggles and dividers adapt the workspace while preserving the editor instance. At narrow widths, Files, Reader, and Card switch between the same mounted panes, with their controls wrapping within the shared header.

The principal interaction is reading selectable PDF text and inserting it into the last focused card field without losing unfinished editor input. Anki's existing Add action creates the Note. Leaving the workspace invokes Anki's sticky-aware discard check.

## Existing visual authority

- `src/app.css`: incumbent semantic light/dark tokens, Inter and DM Sans, system appearance.
- `src/routes/StudyChrome.svelte`: shared app navigation and existing controls.
- `src/lib/components/ui`: existing shadcn components.
- `../addon/klaus_note/single_window.py`: three-pane behavior and proportions.

The quality bar is a usable, compact study workspace: readable file names, genuine source pages, explicit loading/error/empty states, visible selection, accessible labels, no horizontal document overflow on narrow screens, and no invented material or proof. The PDF page retains its own white source-paper surface independently of app appearance.

## Implementation scope

Plain PDF import and listing, folders, filter, refresh, paging, zoom, text search/selection/copy/insertion, the hosted Anki Add editor, and saved workspace layout. The parked Lectures route remains a separate workflow. PDF annotation, OCR, web tabs, and drag-to-image-occlusion parity are outside this change.

## Verification

Integrated checks, verification limits, and local delivery are recorded in the [implementation report](2026-10-06-library-workspace.md).
