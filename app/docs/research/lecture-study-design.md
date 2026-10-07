# KlausNote lecture workflow: consolidated design proposal

Status: proposed design for shared-understanding review, 2026-10-06. Product requirements come from the [interview record](lecture-study-interview.md); routine defaults below are proposed under the user's instruction to use reference research. No application functionality has been implemented or runtime-tested in this design session.

## Student workflow

1. Import the source deck. Assume lecture slides; recognize likely textbook/reading layouts using PDF geometry and text structure. Keep a quiet, persistent document-type override rather than a mandatory import question.
2. Original-slide mode presents a continuous vertical document, scrolled up and down like Preview. Lecture-sheet/note-taking mode presents one A4 sheet at a time, with left/right buttons and arrow keys to turn pages. Each sheet contains the source slide, summary and writing space; continuation sheets remain associated with the same Slide. Textbooks retain their normal reading layout.
3. Start recording on the current Slide. Capture continues while the student writes or looks back. Viewing a later Slide automatically advances the Recording slide; looking backward does not move it.
4. Show lightly cleaned live transcription in a resizable bottom panel, toggled with the viewer's top-left controls. Keep provisional text visually distinct from finalized text. The panel must not move annotations on the PDF.
5. Stop capture without making the student wait. Finish pending transcription, then generate the lecture-level summary and slide explanations in the background. Preserve personal contributions and already annotated page geometry.
6. Open the writable lecture PDF in Preview, annotate, and Save. Detect external changes and reconcile them into the same Lecture. Preserve the received file before attempting reconciliation.
7. Export a complete A4 study document containing visible summary notes and expandable transcript sticky notes associated with the relevant Slide. Retain quick access to the unmodified original Slide and source-derived figures.

A second entry path imports an existing video transcript into the Lecture. It does not require recording, downloading the video, or repeating speech recognition. A transcript can remain useful and searchable before a source deck is attached or slide alignment is complete.

Textbook reading does not create a transcription job. If speech about a textbook is ever captured, the speech belongs to a lecture/recording context that can reference the book; the book itself is not an audio input.

## Sources, personal work and generated files

Use [ADR-0009](../adr/0009-lecture-files-preserve-current-content.md): the lecture folder must restore current retained content without an account or separate application history. This layout is proposed; names are not final UI labels.

```text
Lecture/
├── source.pdf                  original first deck, never rewritten
├── sources/                    additional immutable deck revisions
├── imports/                    supplied transcripts, preserved as received
├── transcript-original.md      original finalized speech-recognition/import text
├── transcript.md               current readable/corrected transcript
├── notes.md                    personal text and user-edited explanations
├── annotations.pdf             writable lecture sheets with personal PDF marks
├── metadata.json               identities, time ranges, provenance and mappings
├── generated/
│   ├── lecture-summary.md
│   └── slide-explanations.md
├── output/
│   └── study.pdf               rebuildable assembled export
└── cache/
    └── audio/                  retained only for the configured interval
```

- `annotations.pdf` is a proposed portable home for actual PDF annotations, including ink. Once annotated, it is user source data, not a disposable render. The complete source deck remains separate and pristine. PDF marks are authoritative in this working PDF; extracted text/OCR for search is a derived representation, not a second writer of those marks.
- `notes.md` owns personal Markdown text and explanations the student edits. Untouched AI explanations remain generated material. An edited explanation is promoted to protected personal content before a later generation can replace its draft.
- The app's Open in Preview action opens the writable lecture document. The assembled export is reproducible until the user modifies a copy; importing that modified copy preserves it as additional personal source material.
- The note-version PDF contains finalized transcript passages as actual PDF text-note annotations, not links that depend on KlausNote. Proposed granularity: one note per meaningful timestamped passage assigned to a Slide, not per provisional recognition update. Put a stable segment ID, lecture/slide label, available time range and full passage text in each note; use continuation sheets if many notes would overlap. Untimed passages stay untimed. Unassigned passages belong in a clearly labelled transcript appendix rather than being attached to an invented Slide. Summary notes are visible page content and cite the relevant transcript passages. This is an output representation; the complete canonical Markdown transcript is retained for search and regeneration.
- A PDF note corrected in Preview is personal source material. Preserve the returned file and surface a proposed transcript correction using the segment ID; do not silently replace either the canonical text or the edited PDF note. Export re-runs must update matching generated notes without duplicating passages or removing user-created annotations.
- Standard PDF annotations must survive Preview round trips. If a returned file contains edits that cannot be represented or reconciled faithfully, keep that file as a source revision and flag the unresolved import. Do not flatten, strip or discard the unknown marks to make a merge appear successful.
- Exact PDF composition and annotation mapping must be proven with fixtures before this representation is finalized. In particular, preserve marks drawn on the slide itself as well as the writing area. New summaries cannot shift existing marked pages; use continuation pages or a separate regenerated export.
- A newer deck never overwrites an older source. Detect unchanged slides, offer their annotation transfer, and require review where page content or geometry changed. Existing transcript/annotation links continue to reference their original revision until an accepted remapping.

