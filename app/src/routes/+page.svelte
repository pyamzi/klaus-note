<script lang="ts">
  import {
    addDeck,
    customStudy,
    getDeck,
    getUndoStatus,
    graphs,
    getProfileConfigJson,
    setProfileConfigJson,
    setCurrentDeck,
    congratsInfo,
    unburyDeck,
    addOrUpdateFilteredDeck,
    deckTree,
    emptyFilteredDeck,
    getOrCreateFilteredDeck,
    newDeck,
    rebuildFilteredDeck,
    removeDecks,
    renameDeck,
    setDeckCollapsed,
    undo,
    redo,
  } from "@generated/backend";
  import {
    type Deck,
    Deck_Filtered_SearchTerm,
    Deck_Filtered_SearchTerm_Order as Order,
    type DeckTreeNode,
    FilteredDeckForUpdate,
    SetDeckCollapsedRequest_Scope,
  } from "@generated/anki/decks_pb";
  import { UnburyDeckRequest_Mode as UnburyMode } from "@generated/anki/scheduler_pb";
  import type { GraphsResponse } from "@generated/anki/stats_pb";
  import { IconSettings, IconArrowUp, IconArrowDown, IconX } from "@tabler/icons-svelte";
  import { keyIsTaken } from "$lib/keys";
  import { Empty, String as PbString } from "@generated/anki/generic_pb";
  import { postProto } from "@generated/post";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Field from "$lib/components/ui/field";
  import { Input } from "$lib/components/ui/input";
  import { nightHash } from "$lib/theme";
  import * as Select from "$lib/components/ui/select";
  import * as Table from "$lib/components/ui/table";
  import DeckRows, { type DeckAction } from "./DeckRows.svelte";
  import StudyChrome from "./StudyChrome.svelte";
  import DashboardContext from "./DashboardContext.svelte";
  import ReviewHeatmap from "./ReviewHeatmap.svelte";

  let root: DeckTreeNode | undefined = $state();
  let loadError = $state("");
  const selectedId = new URLSearchParams(location.search).get("deck");
  let selected: Deck | undefined = $state();
  let description = $state("");
  let haveUserBuried = $state(false);
  let haveSchedBuried = $state(false);
  let unburyOpen = $state(false);
  let history: GraphsResponse | undefined = $state();
  let historyError = $state("");
  let editing = $state(false);
  let dragging = $state("");
  let landing = $state("");
  function dropWidget(target: string) {
    if (!editing || !dragging || dragging === target) return;
    const next = order.filter((id) => id !== dragging);
    next.splice(order.indexOf(target), 0, dragging);
    order = next;
    dragging = landing = "";
    savePreference("dashboard_order", order);
  }
  let scale = $state(100);
  let heatmapVisible = $state(true);
  let uniform = $state(false);
  let order = $state(["decks", "heatmap"]);
  const selectedNode = $derived.by(() => {
    const walk = (node: DeckTreeNode): DeckTreeNode | undefined => {
      if (String(node.deckId) === selectedId) return node;
      for (const child of node.children) { const found = walk(child); if (found) return found; }
    };
    return root && walk(root);
  });
  const due = $derived(selectedNode ? selectedNode.newCount + selectedNode.learnCount + selectedNode.reviewCount : 0);
  let saveQueue = Promise.resolve();
  function savePreference(key: string, value: unknown) {
    saveQueue = saveQueue.then(async () => { await setProfileConfigJson({ key, valueJson: new TextEncoder().encode(JSON.stringify(value)) }, { alertOnError: false }); })
      .catch((err) => { toast.error("Could not save dashboard settings", { description: String(err) }); });
  }
  function moveWidget(id: string, direction: number) {
    const next = [...order], index = next.indexOf(id), target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    order = next;
    savePreference("dashboard_order", order);
  }
  async function loadDashboard() {
    const keys = ["dashboard_order", "dashboard_scale", "heatmap_enabled", "dashboard_uniform"];
    const values = await Promise.all(keys.map(async (val) => {
      const result = await getProfileConfigJson({ val }, { alertOnError: false });
      return JSON.parse(new TextDecoder().decode(result.json));
    }));
    if (Array.isArray(values[0]) && values[0].includes("decks") && values[0].includes("heatmap"))
      order = [...new Set(values[0].filter((id: unknown) => id === "decks" || id === "heatmap"))] as string[];
    if (Number.isInteger(values[1]) && values[1] >= 70 && values[1] <= 150 && values[1] % 5 === 0) scale = values[1];
    if (typeof values[2] === "boolean") heatmapVisible = values[2];
    if (typeof values[3] === "boolean") uniform = values[3];
  }
  function startStudy() { if (selected && due) location.href = `/review?deck=${selected.id}`; }
  function sharedDecks() {
    postProto("openLink", new PbString({ val: "https://ankiweb.net/shared/decks" }), Empty).catch(() => {});
  }
  let customOpen = $state(false);
  let customMode = $state("newLimitDelta");
  let customAmount = $state(10);
  async function runCustomStudy(event: SubmitEvent) {
    event.preventDefault();
    if (!selected || busy || !Number.isInteger(customAmount) || customAmount < 1) return;
    busy = true;
    try {
      await customStudy({ deckId: selected.id, value: { case: customMode as "newLimitDelta", value: customAmount } });
      customOpen = false;
      // Custom Study may have created and selected Anki's filtered deck.
      if (["newLimitDelta", "reviewLimitDelta"].includes(customMode)) await refresh();
      else location.href = "/";
    } catch { /* The bridge displays the error. */ }
    finally { busy = false; }
  }


  async function unbury(mode: UnburyMode) {
    if (!selected || busy) return;
    busy = true;
    try {
      await unburyDeck({ deckId: selected.id, mode }, { alertOnError: false });
      unburyOpen = false;
      await refresh();
    } catch (err) {
      toast.error("Could not restore buried cards", { description: String(err) });
    } finally { busy = false; }
  }

  async function refresh() {
    try {
      loadError = "";
      if (selectedId) {
        selected = await getDeck({ did: BigInt(selectedId) });
        await setCurrentDeck({ did: selected.id });
        const info = await congratsInfo({});
        description = info.deckDescription;
        haveUserBuried = info.haveUserBuried;
        haveSchedBuried = info.haveSchedBuried;
      }
      root = await deckTree({ now: BigInt(Math.floor(Date.now() / 1000)) });
      if (!selectedId) graphs({ search: "", days: 365 }, { alertOnError: false })
        .then((data) => { history = data; historyError = ""; })
        .catch((err) => { historyError = String(err); });
    } catch (err) {
      loadError = String(err);
    }
  }
  onMount(() => {
    refresh();
    loadDashboard().catch((err) => toast.error("Could not load dashboard settings", { description: String(err) }));
    const onKey = (event: KeyboardEvent) => {
      if (keyIsTaken(event) || event.ctrlKey || event.metaKey || event.altKey || !selectedId) return;
      if (event.key === "Escape") location.href = "/";
      else if (event.key.toLowerCase() === "s" || event.key === "Enter") startStudy();
      else return;
      event.preventDefault();
    };
    const onHistory = async (event: Event) => {
      if (busy) return;
      const action = (event as CustomEvent).detail;
      if (action !== "undo" && action !== "redo") return;
      busy = true;
      retireUndo();
      try {
        const result = await (action === "undo" ? undo : redo)({}, { alertOnError: false });
        toast(`${result.operation} ${action === "undo" ? "undone" : "redone"}`);
        await refresh();
      } catch (err) { toast.error("Could not update collection history", { description: String(err) }); }
      finally { busy = false; }
    };
    addEventListener("keydown", onKey);
    addEventListener("klaus-collection-history", onHistory);
    return () => { removeEventListener("keydown", onKey); removeEventListener("klaus-collection-history", onHistory); };
  });

  // Klaus's shell shows a file picker, then opens Anki's import page.
  function importPackage() {
    postProto("klausImportPackage", new Empty(), Empty).catch(() => {
      // Shown by the bridge.
    });
  }

  // Create / Rename. "Parent::Child" nests, as in Anki.
  let nameOpen = $state(false);
  let renaming: DeckTreeNode | undefined = $state();
  let name = $state("");
  function askName(deck?: DeckTreeNode) {
    renaming = deck;
    name = deck ? fullName(deck) : "";
    nameOpen = true;
  }
  // Undo reverts the collection's latest operation, so only the newest delete's
  // toast may offer it: any later change (another delete, a rename…) retires it.
  let undoToast: string | number | undefined;
  let undoStep: number | undefined;
  function retireUndo() {
    if (undoToast !== undefined) toast.dismiss(undoToast);
    undoToast = undefined;
    undoStep = undefined;
  }

  // A save in flight: a second Enter mustn't add the deck twice.
  let busy = $state(false);

  async function saveName(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    retireUndo();
    const trimmed = name.trim();
    if (!trimmed) return;
    busy = true;
    try {
      if (renaming) {
        await renameDeck({ deckId: renaming.deckId, newName: trimmed });
      } else {
        const deck = await newDeck({});
        deck.name = trimmed;
        await addDeck(deck);
      }
      nameOpen = false;
      await refresh();
    } catch {
      // The bridge's error was already shown.
    } finally {
      busy = false;
    }
  }

  /** The tree holds each deck's last component; renaming needs the full path. */
  function fullName(target: DeckTreeNode): string {
    const walk = (node: DeckTreeNode, path: string[]): string | undefined => {
      for (const child of node.children) {
        const here = [...path, child.name];
        if (child.deckId === target.deckId) return here.join("::");
        const found = walk(child, here);
        if (found) return found;
      }
    };
    return (root && walk(root, [])) ?? target.name;
  }

  const orderLabel = (value: Order) => orders.find(([v]) => v === value)?.[1] ?? "";

  // Anki's filtered deck dialog (aqt/filtered_deck.py): first search, optional
  // second, reschedule. Preview delays keep their saved values.
  const orders: [Order, string][] = [
    [Order.OLDEST_REVIEWED_FIRST, "Oldest seen first"],
    [Order.RANDOM, "Random"],
    [Order.INTERVALS_ASCENDING, "Increasing intervals"],
    [Order.INTERVALS_DESCENDING, "Decreasing intervals"],
    [Order.LAPSES, "Most lapses"],
    [Order.ADDED, "Order added"],
    [Order.DUE, "Order due"],
    [Order.REVERSE_ADDED, "Latest added first"],
    [Order.RETRIEVABILITY_ASCENDING, "Retrievability ascending"],
    [Order.RETRIEVABILITY_DESCENDING, "Retrievability descending"],
    [Order.RELATIVE_OVERDUENESS, "Relative overdueness"],
  ];
  let filteredOpen = $state(false);
  let filtered: FilteredDeckForUpdate | undefined = $state();
  let filteredName = $state("");
  // Plain objects: $state doesn't track protobuf class instances.
  type Term = { search: string; limit: number; order: Order };
  let terms: Term[] = $state([]);
  let second = $state(false);
  let reschedule = $state(true);
  async function openFiltered(deckId = 0n) {
    try {
      const deck = await getOrCreateFilteredDeck({ did: deckId });
      const saved = deck.config!.searchTerms;
      const plain = ({ search, limit, order }: Term): Term => ({ search, limit, order });
      terms = [plain(saved[0]), saved[1] ? plain(saved[1]) : { search: "", limit: 20, order: Order.DUE }];
      // As Anki: a second filter shows as enabled only for an existing deck.
      second = deckId !== 0n && saved.length > 1;
      reschedule = deck.config!.reschedule;
      filteredName = deck.name;
      filtered = deck;
      filteredOpen = true;
    } catch {
      // Shown by the bridge.
    }
  }
  async function saveFiltered(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    retireUndo();
    const deck = filtered!;
    deck.name = filteredName;
    deck.config!.searchTerms = (second ? terms : terms.slice(0, 1)).map((t) => new Deck_Filtered_SearchTerm(t));
    deck.config!.reschedule = reschedule;
    busy = true;
    try {
      // Saving (re)builds the deck; Anki then shows it.
      await addOrUpdateFilteredDeck(deck);
      filteredOpen = false;
      await refresh();
    } catch {
      // e.g. no cards matched: shown by the bridge; the dialog stays open.
    } finally {
      busy = false;
    }
  }

  async function onaction(action: DeckAction, deck: DeckTreeNode) {
    if (busy) return;
    if (action !== "rename" && action !== "filteredOptions") retireUndo();
    busy = true;
    try {
      switch (action) {
        case "collapse":
          await setDeckCollapsed({
            deckId: deck.deckId,
            collapsed: !deck.collapsed,
            scope: SetDeckCollapsedRequest_Scope.REVIEWER,
          });
          break;
        case "rename":
          return askName(deck);
        case "filteredOptions":
          return openFiltered(deck.deckId);
        case "rebuild":
          await rebuildFilteredDeck({ did: deck.deckId });
          break;
        case "empty":
          await emptyFilteredDeck({ did: deck.deckId });
          break;
        case "delete": {
          // As Anki: no confirmation, but an undo in the "N cards deleted" notice.
          const { count } = await removeDecks({ dids: [deck.deckId] });
          undoStep = (await getUndoStatus({}, { alertOnError: false })).lastStep;
          undoToast = toast(`Deleted ${deck.name} (${count} ${count === 1 ? "card" : "cards"})`, {
            action: { label: "Undo", onClick: undoDelete },
            onDismiss: () => (undoToast = undefined),
            onAutoClose: () => (undoToast = undefined),
          });
          break;
        }
      }
      await refresh();
    } catch {
      // Shown by the bridge.
    } finally { busy = false; }
  }

  async function undoDelete() {
    if (busy) return;
    busy = true;
    const expected = undoStep;
    retireUndo();
    try {
      const status = await getUndoStatus({}, { alertOnError: false });
      if (expected === undefined || status.lastStep !== expected) {
        toast("The collection has changed. Use Collection Undo to review the latest operation.");
        return;
      }
      await undo({});
      await refresh();
    } finally { busy = false; }
  }
