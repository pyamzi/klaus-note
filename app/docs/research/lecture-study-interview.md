# Lecture study workflow: design interview

Status: requirements recorded; reference-informed defaults and a consolidated [design proposal](lecture-study-design.md) are ready for review. This record is not proof of shipped functionality. The user has delegated routine behavior to reference research rather than further preference questions.

## Evidence

- User's lecture-processing brief, supplied in the KlausNote design conversation on 2026-10-06.
- Round 1 answers in that conversation: KlausNote first; external annotation is part of the workflow; live transcription while moving through slides; personal notes on the slide-and-writing-space PDF; one slide at a time for lecture decks, with textbooks excluded from that behavior; acceptance of the proposed edit-protection and source-grounding rules.

## Settled requirements

### Original brief

- Preserve the original source deck without modification.
- Keep the complete timestamped transcript as Markdown, searchable independently of the compiled study PDF.
- Keep lecture-level explanations, slide-level explanations, personal notes and the full transcript distinguishable.
- The compiled A4 study PDF is a generated presentation. Content may extend to extra pages rather than being compressed to fit one sheet.
- Retain access to the pristine original slide and figures derived from it, alongside the expanded lecture view.
- Prefer PDF structure and geometry for figure candidates, using vision for difficult boundaries or educational relevance when needed. Refer to a source page and region rather than eagerly duplicating every crop.
- Anki matching and image occlusion are later integration work.

### Round 1 answers

- KlausNote is the first product home.
- External PDF annotation is an everyday workflow requirement.
- The primary workflow is live: open lecture slides in KlausNote, start transcription, navigate slides as the lecturer speaks, and take personal notes on the PDF containing the slide and writing space below it.
- The lecture viewer presents one slide at a time. The user explicitly excluded textbooks from this behavior. Round 2 places the slide and writing area on the same A4 sheet.
- Generated explanations and personal contributions remain distinct. After the user edits an explanation, regeneration proposes changes rather than overwriting accepted text. This records the user's acceptance of recommendation 4.
- Main summaries are grounded in slides and transcript, with source references. Outside explanation is separately requested and labelled; contradictions are surfaced. This records the user's acceptance of recommendation 5.

### Round 2 answers

- Layout A: one A4 sheet with the original slide at the top and writing space below it, with continuation pages when needed.
- Apple Preview is the first external annotation compatibility target. Round 3 accepts the same-file Save workflow and prioritizes annotations; page rearrangement has not been requested for the initial version.
- The lecture folder alone must restore all current lecture content without requiring an account or edit history. [ADR-0009](../adr/0009-lecture-files-preserve-current-content.md) records this lecture-specific boundary.
- Transcription is built into KlausNote. Wispr Flow and the local OpenWhispr reference are interaction references, not authorization to select a particular model or hosted service.
- The user requests a "start recording on this slide" interaction and protection against accidental transcript reassignment during navigation. Round 3 resolves this as automatic forward-only assignment.

### Round 3 answers

- Start recording on the current Slide. Moving to a Slide later than the current Recording slide automatically advances the Recording slide. Looking backward or returning through earlier slides leaves it unchanged. The user rejected requiring a separate recording-target action at every slide because the workflow must feel seamless.
- Example: start on Slide 12, view Slide 7, then 8, then 12: new speech remains assigned to Slide 12. Viewing Slide 13 advances the Recording slide to 13. Changing between writing sheets belonging to the same Slide does not change that Slide's identity.
- Display lightly cleaned transcript text while retaining the original transcription. Keep qualifications, numbers, negations and substantive corrections; summarization remains separate.
- Display live transcription in a panel below the PDF viewer, comparable to VS Code's terminal panel. Add its visibility toggle to the top-left viewer toggles. This panel is separate from the PDF's personal writing area.
- Preserve annotated sheet layouts and annotation coordinates. Longer generated explanations use continuation pages; a redesigned export must not silently replace an annotated copy.
- Accept the same-file Preview workflow: open the working PDF externally, save, and have KlausNote incorporate the changes. Prioritize handwriting, highlights and text annotations. General page insertion/deletion/reordering is not an initial committed capability.
- Audio is temporary cache with automatic deletion after 24 hours by default, adjustable by the user. Transcript, explanations and personal annotations survive audio expiry.
- Working interpretation, stated to the user: the audio-retention period begins when the Recording stops. Round 4 delegates failure/expiry handling to reference research.

