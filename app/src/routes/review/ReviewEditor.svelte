<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { night } from "$lib/card";
  import { noteEditor, type NoteEditor } from "$lib/editor/note-editor";

  let { noteId, cardId, deckId, ondone, oncancel }: {
    noteId: bigint; cardId: bigint; deckId: bigint;
    ondone: () => Promise<void>; oncancel: () => void;
  } = $props();
  // Embedded browser mode avoids current-mode native Close hooks; this dialog owns saving and closing.
  let editor: NoteEditor | undefined;
  let editorBusy = $state(false);
  let ready = $state(false), saving = $state(false), error = $state("");

  async function done() {
    if (!ready || saving) return;
    saving = true; error = "";
    try {
      if (!editor) throw new Error("Note editor is unavailable");
      await editor.settle();
      await ondone();
    } catch (err) { error = String(err); }
    finally { saving = false; }
  }
  function attach(value: NoteEditor | undefined) {
    editor = value;
    if (!value) return;
    void value.show(noteId, { cardId, deckId }).then(shown => { if (editor === value) ready = shown; })
      .catch(err => { if (editor === value) error = String(err); });
  }
</script>
<div class="flex min-h-0 flex-1 flex-col">
  <p class="text-sm text-muted-foreground">Changes save to this note. Your current card and answer stay in place.</p>
  {#if error}<p role="alert" class="py-2 text-destructive">{error}</p>{/if}
  <iframe use:noteEditor={{ mode: "existing", attach, onbusy: value => editorBusy = value }} inert={editorBusy || saving} src={`/editor/?mode=browser${night ? "#night" : ""}`} title="Edit current note" class="min-h-0 w-full flex-1 border-0"></iframe>
  <div class="flex justify-end gap-2 pt-3">{#if !ready}<Button variant="outline" onclick={oncancel}>Cancel</Button>{/if}<Button onclick={done} disabled={!ready || saving}>{saving ? "Saving…" : "Done"}</Button></div>
</div>