## Minimal data model

Stable IDs must not be derived solely from mutable filenames or display page numbers.

| Entity | Minimum information | Ownership |
| --- | --- | --- |
| Lecture | ID, display name, active deck revision, input references | Student |
| Deck revision | ID, source path, content hash, page geometry | Immutable supplied source |
| Slide | ID, deck revision, source page index and geometry | Identity within source revision |
| Lecture sheet | ID, owning Slide, working PDF page, source-to-sheet transform | Stable annotated surface |
| Recording | ID, capture sources, start/stop times, retained audio references, expiry, processing state | Durable metadata with temporary audio |
| Transcript segment | ID, source/Recording ID, supplied or captured start/end offsets, text anchors, finality | Transcript source and user corrections |
| Slide assignment | Segment/time range, Slide ID, method, confidence/review state | Live navigation evidence or accepted alignment |
| PDF transcript note | Annotation identity, segment IDs, Slide/sheet reference, exported text revision | Generated projection until externally edited |
| Personal contribution | ID, Slide/sheet association, Markdown block or PDF annotation identity | Student; never silently regenerated |
| Generated explanation | ID, source references, input revision hashes, generator metadata, freshness | Rebuildable until personally edited |
| Figure region | ID, deck revision, source page, normalized rectangle, review state | Source reference, no eager raster duplication |

Keep media-relative start/end offsets separate from wall-clock capture dates. Nullable timing means unknown timing; an ordering index must not be presented as an audio timestamp.

Metadata references text in the Markdown documents rather than duplicating the entire transcript. Source references for explanations can identify both slide regions and transcript segment IDs. The original transcription is the speech model's output or the supplied text, not a claim of perfect verbatim accuracy.

## Live timing and navigation

- Starting on Slide 12 sets both Viewed slide and Recording slide to 12. Viewing 7, 8 or 12 leaves Recording slide at 12; viewing 13 advances it to 13. Continuation pages of Slide 12 remain the same Slide.
- Original-slide scrolling chooses the page nearest the viewer center as the Viewed slide; use a small stability threshold before recording a new position. This focus rule is proposed. Merely switching viewer modes preserves the current Slide and cannot advance recording because of temporary scroll layout. Lecture-sheet arrows advance sheets; continuation sheets keep the same Slide identity. Arrow keys must not navigate while typing or interacting with a dialog.
- Persist recording-position changes as events on the capture timeline. Bind returned speech to the corresponding capture interval, not to the currently visible page when asynchronous inference finishes.
- Preserve continuous audio across page turns. A recognition result crossing a boundary retains its actual interval; do not duplicate its words into both slides. Use reliable timing when available, otherwise mark a boundary-spanning assignment for correction rather than inventing word-level timing.
- Offer correction of a mistaken assignment in transcript controls, without requiring an action at every normal page turn.
- Pause/resume stays within the lecture recording workflow and preserves timing gaps. A fresh start initializes the Recording slide from the current view rather than carrying a maximum slide number from an earlier capture.
- Finalized segments and completed jobs persist incrementally. Provisional hypotheses can change and must not overwrite a student correction. Durable completion/retry state is additional KlausNote work, not established by the reference's periodic text-save behavior.