### Round 4 answers

- Process locally by default, with cloud as the secondary option.
- Finish transcription in the background after stopping. The answer supports end-of-lecture automation; the design proposal also schedules grounded summaries once the required transcript is finalized, preserving annotated pages.
- Use Wispr Flow/OpenWhispr evidence for routine recovery and interaction defaults instead of asking the user to invent those behaviors.
- Assume lecture slides on import; detect textbook/reading layouts automatically rather than asking for a document type on each import. Classification is correctable and must not be presented as infallible.
- A textbook/PDF is not itself a transcription input. Recording and imported video transcripts belong to lecture workflows; reading a textbook does not automatically start or expose that workflow.
- Support importing existing transcripts from videos in addition to live capture. The user has not requested video downloading as a prerequisite to transcript import.
- Keep corrected source decks as revisions of the same Lecture, preserve both sources, and offer transfer of annotations on unchanged slides with review for changed slides.

### Round 5: navigation and PDF transcript notes

- Original lecture slides should scroll continuously up and down, like Preview. This refines the earlier one-slide-at-a-time wording: that behavior applies to lecture-sheet / note-taking mode.
- Lecture-sheet / note-taking mode uses left/right page turns rather than vertical document navigation.
- The note-version PDF should contain the transcript as sticky notes associated with the lecture content, as well as summary notes for that transcript.
- Proposed interpretation for review: one expandable PDF text note per meaningful finalized transcript passage, attached to the relevant Slide; summary notes are visible on the sheet. Keep the canonical full transcript separately. Exact grouping and Preview round-trip behavior remain implementation validation work.

### Defaults selected under the user's delegation

- Adapt OpenWhispr's age-based audio cleanup and saved-audio retry: retry failed work while retained audio is available, expose Retry and Extend retention, and expire audio at the configured deadline without a silent failure exemption. Preserve transcript text and identify unrecoverable gaps after expiry. The 24-hour duration comes from the user, not the reference's default.
- Use local processing first. A configured and enabled cloud fallback may handle failures; absent that setting, keep the task local and retryable. No provider or paid model has been selected.
- Import SRT/VTT with their supplied start/end offsets, and TXT/Markdown or pasted text without fabricated timestamps. Preserve the supplied source. Slide alignment is a separate operation; unknown assignments remain unassigned while the full transcript stays available.
- Use inexpensive page geometry and text-layout signals for document classification, with lecture behavior as the default and a persistent manual override. Portrait slides and landscape reading documents must be included in validation; orientation alone is insufficient.

## Recording assignment examples

| Action | Viewed slide | Recording slide |
| --- | --- | --- |
| Start recording | 12 | 12 |
| Look back | 7 | 12 |
| Move forward through earlier slides | 8 | 12 |
| Return to current lecture position | 12 | 12 |
| Advance beyond current recording position | 13 | 13 |

The rule uses the current Recording's position, not the highest slide ever viewed before starting. Late transcription results must be associated using their captured audio interval, not whichever Slide is visible when decoding finishes. This is a derived correctness requirement of the accepted navigation behavior; backend timing support still needs implementation verification.

## Reference findings

Read-only inspection of the local `references/openwhispr-main` snapshot on 2026-10-06 found a continuous meeting recorder in addition to short dictation. Its [meeting control](../../references/openwhispr-main/src/components/notes/NoteRecordControl.tsx) supports persistent recording, and its [segment reducer](../../references/openwhispr-main/src/stores/meetingSegmentReducer.ts) distinguishes provisional, final and retracted text. The [recording store](../../references/openwhispr-main/src/stores/meetingRecordingStore.ts) handles microphone and system-audio streams. These are reference implementations, not verified KlausNote capabilities or selected providers.