</script>

<div class="flex min-h-screen flex-col bg-background">
  <StudyChrome onsynced={refresh} />
  <main class="mx-auto flex w-full max-w-[832px] flex-1 flex-col gap-5 px-4 py-8">
    {#if loadError}<p role="alert" class="text-destructive">{loadError}</p>{/if}
    {#if selectedId}
      {#if selected && selectedNode}
        <section class="mx-auto flex w-full max-w-lg flex-col items-center gap-6 py-10 text-center" aria-label="Deck overview">
          <h1 class="text-2xl font-semibold tracking-tight">{selected.name.replaceAll("::", " / ")}</h1>
          <dl class="grid grid-cols-[1fr_auto] gap-x-12 gap-y-3 text-left text-sm">
            <dt>New</dt><dd class="text-right text-count-new tabular-nums">{selectedNode.newCount}</dd>
            <dt>Learning</dt><dd class="text-right text-count-learn tabular-nums">{selectedNode.learnCount}</dd>
            <dt>To Review</dt><dd class="text-right text-count-review tabular-nums">{selectedNode.reviewCount}</dd>
          </dl>
          {#if due}<Button onclick={startStudy}>Study Now</Button>
          {:else}<p class="text-sm text-muted-foreground">Congratulations! You have finished this deck for now.</p>{/if}
          {#if haveUserBuried || haveSchedBuried}<Button variant="outline" disabled={busy} onclick={() => haveUserBuried && haveSchedBuried ? (unburyOpen = true) : unbury(UnburyMode.ALL)}>Unbury</Button>{/if}
          {#if description}<iframe title="Deck description" sandbox="" srcdoc={description} class="min-h-32 w-full border-0"></iframe>{/if}
        </section>
      {:else if !loadError}<p class="text-muted-foreground">Loading deck…</p>{/if}
    {:else}
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-lg font-semibold">Home</h1>
        <div class="flex items-center gap-2"><Button variant="ghost" size="sm" onclick={() => (editing = !editing)}>{editing ? "Done" : "Edit Widgets"}</Button></div>
      </div>
      {#if editing}
        <div class="flex flex-wrap items-center gap-4 rounded-xl border bg-muted/30 p-3 text-sm">
          <label class="flex items-center gap-2">Size <input aria-label="Widget size" type="range" min="70" max="150" step="5" bind:value={scale} onchange={() => savePreference("dashboard_scale", scale)} /> <span class="w-10 tabular-nums">{scale}%</span></label>
          <label class="flex items-center gap-2"><Checkbox checked={uniform} onCheckedChange={(value) => { uniform = value; savePreference("dashboard_uniform", value); }} />Same Look</label>
          {#if !heatmapVisible}<Button variant="outline" size="sm" onclick={() => { heatmapVisible = true; savePreference("heatmap_enabled", true); }}>Add Review Heatmap</Button>{/if}
        </div>
      {/if}
      <DashboardContext onedit={() => (editing = true)}>
      <div class="flex flex-col gap-5" style:zoom={scale / 100}>
        {#each order as widget, index (widget)}
          {#if widget === "decks" || heatmapVisible}
            <section class="relative rounded-xl border bg-card p-5" class:widget-editing={editing} class:widget-landing={landing === widget} class:shadow-sm={uniform}
              draggable={editing}
              ondragstart={(event) => { if (!editing) return; dragging = widget; event.dataTransfer?.setData("text/plain", widget); }}
              ondragover={(event) => { if (editing && dragging) { event.preventDefault(); landing = widget; } }}
              ondrop={(event) => { event.preventDefault(); dropWidget(widget); }}
              ondragend={() => { dragging = landing = ""; }} aria-label={widget === "decks" ? "Decks widget" : "Review Heatmap widget"}>
              <div class="mb-4 flex items-center justify-between gap-3">
                <h2 class="text-sm font-semibold">{widget === "decks" ? "Decks" : "Review Heatmap"}</h2>
                {#if editing}
                  <div class="flex gap-1">
                    <Button variant="ghost" size="icon-xs" disabled={index === 0} aria-label="Move {widget} up" onclick={() => moveWidget(widget, -1)}><IconArrowUp /></Button>
                    <Button variant="ghost" size="icon-xs" disabled={index === order.length - 1} aria-label="Move {widget} down" onclick={() => moveWidget(widget, 1)}><IconArrowDown /></Button>
                    {#if widget === "heatmap"}<Button variant="ghost" size="icon-xs" aria-label="Remove Review Heatmap" onclick={() => { heatmapVisible = false; savePreference("heatmap_enabled", false); }}><IconX /></Button>{/if}
                  </div>
                {/if}
              </div>
              {#if widget === "decks"}
                {#if root}
                  <Table.Root>
                    <Table.Header><Table.Row><Table.Head>Deck</Table.Head><Table.Head class="text-right">New</Table.Head><Table.Head class="text-right">Learn</Table.Head><Table.Head class="text-right">Due</Table.Head><Table.Head class="w-10"><span class="sr-only">Actions</span></Table.Head></Table.Row></Table.Header>
                    <Table.Body><DeckRows decks={root.children} {onaction} /></Table.Body>
                  </Table.Root>
                {:else if !loadError}<p class="text-sm text-muted-foreground">Loading decks…</p>{/if}
              {:else if historyError}<p role="alert" class="text-sm text-destructive">Could not load review history. {historyError}</p>
              {:else}<ReviewHeatmap data={history} />{/if}
            </section>
          {/if}
        {/each}
      </div>
      </DashboardContext>
    {/if}
  </main>
  <footer class="flex min-h-14 flex-wrap items-center gap-3 border-t px-4 py-2">
    <Button href="/settings" variant="ghost" size="icon" aria-label="Preferences"><IconSettings /></Button>
    <div class="mx-auto flex flex-wrap justify-center gap-1">
      {#if selected}
        <Button variant="ghost" onclick={() => selected?.kind.case === "filtered" ? openFiltered(selected.id) : (location.href = `/deck-options/${selected!.id}${nightHash()}`)}>Options</Button>
        {#if selected.kind.case === "filtered"}
          <Button variant="ghost" onclick={async () => { await rebuildFilteredDeck({ did: selected!.id }); await refresh(); }}>Rebuild</Button>
          <Button variant="ghost" onclick={async () => { await emptyFilteredDeck({ did: selected!.id }); await refresh(); }}>Empty</Button>
        {:else}<Button variant="ghost" onclick={() => (customOpen = true)}>Custom Study</Button>{/if}
      {:else}
        <Button variant="ghost" onclick={sharedDecks}>Get Shared</Button>
        <Button variant="ghost" onclick={() => askName()}>Create Deck</Button>
        <Button variant="ghost" onclick={importPackage}>Import File</Button>
        <Button variant="ghost" href="/transfer">Export</Button>
        <Button variant="ghost" onclick={() => openFiltered()}>Filtered Deck</Button>
      {/if}
    </div>
    <span class="w-8" aria-hidden="true"></span>
  </footer>
</div>

<Dialog.Root bind:open={unburyOpen}>
  <Dialog.Content>
    <Dialog.Header><Dialog.Title>Unbury cards</Dialog.Title><Dialog.Description>Choose which buried cards to restore.</Dialog.Description></Dialog.Header>
    <div class="flex flex-col gap-2">
      <Button variant="outline" disabled={busy} onclick={() => unbury(UnburyMode.USER_ONLY)}>Manually buried cards</Button>
      <Button variant="outline" disabled={busy} onclick={() => unbury(UnburyMode.SCHED_ONLY)}>Buried siblings</Button>
      <Button variant="outline" disabled={busy} onclick={() => unbury(UnburyMode.ALL)}>All buried cards</Button>
    </div>
    <Dialog.Footer><Dialog.Close>{#snippet child({ props })}<Button {...props} variant="ghost" disabled={busy}>Cancel</Button>{/snippet}</Dialog.Close></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={customOpen}>
  <Dialog.Content>
    <form onsubmit={runCustomStudy} class="flex flex-col gap-4">
      <Dialog.Header><Dialog.Title>Custom Study</Dialog.Title></Dialog.Header>
      <label class="flex flex-col gap-2 text-sm">Study option
        <select bind:value={customMode} class="rounded-lg border bg-background p-2">
          <option value="newLimitDelta">Increase today's new card limit</option>
          <option value="reviewLimitDelta">Increase today's review card limit</option>
          <option value="forgotDays">Review forgotten cards</option>
          <option value="reviewAheadDays">Review ahead</option>
          <option value="previewDays">Preview new cards</option>
        </select>
      </label>
      <Field.Field><Field.Label for="custom-amount">{["newLimitDelta", "reviewLimitDelta"].includes(customMode) ? "Additional cards" : "Days"}</Field.Label><Input id="custom-amount" type="number" min="1" max="99999" step="1" bind:value={customAmount} required /></Field.Field>
      <Dialog.Footer><Dialog.Close>{#snippet child({ props })}<Button {...props} variant="outline">Cancel</Button>{/snippet}</Dialog.Close><Button type="submit" disabled={busy}>Study</Button></Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<style>
  .widget-editing { outline: 1px dashed var(--border); outline-offset: 3px; animation: widget-shake 0.35s ease-in-out infinite alternate; }
  .widget-landing { outline: 2px dashed var(--ring); }
  @keyframes widget-shake { from { transform: rotate(-0.15deg); } to { transform: rotate(0.15deg); } }
  @media (prefers-reduced-motion: reduce) { .widget-editing { animation: none; } }
</style>

<Dialog.Root bind:open={nameOpen}>
  <Dialog.Content class="sm:max-w-sm">
    <form onsubmit={saveName} class="flex flex-col gap-4">
      <Dialog.Header>
        <Dialog.Title>{renaming ? "Rename Deck" : "Create Deck"}</Dialog.Title>
      </Dialog.Header>
      <Field.Group>
        <Field.Field>
          <Field.Label for="deck-name">Name</Field.Label>
          <Input id="deck-name" bind:value={name} required />
          <Field.Description>Use <code>::</code> to nest, e.g. <code>Biology::Cells</code>.</Field.Description>
        </Field.Field>
      </Field.Group>
      <Dialog.Footer>
        <Dialog.Close>
          {#snippet child({ props })}<Button {...props} variant="outline">Cancel</Button>{/snippet}
        </Dialog.Close>
        <Button type="submit" disabled={busy}>{renaming ? "Rename" : "Create"}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={filteredOpen}>
  <Dialog.Content class="sm:max-w-lg">
    {#if filtered}
      <form onsubmit={saveFiltered} class="flex flex-col gap-4">
        <Dialog.Header>
          <Dialog.Title>{filtered.id ? `Options for ${filteredName}` : "Filtered Deck"}</Dialog.Title>
        </Dialog.Header>
        <Field.Group>
          <Field.Field>
            <Field.Label for="filtered-name">Name</Field.Label>
            <Input id="filtered-name" bind:value={filteredName} required />
          </Field.Field>
          {#each terms as term, i (i)}
            {#if i === 0 || second}
              <Field.Set>
                <Field.Legend>{i === 0 ? "Filter" : "Filter 2"}</Field.Legend>
                <Field.Group>
                  <Field.Field>
                    <Field.Label for="search-{i}">Search</Field.Label>
                    <Input id="search-{i}" bind:value={term.search} />
                  </Field.Field>
                  <div class="flex gap-4">
                    <Field.Field>
                      <Field.Label for="limit-{i}">Limit to</Field.Label>
                      <Input id="limit-{i}" type="number" min="1" max="99999" bind:value={term.limit} required />
                    </Field.Field>
                    <Field.Field>
                      <Field.Label for="order-{i}">Cards selected by</Field.Label>
                      <Select.Root
                        type="single"
                        bind:value={() => String(term.order), (v) => (term.order = Number(v))}
                      >
                        <Select.Trigger id="order-{i}" class="w-full">{orderLabel(term.order)}</Select.Trigger>
                        <Select.Content>
                          <Select.Group>
                            {#each orders as [value, label] (value)}
                              <Select.Item value={String(value)} {label}>{label}</Select.Item>
                            {/each}
                          </Select.Group>
                        </Select.Content>
                      </Select.Root>
                    </Field.Field>
                  </div>
                </Field.Group>
              </Field.Set>
            {/if}
          {/each}
          <Field.Field orientation="horizontal">
            <Checkbox id="second-filter" bind:checked={second} />
            <Field.Label for="second-filter">Enable second filter</Field.Label>
          </Field.Field>
          <Field.Field orientation="horizontal">
            <Checkbox id="reschedule" bind:checked={reschedule} />
            <Field.Label for="reschedule">Reschedule cards based on my answers in this deck</Field.Label>
          </Field.Field>
        </Field.Group>
        <Dialog.Footer>
          <Dialog.Close>
            {#snippet child({ props })}<Button {...props} variant="outline">Cancel</Button>{/snippet}
          </Dialog.Close>
          <Button type="submit" disabled={busy}>{filtered.id ? "Rebuild" : "Build"}</Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