## Processing and recovery

- Local speech recognition and generation are the default. Cloud is secondary and uses a configured, enabled destination. When cloud fallback is enabled, it can run after local failure without a new per-slide interaction; otherwise keep the work local and retryable.
- Propose microphone capture as the initial default, with computer audio and combined capture selectable and remembered. Combined capture requires duplicate/echo handling; the reference demonstrates this flow but it must be verified on the target platform.
- User-facing states: Recording, Finishing transcript, Preparing notes, Ready, and Needs attention. Closing the document does not cancel a durable job. Resume interrupted eligible work when KlausNote next runs; do not imply work runs after the app/process exits.
- Stop recording closes capture, persists the stop time and queues remaining transcription. Summary generation waits for the necessary finalized text. It may produce clearly labelled partial results after an error, never present a missing interval as a complete lecture.
- Cache retention defaults to 24 hours from recording stop and is adjustable. On an interrupted session without a normal stop, use the last persisted capture time as the recovery boundary; do not reset the deadline on every launch or retry.
- Retry from saved audio while it remains available. Show Retry and Extend retention for incomplete work. Failure does not silently create indefinite retention. At expiry, remove the audio, retain all text/annotations, and mark unrecoverable gaps.
- Cleanup runs while the app's background process is active and again on startup. The design cannot promise physical deletion while the computer or app process is not running; eligible data is removed when execution resumes.
- Audio expiry is separate from transcript deletion, indexing, cloud retention and lecture deletion. Do not copy Wispr Flow's transcript-history auto-delete into this feature. Audio cache is excluded from durable lecture sync by default; an enabled transcription provider's handling needs a separate implementation review.

## Imported transcripts

- Initial formats: SRT, WebVTT, TXT and Markdown, plus pasted transcript text. This format set is a proposed routine default under the user's request, not an existing OpenWhispr importer.
- Preserve the supplied file and its original cue start/end offsets. Preserve gaps, overlapping cues and speaker labels when supplied. Normalize a readable Markdown transcript without deleting the source.
- Untimed text remains untimed. It is still searchable and usable for lecture-level explanations. Do not invent evenly spaced timestamps or pretend text position is video time.
- A video-relative timestamp does not identify a Slide. Suggest slide alignment using text/visual context as a separate local-first task; preserve uncertain or unmatched segments, and let the student correct assignments. No supplied transcript should disappear because alignment failed.
- Treat spoken text as lecture content. Imported text may influence summaries through cited source passages, but is not an instruction to alter application settings or execute actions.
- Direct import of an existing transcript is distinct from fetching captions from a URL or downloading/transcribing video. Those additional transports have not been requested as initial requirements and are not prerequisites for this import path.

## Summaries, figures and search

- Lecture summary answers the overall teaching intent. Slide explanations combine source slide content with assigned transcript context. Cite the source passages and surface contradictions. Separately requested external explanation remains labelled.
- Regenerate only affected derived outputs after transcript corrections, source revision changes or accepted alignment edits. User-edited explanations remain protected and receive proposed revisions.
- Inspect embedded images, their placements, text blocks, vector regions and page geometry first. Use vision selectively for uncertain educational relevance or boundaries. Classification/cropping quality remains an implementation validation target, not a promised property of all PDFs.
- Keep figure regions tied to their immutable source revision. Render at the requested resolution on demand. A raw embedded image may omit associated labels or vector content, so direct extraction is used only when it represents the intended figure faithfully.
- Search covers the full transcript and personal text even before alignment. Future Card matching can add grounded explanations, transcript segments and lecture context to slide content. Matching and image occlusion remain later integration work; avoid mixing generated context with unlabelled source evidence.

## Interface defaults