The reference's dictation path preserves raw and processed text separately in [its history save path](../../references/openwhispr-main/src/hooks/useAudioRecording.js). Its [audio cleanup](../../references/openwhispr-main/src/helpers/audioStorage.js) expires dictation files by age, without checking failure status. Its [settings description](../../references/openwhispr-main/src/locales/en/translation.json) states that meeting audio is not retained; temporary speaker-analysis audio is a separate implementation detail. Its [meeting save mount](../../references/openwhispr-main/src/components/MeetingRecordingMount.tsx) periodically saves finalized text. KlausNote's durable audio retry queue, precise capture-to-slide timing and portable lecture persistence therefore require additional implementation rather than a claim of identical reference behavior.

Wispr Flow's [desktop documentation](https://docs.wisprflow.ai/articles/2772472373-what-is-flow), checked on 2026-10-06, describes inserting completed dictation after stopping. Its [cleanup documentation](https://docs.wisprflow.ai/articles/4283510616-Auto-Cleanup:-control-how-much-Flow-edits-your-dictation) distinguishes raw transcription from cleaned writing. Round 3 selects light cleanup with the original transcription retained for the lecture workflow.

Wispr Flow's [recovery documentation](https://docs.wisprflow.ai/articles/4984532368-fix-taking-longer-than-usual-and-transcription-errors), checked on 2026-10-06, offers retries when captured audio remains available. Its [24-hour local deletion setting](https://docs.wisprflow.ai/articles/4465314211-Delete-transcripts-and-history-in-Wispr-Flow) deletes transcript history; that is not the user's audio-only retention rule and must not be copied into KlausNote.

OpenWhispr's [upload flow](../../references/openwhispr-main/src/components/notes/UploadAudioView.tsx) transcribes audio/video files and downloaded YouTube audio. The inspected reference has transcript exports but no SRT/VTT import parser or caption retrieval path. Its [upload-note serializer](../../references/openwhispr-main/src/services/uploadNotes.ts) does not preserve supplied segment end offsets. Direct transcript import and faithful subtitle timing are new KlausNote work, not an existing reference feature to claim as implemented.

## Existing decisions requiring reconciliation

- [ADR-0002](../adr/0002-materials-are-plain-pdf-and-markdown.md) originally placed annotations and Clip Transcripts inside a mutable Document PDF and rejected sidecars. ADR-0009 now establishes the lecture-specific exception: immutable original plus portable canonical lecture files. Exact annotation representation remains open.
- [ADR-0005](../adr/0005-edit-history-is-truth-google-docs-model.md) makes edit history authoritative and files projections for general Materials. ADR-0009 requires the lecture folder to recover all current lecture content without that history; undo/collaboration history can remain additional data.
- [The glossary](../../CONTEXT.md) reserves Note for Anki, Page for Markdown, and Study for card review. Lecture, Source deck and Slide now distinguish the lecture material from its audio Recording. User-facing names for the expanded viewer and personal writing are not yet settled.
- An externally annotated study PDF contains new personal work. It cannot be discarded as a reproducible export until that work is preserved. Round 3 requires stable annotated layouts and same-file external Save support; annotation storage and merge details still need design and validation.

## Remaining work before implementation

The [design proposal](lecture-study-design.md) specifies the routine defaults and covers the remaining branches: capture sources, stable IDs, imported transcript alignment, annotation round trips, source revisions, figure regions, pipeline state, and future Card matching. These are proposed implementation decisions under the user's delegation, not individually confirmed product requirements.

Validate the annotation representation against actual Preview round trips, the capture timing against the selected local engine, and classification against representative non-private PDFs during implementation. These are engineering checks rather than questions for the user to answer from memory.

The next design gate is confirmation that the consolidated proposal matches the user's intended workflow, as required by the grilling skill. No application implementation is authorized by this document alone.
