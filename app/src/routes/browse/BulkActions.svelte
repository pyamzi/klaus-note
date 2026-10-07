<script lang="ts">
  import { onMount, tick } from "svelte";
  import { toast } from "svelte-sonner";
  import { addNoteTags, removeNoteTags, removeNotes, setDeck, getDeckNames, searchCards, searchNotes, buryOrSuspendCards, restoreBuriedAndSuspendedCards, scheduleCardsAsNew, scheduleCardsAsNewDefaults, setDueDate, findAndReplace, fieldNamesForNotes, getUndoStatus, undo, redo } from "@generated/backend";
  import { BuryOrSuspendCardsRequest_Mode as BuryMode, ScheduleCardsAsNewRequest_Context as ResetContext } from "@generated/anki/scheduler_pb";
  import { postProto } from "@generated/post";
  import { Json } from "@generated/anki/generic_pb";
  import { selectionSearch } from "$lib/browse/selection";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";

  let { ids, notesMode, beforeaction, oncomplete, onsearch, onbusychange }: {
    ids: bigint[]; notesMode: boolean; beforeaction: () => Promise<void>; oncomplete: () => Promise<void>;
    onsearch: (query: string) => Promise<void>; onbusychange: (busy: boolean) => void;
  } = $props();
  const labels = { deck: "Change deck", addTags: "Add tags", removeTags: "Remove tags", suspend: "Suspend", unsuspend: "Unsuspend", reset: "Reset to new", due: "Set due date", delete: "Delete notes", replace: "Find and replace", duplicates: "Find duplicate notes" };
  type Action = keyof typeof labels;
  let action: Action = $state("deck");
  let open = $state(false), busy = $state(false);
  let cardIds: bigint[] = $state.raw([]), noteIds: bigint[] = $state.raw([]);
  let selectionCount = $state(0);
  let decks: { id: bigint; name: string }[] = $state([]);
  let deck = $state(""), tags = $state(""), days = $state("0");
  let find = $state(""), replacement = $state(""), field = $state("");
  let fields: string[] = $state([]);
  let matchCase = $state(false), regex = $state(false), restorePosition = $state(true), resetCounts = $state(false);
  let undoLabel = $state(""), redoLabel = $state("");
  let error = $state("");
  let failureOpen = $state(false), failureTitle = $state(""), failureText = $state("");
  export function showFailure(title: string, cause: unknown) {
    failureTitle = title; failureText = String(cause); failureOpen = true;
  }
  let groups: { text: string; noteIds: string[] }[] | undefined = $state();
  const options = { alertOnError: false };
  const order = { value: { case: "none" as const, value: {} } };

  function setBusy(value: boolean) { busy = value; onbusychange(value); }
  export async function refreshUndo() {
    const status = await getUndoStatus({}, options);
    undoLabel = status.undo; redoLabel = status.redo;
    return status;
  }
  export async function history(direction: "undo" | "redo" = "undo") {
    if (busy) return;
    open = false;
    setBusy(true);
    try {
      await tick();
      await beforeaction();
      const status = await getUndoStatus({}, options);
      if (!status[direction]) return;
      await (direction === "undo" ? undo : redo)({}, options);
      await oncomplete(); await refreshUndo();
      toast(`${direction === "undo" ? "Undone" : "Redone"}: ${status[direction]}`);
    } catch (err) { showFailure("Could not update collection history", err); }
    finally { setBusy(false); }
  }
  onMount(() => { void refreshUndo().catch(() => {}); });

  async function prepare(next: Action) {
    if (busy || !ids.length) return;
    const chosen = [...ids], mode = notesMode;
    selectionCount = chosen.length; action = next; groups = undefined; error = "";
    setBusy(true);
    try {
      await tick();
      await beforeaction();
      const search = selectionSearch(chosen, mode);
      cardIds = mode ? (await searchCards({ search, order }, options)).ids : chosen;
      noteIds = mode ? chosen : (await searchNotes({ search, order }, options)).ids;
      if (next === "deck") {
        decks = (await getDeckNames({ skipEmptyDefault: false, includeFiltered: false }, options)).entries;
        deck = String(decks[0]?.id ?? "");
      }
      if (next === "replace" || next === "duplicates") {
        fields = (await fieldNamesForNotes({ nids: noteIds }, options)).fields;
        field = next === "duplicates" ? (fields[0] ?? "") : "";
      }
      if (next === "reset") {
        const defaults = await scheduleCardsAsNewDefaults({ context: ResetContext.BROWSER }, options);
        restorePosition = defaults.restorePosition; resetCounts = defaults.resetCounts;
      }
      open = true;
    } catch (err) { showFailure("Could not prepare selection", err); }
    finally { setBusy(false); }
  }

  async function apply(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); error = "";
    try {
      await tick();
      await beforeaction();
      const previousStep = (await getUndoStatus({}, options)).lastStep;
      switch (action) {
        case "deck": await setDeck({ cardIds, deckId: BigInt(deck) }, options); break;
        case "addTags": await addNoteTags({ noteIds, tags: tags.trim() }, options); break;
        case "removeTags": await removeNoteTags({ noteIds, tags: tags.trim() }, options); break;
        case "suspend": await buryOrSuspendCards({ cardIds, noteIds: [], mode: BuryMode.SUSPEND }, options); break;
        case "unsuspend": {
          // Restore only suspended cards; buried siblings keep their state.
          const suspended = (await searchCards({ search: `${selectionSearch(cardIds, false)} is:suspended`, order }, options)).ids;
          if (suspended.length) await restoreBuriedAndSuspendedCards({ cids: suspended }, options);
          break;
        }
        case "reset": await scheduleCardsAsNew({ cardIds, log: true, restorePosition, resetCounts, context: ResetContext.BROWSER }, options); break;
        case "due": await setDueDate({ cardIds, days: days.trim() }, options); break;
        case "delete": await removeNotes({ noteIds, cardIds: [] }, options); break;
        case "replace": await findAndReplace({ nids: noteIds, search: find, replacement, regex, matchCase, fieldName: field }, options); break;
        case "duplicates": {
          const response = await postProto("klausFindDuplicates", new Json({ json: new TextEncoder().encode(JSON.stringify({ noteIds: noteIds.map(String), fieldName: field })) }), Json, options);
          groups = JSON.parse(new TextDecoder().decode(response.json)).groups;
          return;
        }
      }
      open = false;
      await oncomplete();
      const status = await refreshUndo();
      if (status.lastStep === previousStep) toast("No changes were needed.");
      else toast(`${labels[action]} complete`);
    } catch (err) { if (open) error = String(err); else showFailure("Could not refresh the browser", err); }
    finally { setBusy(false); }
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}<Button {...props} variant="outline" size="sm" disabled={!ids.length || busy}>Selection ({ids.length.toLocaleString()})</Button>{/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end">
    {#each Object.entries(labels) as [key, label]}
      <DropdownMenu.Item onclick={() => prepare(key as Action)}>{label}</DropdownMenu.Item>
    {/each}
    <DropdownMenu.Separator />
    <DropdownMenu.Item disabled={!undoLabel || busy} onclick={() => history("undo")}>Undo {undoLabel}</DropdownMenu.Item>
    <DropdownMenu.Item disabled={!redoLabel || busy} onclick={() => history("redo")}>Redo {redoLabel}</DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
<Button variant="ghost" size="sm" disabled={!undoLabel || busy} onclick={() => history("undo")} title={undoLabel ? `Undo ${undoLabel}` : "Nothing to undo"}>Undo</Button>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{labels[action]}</Dialog.Title>
      <Dialog.Description>{selectionCount.toLocaleString()} selected {notesMode ? "notes" : "cards"}. {cardIds.length.toLocaleString()} cards in {noteIds.length.toLocaleString()} notes.</Dialog.Description>
    </Dialog.Header>
    <form onsubmit={apply} class="flex flex-col gap-4">
      {#if action === "deck"}
        <label class="text-sm">Destination deck<select bind:value={deck} required class="mt-1 h-9 w-full rounded-md border bg-background px-3">{#each decks as item}<option value={String(item.id)}>{item.name}</option>{/each}</select></label>
      {:else if action === "addTags" || action === "removeTags"}
        <label class="text-sm">Tags<Input bind:value={tags} required placeholder="Separate tags with spaces" class="mt-1" /></label>
        <p class="text-sm text-muted-foreground">Tags apply to the whole note, including sibling cards.</p>
      {:else if action === "reset"}
        <p class="text-sm">Return these cards to the new-card queue. This changes their scheduling.</p>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={restorePosition} />Restore original position</label>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={resetCounts} />Reset review and lapse counts</label>
      {:else if action === "due"}
        <label class="text-sm">Days from today<Input bind:value={days} required placeholder="0 or 1-7" class="mt-1" /></label>
        <p class="text-sm text-muted-foreground">0 means today. 1-7 spreads cards over the next week. Add ! to also change the interval, for example 5!.</p>
      {:else if action === "delete"}
        <p class="text-sm">Delete {noteIds.length.toLocaleString()} notes and every card belonging to them, including unselected siblings. You can undo this action.</p>
      {:else if action === "replace" || action === "duplicates"}
        <label class="text-sm">Field<select bind:value={field} required={action === "duplicates"} class="mt-1 h-9 w-full rounded-md border bg-background px-3">{#if action === "replace"}<option value="">All fields</option>{/if}{#each fields as item}<option value={item}>{item}</option>{/each}</select></label>
        {#if action === "replace"}
          <label class="text-sm">Find<Input bind:value={find} required class="mt-1" /></label>
          <label class="text-sm">Replace with<Input bind:value={replacement} class="mt-1" /></label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={matchCase} />Match case</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={regex} />Treat input as regular expression</label>
          <p class="text-sm text-muted-foreground">Replaces text in the selected notes. This may affect HTML formatting.</p>
        {:else}
          <p class="text-sm text-muted-foreground">Compare this field within the selected notes. Empty values do not count as duplicates.</p>
          {#if groups !== undefined}
            <p role="status" class="text-sm">{groups.length} duplicate groups found.</p>
            {#each groups as group}<Button variant="outline" class="h-auto justify-start whitespace-normal text-left" onclick={() => { open = false; void onsearch(`nid:${group.noteIds.join(",")}`); }}>{group.noteIds.length} notes: {group.text}</Button>{/each}
          {/if}
        {/if}
      {:else}<p class="text-sm">{action === "suspend" ? "Pause reviews for the selected cards." : "Restore suspended cards to their scheduled queue."}</p>{/if}
      {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
      <Dialog.Footer>
        <Button type="button" variant="outline" disabled={busy} onclick={() => (open = false)}>Cancel</Button>
        <Button type="submit" variant={action === "delete" ? "destructive" : "default"} disabled={busy || (action === "duplicates" && !field)}>{busy ? "Working…" : action === "duplicates" ? "Find duplicates" : labels[action]}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={failureOpen}>
  <Dialog.Content>
    <Dialog.Header><Dialog.Title>{failureTitle}</Dialog.Title><Dialog.Description>{failureText}</Dialog.Description></Dialog.Header>
    <Dialog.Footer><Button onclick={() => (failureOpen = false)}>Close</Button></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