- Original slides: continuous vertical scrolling. Lecture sheets / note-taking: one sheet at a time, left/right buttons or arrow keys; vertical scrolling must not turn to another sheet. Fit the sheet to the viewer by default. Textbooks retain normal reading layout.
- A top-left toggle opens/closes the bottom Transcript panel. Preserve its height and visibility preference. Recording state and current Recording slide remain discoverable when the panel is hidden.
- Transcript-note icons on the lecture sheet open the associated finalized passages with timestamps; visible summary text sits below the source slide. Keep these distinct from the live bottom panel. The expanded note in the HTML demo is a simulation of the proposed PDF annotation.
- Original/lecture view switch preserves Slide identity. Figure selection opens a source-derived region without losing lecture position.
- Normal controls remain Start, Pause/Resume and Stop. Provider endpoints, models, capture diagnostics and fallback policy belong in advanced settings, with simple model readiness/download status where required.
- Use the existing Klaus design system and app bridge contract. Keep transcript processing and persistence out of viewer components so desktop and hosted surfaces can share the workflow.

## Verification before calling this implemented

1. Source deck bytes remain unchanged after capture, annotation, Preview round trips and exports.
2. The 12 → 7 → 8 → 13 navigation sequence yields 12 → 12 → 12 → 13 speech assignments even when inference finishes late.
3. Stopping or closing a document preserves queued work; restart resumes retained incomplete intervals without duplicating finalized segments.
4. Audio expires according to policy while transcript, personal writing and source citations remain accessible. Failed entries do not bypass the deadline silently.
5. Imported SRT/VTT keep exact supplied cue offsets; untimed files retain unknown times; alignment uncertainty remains visible.
6. Preview ink, highlights and text survive the same-file Save workflow. Simultaneous edits or unsupported transformations preserve both originals and require reconciliation instead of silently losing work.
7. Regeneration cannot shift annotated sheet geometry or replace user-edited explanations. New deck revisions preserve the old source and its links.
8. Classification is exercised on landscape slides, portrait slides, reading PDFs and mixed-layout documents, with a working override and no repeated import questionnaire.
9. A copied lecture folder reconstructs current retained content without account/history access. Audio already expired by policy is not resurrected.
10. Verify continuous original-slide scrolling, sheet-only left/right navigation, no arrow-key interception while writing, and unchanged recording assignment when toggling modes. Export a PDF fixture, open its transcript notes in Preview, edit/save/reimport them, and check segment identities, Unicode, long text, no duplicated notes, visible summaries, unchanged original bytes, and preserved personal annotations. Browser mockups are not PDF compatibility evidence.
11. Inspect the real KlausNote viewer with non-private fixtures, including the bottom transcript panel, original/lecture switching, hidden-panel recording state and background completion. Source inspection and headless tests alone do not establish the user experience.

## Reference evidence

- OpenWhispr [meeting control](../../references/openwhispr-main/src/components/notes/NoteRecordControl.tsx), [partial/final reducer](../../references/openwhispr-main/src/stores/meetingSegmentReducer.ts), [audio expiry](../../references/openwhispr-main/src/helpers/audioStorage.js), and [retention defaults](../../references/openwhispr-main/src/helpers/retentionSettings.js).
- OpenWhispr [audio/video upload flow](../../references/openwhispr-main/src/components/notes/UploadAudioView.tsx), [upload segment storage](../../references/openwhispr-main/src/services/uploadNotes.ts), and [export formatter](../../references/openwhispr-main/src/helpers/transcriptFormatter.js). These do not supply a faithful subtitle-file import implementation.
- Wispr Flow [saved-audio recovery](https://docs.wisprflow.ai/articles/4984532368-fix-taking-longer-than-usual-and-transcription-errors) and [history deletion](https://docs.wisprflow.ai/articles/4465314211-Delete-transcripts-and-history-in-Wispr-Flow), checked 2026-10-06.
- Apple Preview [PDF notes](https://support.apple.com/guide/preview/add-notes-and-speech-bubbles-to-a-pdf-prvw7450efd7/mac), checked 2026-10-06, documents click-to-open notes and a notes sidebar. This supports the interaction direction, not verified KlausNote export compatibility.
- App [bridge-only UI decision](../adr/0006-ui-talks-only-to-the-bridge.md) and [lecture portability decision](../adr/0009-lecture-files-preserve-current-content.md).

Reference findings are from source/documentation inspection. They are not a claim that OpenWhispr was run or that its behavior has already been ported to KlausNote.
