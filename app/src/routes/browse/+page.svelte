<script lang="ts">
  // The browser (Anki's Qt aqt/browser, rebuilt): search, a Cards/Notes table backed
  // by the backend's browser rows, a sidebar, Anki's own editor for the selected row,
  // and a card preview. Everything goes through /_anki, nothing through the shell.
  import {
    allBrowserColumns,
    browserRowForId,
    buildSearchString,
    cardsOfNote,
    getCard,
    getConfigBool,
    searchCards,
    searchNotes,
    setActiveBrowserColumns,
    setConfigBool,
  } from "@generated/backend";
  import { postProto } from "@generated/post";
  import { Json } from "@generated/anki/generic_pb";
  import { ConfigKey_Bool } from "@generated/anki/config_pb";
  import { getJson, setJson } from "$lib/config";
  import {
    BrowserColumns_Sorting as Sorting,
    BrowserRow_Color as Color,
    BrowserColumns_Column,
    type BrowserRow,
    SearchNode,
  } from "@generated/anki/search_pb";
  import type { PlainMessage } from "@bufbuild/protobuf";
  import type { RenderCardResponse } from "@generated/klaus_pb";
  import { onMount } from "svelte";
  import { cardBodyClass, cardFrameSrc, night, openCardLink, postToCard, renderCard } from "$lib/card";
  import { noteEditor, type NoteEditor } from "$lib/editor/note-editor";
  import { highlightEditor, searchTerms } from "$lib/browse/highlight";
  import { IconLayoutSidebar, IconLayoutSidebarRight, IconSettings } from "@tabler/icons-svelte";
  import { keyIsTaken } from "$lib/keys";
  import Sidebar from "./Sidebar.svelte";
  import BulkActions from "./BulkActions.svelte";
  import { selectRows } from "$lib/browse/selection";
  import { IconColumns3 as Columns3Icon } from "@tabler/icons-svelte";
  import { IconEye as EyeIcon } from "@tabler/icons-svelte";
  import { Button } from "$lib/components/ui/button";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Input } from "$lib/components/ui/input";
  import * as Table from "$lib/components/ui/table";
  import * as ToggleGroup from "$lib/components/ui/toggle-group";

  const ROW_HEIGHT = 28;
  const RETENTION = "klaus_retention";
  const retentionColumn = new BrowserColumns_Column({
    key: RETENTION, cardsModeLabel: "Retention", notesModeLabel: "Retention",
    sortingCards: Sorting.NONE, sortingNotes: Sorting.NONE,
    cardsModeTooltip: "Estimated chance of recalling this card now. New cards show no score. Cannot be sorted.",
    notesModeTooltip: "Lowest retention among this note's studied cards. Cannot be sorted.",
  });
  // anki/browser.py BrowserConfig / BrowserDefaults
  const config = (notes: boolean) =>
    notes
      ? { cols: "activeNoteCols", sort: "noteSortType", back: "browserNoteSortBackwards", defaults: ["noteFld", "note", "template", "noteTags"] }
      : { cols: "activeCols", sort: "sortType", back: "sortBackwards", defaults: ["noteFld", "template", "cardDue", "deck"] };

  let columns: BrowserColumns_Column[] = $state([]);
  let active: string[] = $state([]);
  let notesMode = $state(false);
  let sortColumn = $state("noteFld");
  let sortBackwards = $state(false);
  let search = $state("deck:current");
  let appliedSearch = $state("");
  let searching = $state(false);
  let sidebarVisible = $state(true);
  let editorVisible = $state(true);
  let highlights = $state(true);
  let stopHighlighting = () => {};
  let editorLoaded = $state(false);

  async function togglePane(pane: "sidebar" | "editor") {
    if (pane === "sidebar") sidebarVisible = !sidebarVisible;
    else editorVisible = !editorVisible;
    await setJson("klausBrowsePanes", { sidebar: sidebarVisible, editor: editorVisible });
  }

  $effect(() => {
    // Read reactive inputs here, including when no editor has mounted yet.
    const terms = highlights ? searchTerms(appliedSearch) : [];
    if (!editorLoaded) return;
    stopHighlighting();
    stopHighlighting = highlightEditor(editorFrame, () => terms);
  });
  let ids: bigint[] = $state.raw([]);
  let selected: bigint | undefined = $state();
  let selection = $state.raw(new Set<bigint>());
  let anchor: bigint | undefined;
  let bulkBusy = $state(false);
  let bulk: { history: (direction?: "undo" | "redo") => Promise<void>; refreshUndo: () => Promise<unknown>; showFailure: (message: string, error: unknown) => void };
  let sidebar: { refresh: () => Promise<void> };

  async function saveEditor() {
    if (!editor) throw new Error("Note editor is unavailable");
    await editor.settle();
  }
  async function afterBulkAction() {
    await runSearch();
    await select(selected, true, true);
    await sidebar.refresh();
  }
  function chooseRow(id: bigint, range = false, additive = false) {
    if (bulkBusy || switching) return;
    selection = selectRows(ids, selection, id, anchor, range, additive);
    if (!range) anchor = id;
    void select(id, true);
  }
  function selectAll() {
    if (bulkBusy) return;
    selection = selection.size === ids.length ? new Set() : new Set(ids);
  }

  // Rows are fetched only for what's on screen, as Anki's table model does.
  let rows = new Map<bigint, BrowserRow>();
  let fetching = new Set<bigint>();
  let retention = new Map<bigint, number | null>();
  let retentionFetching = new Set<bigint>();
  let retentionFailed = new Set<bigint>();
  let retentionError = $state(false);
  const backendColumns = $derived(active.filter((key) => key !== RETENTION));
  let rowsVersion = $state(0);
  let scrollTop = $state(0);
  let viewHeight = $state(600);
  let tableBox: HTMLDivElement;
  // Clamped: a scroll offset from a longer, earlier result set must not leave the window past the end.
  const first = $derived(Math.max(0, Math.min(ids.length, Math.floor(scrollTop / ROW_HEIGHT) - 10)));
  const last = $derived(Math.min(ids.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + 10));
  const visible = $derived(ids.slice(first, last));

  async function loadMode() {
    notesMode = (await getConfigBool({ key: ConfigKey_Bool.BROWSER_TABLE_SHOW_NOTES_MODE })).val;
    const keys = config(notesMode);
    active = await getJson(keys.cols, keys.defaults);
    sortColumn = await getJson(keys.sort, "noteFld");
    sortBackwards = await getJson(keys.back, false);
    await setActiveBrowserColumns({ vals: active.filter((key) => key !== RETENTION) });
    clearRows();
  }

  function clearRows(resetRetention = true) {
    rows = new Map();
    fetching = new Set();
    if (resetRetention) {
      retention = new Map();
      retentionFetching = new Set();
      retentionFailed = new Set();
      retentionError = false;
    }
    rowsVersion++;
  }

  function sortingOf(column: BrowserColumns_Column | undefined): Sorting {
    if (!column) return Sorting.NONE;
    return notesMode ? column.sortingNotes : column.sortingCards;
  }

  // Only the latest search may apply its results: an earlier one (other query, sort
  // or mode) can finish last, and its ids could be cards where notes are expected.
  let searchSeq = 0;

  async function runSearch(text = search) {
    const seq = ++searchSeq;
    searching = true;
    try {
      // Normalised the way Anki shows it, and validated before searching.
      const normalized = (await buildSearchString({ filter: { case: "parsableText", value: text } })).val;
      if (seq !== searchSeq) return;
      search = normalized;
      const column = columns.find((c) => c.key === sortColumn);
      const order =
        sortingOf(column) === Sorting.NONE
          ? { value: { case: "none" as const, value: {} } }
          : { value: { case: "builtin" as const, value: { column: sortColumn, reverse: sortBackwards } } };
      const found = await (notesMode ? searchNotes : searchCards)({ search: normalized, order });
      if (seq !== searchSeq) return;
      appliedSearch = normalized;
      ids = found.ids;
      selection = new Set([...selection].filter((id) => ids.includes(id)));
      clearRows();
      if (selected === undefined || !ids.includes(selected)) await select(ids[0]);
      scrollToSelected(true);
    } catch {
      // Invalid search: the bridge's error was shown.
    } finally {
      if (seq === searchSeq) searching = false;
    }
  }

  $effect(() => {
    void rowsVersion;
    for (const id of visible) {
      if (rows.has(id) || fetching.has(id)) continue;
      fetching.add(id);
      const batch = rows;
      browserRowForId({ val: id }, { alertOnError: false })
        .then((row) => {
          if (batch !== rows) return; // columns or search changed meanwhile
          rows.set(id, row);
          rowsVersion++;
        })
        // Fetched again the next time it scrolls into view.
        .catch(() => fetching.delete(id));
    }
  });


  $effect(() => {
    void rowsVersion;
    if (!active.includes(RETENTION)) return;
    const visibleIds = new Set(visible);
    for (const id of retentionFailed) if (!visibleIds.has(id)) retentionFailed.delete(id);
    const pending = visible.filter((id) => !retention.has(id) && !retentionFetching.has(id) && !retentionFailed.has(id)).slice(0, 500);
    if (!pending.length) return;
    const batch = retention;
    for (const id of pending) retentionFetching.add(id);
    void postProto("klausBrowserRetention", new Json({ json: new TextEncoder().encode(JSON.stringify({ ids: pending.map(String), notesMode })) }), Json, { alertOnError: false })
      .then((response) => {
        if (batch !== retention) return;
        const values = JSON.parse(new TextDecoder().decode(response.json)) as Record<string, number | null>;
        for (const id of pending) retention.set(id, values[String(id)] ?? null);
        rowsVersion++;
      }).catch(() => {
        if (batch !== retention) return;
        for (const id of pending) if (visible.includes(id)) retentionFailed.add(id);
        retentionError = true;
      })
      .finally(() => { if (batch === retention) for (const id of pending) retentionFetching.delete(id); });
  });

  function retentionText(id: bigint): string {
    void rowsVersion;
    if (!retention.has(id)) return retentionError ? "Unavailable" : "…";
    const value = retention.get(id);
    return value == null ? "No score" : `${Math.round(value * 100)}%`;
  }

  function rowFor(id: bigint): BrowserRow | undefined {
    void rowsVersion;
    return rows.get(id);
  }

  function columnLabel(column: BrowserColumns_Column) {
    return notesMode ? column.notesModeLabel : column.cardsModeLabel;
  }

  async function sortBy(column: BrowserColumns_Column) {
    const sorting = sortingOf(column);
    if (sorting === Sorting.NONE) return;
    if (column.key === sortColumn) sortBackwards = !sortBackwards;
    else [sortColumn, sortBackwards] = [column.key, sorting === Sorting.DESCENDING];
    const keys = config(notesMode);
    await Promise.all([setJson(keys.sort, sortColumn), setJson(keys.back, sortBackwards)]);
    await runSearch();
  }

  async function toggleColumn(key: string) {
    const columns = active.includes(key) ? active.filter((k) => k !== key) : [...active, key];
    await setJson(config(notesMode).cols, columns);
    await setActiveBrowserColumns({ vals: columns.filter((key) => key !== RETENTION) });
    active = columns;
    clearRows();
  }

  // A second click while switching would run the sequence again on the new mode.
  let switching = $state(false);
  async function toggleMode() {
    if (switching || bulkBusy) return;
    switching = true;
    searchSeq++; searching = false;
    try {
      await saveEditor();
      const was = displayed;
      const converted = was === undefined ? undefined : !notesMode
        ? (await getCard({ cid: was })).noteId : (await cardsOfNote({ nid: was })).cids[0];
      await setConfigBool({ key: ConfigKey_Bool.BROWSER_TABLE_SHOW_NOTES_MODE, value: !notesMode, undoable: false });
      await loadMode();
      selected = displayed = converted;
      selection = displayedSelection = new Set(converted === undefined ? [] : [converted]);
      anchor = displayedAnchor = converted;
      await runSearch();
    } catch (error) {
      bulk.showFailure("Could not change the browser mode", error);
    } finally {
      switching = false;
    }
  }

  // Side editor: Anki's editor page in browser mode, loaded with the selected note
  // the way aqt/editor.py's load_note does. It saves through updateNotes itself.
  let editorFrame: HTMLIFrameElement;
  let editor: NoteEditor | undefined;
  let editorBusy = $state(false);
  let displayed: bigint | undefined;
  let displayedSelection = new Set<bigint>();
  let displayedAnchor: bigint | undefined;
  const requestedRows = new Map<bigint, { seq: number; id: bigint; selection: Set<bigint>; anchor: bigint | undefined }>();
  function editorShown(nid: bigint) {
    const row = requestedRows.get(nid);
    if (row) { displayed = row.id; displayedSelection = row.selection; displayedAnchor = row.anchor; }
  }
  const editorSrc = `/editor/?mode=browser${night ? "#night" : ""}`;

  async function noteIdOf(id: bigint): Promise<bigint> {
    return notesMode ? id : (await getCard({ cid: id })).noteId;
  }
  async function cardIdOf(id: bigint): Promise<bigint> {
    return notesMode ? (await cardsOfNote({ nid: id })).cids[0] : id;
  }

  let selectionSeq = 0;
  async function select(id: bigint | undefined, keepSelection = false, propagateError = false) {
    const seq = ++selectionSeq;
    if (id === undefined) {
      try {
        await saveEditor();
        if (seq !== selectionSeq) return;
        selected = displayed = undefined;
        selection = displayedSelection = new Set();
        anchor = displayedAnchor = undefined;
      } catch (error) {
        if (seq !== selectionSeq) return;
        selected = displayed; selection = displayedSelection; anchor = displayedAnchor;
        if (propagateError) throw error;
        bulk.showFailure("Could not change the selected note", error);
      }
      return;
    }
    selected = id;
    if (!keepSelection) { selection = new Set([id]); anchor = id; }
    const requestedSelection = selection, requestedAnchor = anchor;
    const target = noteIdOf(id).then(nid => {
      if ((requestedRows.get(nid)?.seq ?? -1) < seq) requestedRows.set(nid, { seq, id, selection: requestedSelection, anchor: requestedAnchor });
      return nid;
    });
    try {
      if (!editor) throw new Error("Note editor is unavailable");
      const shown = await editor.show(target);
      if (!shown || seq !== selectionSeq) return;
      if (previewOpen) await showPreview();
    } catch (error) {
      // A failed save keeps the current editor and its unsaved content available.
      if (seq !== selectionSeq) return;
      selected = displayed; selection = displayedSelection; anchor = displayedAnchor;
      if (propagateError) throw error;
      bulk.showFailure("Could not change the selected note", error);
    } finally {
      void target.then(nid => { if (requestedRows.get(nid)?.seq === seq) requestedRows.delete(nid); }).catch(() => {});
    }
  }

  function move(delta: number, range = false) {
    if (bulkBusy) return;
    if (!ids.length) return;
    const index = selected === undefined ? -1 : ids.indexOf(selected);
    const next = Math.min(ids.length - 1, Math.max(0, index + delta));
    chooseRow(ids[next], range);
    scrollToSelected(false);
  }

  /** Keeps the selected row in view; after a new search, otherwise starts at the top. */
  function scrollToSelected(newResults: boolean) {
    const index = selected === undefined ? -1 : ids.indexOf(selected);
    if (index < 0) {
      if (newResults) tableBox.scrollTop = scrollTop = 0;
      return;
    }
    const top = index * ROW_HEIGHT;
    // The header row sits above the first data row.
    if (top < tableBox.scrollTop) tableBox.scrollTop = top;
    else if (top + 2 * ROW_HEIGHT > tableBox.scrollTop + viewHeight) tableBox.scrollTop = top + 2 * ROW_HEIGHT - viewHeight;
    scrollTop = tableBox.scrollTop;
  }

  function onTableKey(event: KeyboardEvent) {
    if (keyIsTaken(event) || bulkBusy) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") selection = new Set(ids);
    else if (event.key === "ArrowDown") move(1, event.shiftKey);
    else if (event.key === "ArrowUp") move(-1, event.shiftKey);
    else return;
    event.preventDefault();
  }

  // Preview (Anki's previewer): the selected card in the sandboxed card frame.
  // The dialog mounts the frame on open, so each opening waits for its load.
  let previewFrame: HTMLIFrameElement | undefined = $state();
  let previewReady: Promise<void> = Promise.resolve();
  let previewLoaded = () => {};
  let previewOpen = $state(false);
  let previewSide: "question" | "answer" = $state("question");
  let preview: { rendered: RenderCardResponse; bodyClass: string } | undefined;

  async function showPreview() {
    const id = selected;
    if (id === undefined) return;
    const cid = await cardIdOf(id);
    const [card, rendered] = await Promise.all([getCard({ cid }), renderCard(cid)]);
    // Previous/Next may have moved on while this rendered.
    if (id !== selected || !previewOpen) return;
    preview = { rendered, bodyClass: cardBodyClass(card.templateIdx) };
    previewSide = "question";
    await previewReady;
    postToCard(previewFrame, { show: "question", html: rendered.question, answer: rendered.answer, bodyClass: preview.bodyClass });
  }
  function flipPreview() {
    if (!preview) return;
    previewSide = previewSide === "question" ? "answer" : "question";
    const html = previewSide === "question" ? preview.rendered.question : preview.rendered.answer;
    postToCard(previewFrame, { show: previewSide, html, bodyClass: preview.bodyClass });
  }
  function openPreview() {
    if (selected === undefined) return;
    if (!previewOpen) previewReady = new Promise((resolve) => (previewLoaded = resolve));
    previewOpen = true;
    showPreview();
  }

  // Anki's row colours, as theme tokens (src/app.css).
  const colorClass: Partial<Record<Color, string>> = {
    [Color.MARKED]: "bg-row-marked",
    [Color.SUSPENDED]: "bg-row-suspended",
    [Color.BURIED]: "bg-row-buried",
    [Color.FLAG_RED]: "bg-row-flag-red",
    [Color.FLAG_ORANGE]: "bg-row-flag-orange",
    [Color.FLAG_GREEN]: "bg-row-flag-green",
    [Color.FLAG_BLUE]: "bg-row-flag-blue",
    [Color.FLAG_PINK]: "bg-row-flag-pink",
    [Color.FLAG_TURQUOISE]: "bg-row-flag-turquoise",
    [Color.FLAG_PURPLE]: "bg-row-flag-purple",
  };

  /** Back to the decks, saving the editor's pending edits first (its save is debounced). */
  async function leave() {
    if (bulkBusy) return;
    try { await saveEditor(); location.href = "/"; }
    catch (error) { bulk.showFailure("Could not save the editor", error); }
  }

  async function sidebarSearch(node: PlainMessage<SearchNode>) {
    if (bulkBusy || switching) return;
    const text = (await buildSearchString(node)).val;
    await runSearch(text);
  }

  onMount(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin === "null" && event.source === previewFrame?.contentWindow && event.data?.klaus === true) {
        const { key, cmd, openLink } = event.data;
        if (key === " " || key === "Enter" || cmd === "ans") flipPreview();
        if (typeof openLink === "string") openCardLink(openLink);
      }
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (keyIsTaken(event)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        openPreview();
      } else if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void bulk.history(event.shiftKey ? "redo" : "undo");
      } else if (event.key === "Escape") {
        leave();
      }
    };
    const onHistory = (event: Event) => {
      const direction = (event as CustomEvent).detail;
      if (direction === "undo" || direction === "redo") void bulk.history(direction);
    };
    addEventListener("klaus-collection-history", onHistory);
    addEventListener("message", onMessage);
    addEventListener("keydown", onKeydown);
    (async () => {
      search = new URLSearchParams(location.search).get("query") ?? search;
      const panes = await getJson("klausBrowsePanes", { sidebar: true, editor: true });
      sidebarVisible = panes.sidebar !== false;
      editorVisible = panes.editor !== false;
      highlights = await getJson("klausBrowseHighlights", true);
      columns = [...(await allBrowserColumns({})).columns, retentionColumn];
      await loadMode();
      await runSearch();
    })();
    return () => {
      stopHighlighting();
      removeEventListener("klaus-collection-history", onHistory);
      removeEventListener("message", onMessage);
      removeEventListener("keydown", onKeydown);
    };
  });
</script>

<div class="browse-workspace grid h-screen grid-rows-[auto_auto_minmax(0,1fr)_auto]" style:grid-template-columns={`${sidebarVisible ? "var(--browse-sidebar)" : "0px"} minmax(0,1fr) ${editorVisible ? "var(--browse-editor)" : "0px"}`}>
  <nav class="col-span-full flex items-center gap-1 border-b bg-muted/30 px-3 py-2" aria-label="Browse workspace">
    <img src="/klaus-logo.svg" alt="KlausNote" class="mr-2 size-6" />
    <Button variant="ghost" size="icon-sm" aria-label={sidebarVisible ? "Hide Sidebar" : "Show Sidebar"} aria-pressed={sidebarVisible} onclick={() => togglePane("sidebar")}><IconLayoutSidebar /></Button>
    <Button variant="ghost" size="icon-sm" aria-label={editorVisible ? "Hide Card Editor" : "Show Card Editor"} aria-pressed={editorVisible} onclick={() => togglePane("editor")}><IconLayoutSidebarRight /></Button>
    <div class="mx-2 h-4 border-l"></div>
    <Button href="/" variant="ghost" size="sm" onclick={(event: MouseEvent) => { event.preventDefault(); leave(); }}>Decks</Button>
    <Button variant="secondary" size="sm" aria-current="page">Browse</Button>
  </nav>
  <header class="col-span-full flex items-center gap-2 border-b px-3 py-2">
    <form
      class="flex flex-1"
      onsubmit={(e) => {
        e.preventDefault();
        if (!bulkBusy && !switching) runSearch();
      }}
    >
      <Input type="search" bind:value={search} aria-label="Search" spellcheck="false" />
    </form>
    <ToggleGroup.Root
      type="single"
      variant="outline"
      size="sm"
      bind:value={() => notesMode ? "notes" : "cards", (value) => {
        if (value && (value === "notes") !== notesMode) void toggleMode();
      }}
      disabled={switching || bulkBusy}
      aria-label="Show cards or notes"
    >
      <ToggleGroup.Item value="cards">Cards</ToggleGroup.Item>
      <ToggleGroup.Item value="notes">Notes</ToggleGroup.Item>
    </ToggleGroup.Root>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="outline" size="sm">
            <Columns3Icon data-icon="inline-start" />
            Columns
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="max-h-[60vh] overflow-y-auto">
        <DropdownMenu.Group>
          {#each columns as column (column.key)}
            <DropdownMenu.CheckboxItem
              checked={active.includes(column.key)}
              disabled={active.length === 1 && active.includes(column.key)}
              onCheckedChange={() => toggleColumn(column.key)}
              closeOnSelect={false}
            >
              {columnLabel(column)}
            </DropdownMenu.CheckboxItem>
          {/each}
        </DropdownMenu.Group>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    <Button variant="outline" size="sm" onclick={openPreview} disabled={selected === undefined} title="Preview (Ctrl+Shift+P)">
      <EyeIcon data-icon="inline-start" />
      Preview
    </Button>
    <BulkActions bind:this={bulk} ids={[...selection]} {notesMode} beforeaction={saveEditor} oncomplete={afterBulkAction} onsearch={runSearch} onbusychange={(busy) => (bulkBusy = busy)} />
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}<Button {...props} variant="ghost" size="sm">View</Button>{/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.CheckboxItem checked={highlights} onCheckedChange={(value) => { highlights = value; void setJson("klausBrowseHighlights", value); }}>Highlight search results</DropdownMenu.CheckboxItem>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </header>

  <div class="min-h-0 overflow-hidden" hidden={!sidebarVisible} style:grid-column="1" style:grid-row="3">
    <Sidebar bind:this={sidebar} onsearch={sidebarSearch} current={search} />
  </div>

  <div
    class="min-w-0 overflow-auto"
    style:grid-column="2" style:grid-row="3"
    aria-busy={searching}
    bind:this={tableBox}
    bind:clientHeight={viewHeight}
    onscroll={() => (scrollTop = tableBox.scrollTop)}
  >
    <!-- A plain table: Table.Root's own scroll box would unstick the header. Only the
         visible rows exist, so each carries its absolute aria-rowindex (the header is
         row 1) and the grid states the full count. -->
    <table
      role="grid"
      tabindex="0"
      aria-label="Search results"
      aria-rowcount={ids.length + 1}
      aria-multiselectable="true"
      onkeydown={onTableKey}
      class="w-full table-fixed caption-bottom text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <Table.Header class="sticky top-0 bg-background">
        <Table.Row aria-rowindex={1}>
          <Table.Head class="w-9 px-2"><input type="checkbox" aria-label="Select all results" checked={ids.length > 0 && selection.size === ids.length} disabled={bulkBusy || !ids.length} onchange={selectAll} /></Table.Head>
          {#each active as key (key)}
            {@const column = columns.find((c) => c.key === key)}
            <Table.Head
              title={column ? (notesMode ? column.notesModeTooltip : column.cardsModeTooltip) : key}
              aria-sort={key === sortColumn ? (sortBackwards ? "descending" : "ascending") : "none"}
              class="p-0"
            >
              <Button
                variant="ghost"
                size="sm"
                class="w-full justify-start rounded-none"
                onclick={() => column && sortBy(column)}
                disabled={sortingOf(column) === Sorting.NONE}
              >
                <span class="truncate">{column ? columnLabel(column) : key}</span>
                {#if key === sortColumn}<span aria-hidden="true">{sortBackwards ? "▼" : "▲"}</span>{/if}
              </Button>
            </Table.Head>
          {/each}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        <tr style:height="{first * ROW_HEIGHT}px" aria-hidden="true"></tr>
        {#each visible as id, i (id)}
          {@const row = rowFor(id)}
          <Table.Row
            aria-rowindex={first + i + 2}
            class={["h-7 cursor-default", !selection.has(id) && row && colorClass[row.color]]}
            data-state={selection.has(id) ? "selected" : undefined}
            aria-selected={selection.has(id)}
            onclick={(event: MouseEvent) => chooseRow(id, event.shiftKey, event.metaKey || event.ctrlKey)}
          >
            <Table.Cell class="w-9 px-2 py-0"><input type="checkbox" aria-label={`Select row ${first + i + 1}`} checked={selection.has(id)} disabled={bulkBusy} onclick={(event) => { event.stopPropagation(); chooseRow(id, event.shiftKey, true); }} /></Table.Cell>
            {#each active as key (key)}
              {@const cell = row?.cells[backendColumns.indexOf(key)]}
              <Table.Cell class="truncate py-0" dir={cell?.isRtl ? "rtl" : undefined} title={key === RETENTION ? retentionText(id) : cell?.text}>
                {key === RETENTION ? retentionText(id) : (cell?.text ?? "")}
              </Table.Cell>
            {/each}
          </Table.Row>
        {/each}
        <tr style:height="{(ids.length - last) * ROW_HEIGHT}px" aria-hidden="true"></tr>
      </Table.Body>
    </table>
  </div>

  <iframe use:noteEditor={{ mode: "existing", attach: value => editor = value,
      onready: () => editorLoaded = true, onbusy: value => editorBusy = value,
      onpreview: openPreview, onshown: editorShown, onupdated: () => { clearRows(false); void bulk?.refreshUndo().catch(() => {}); } }} inert={bulkBusy || editorBusy} class="size-full min-w-0 border-0 border-l" hidden={!editorVisible || selected === undefined} style:grid-column="3" style:grid-row="3" bind:this={editorFrame} src={editorSrc} title="Editor"></iframe>
  {#if editorVisible && selected === undefined}<div class="flex items-center justify-center border-l text-sm text-muted-foreground" style:grid-column="3" style:grid-row="3">Select a card or note to edit.</div>{/if}
  <footer class="col-span-full flex h-8 items-center gap-3 border-t bg-muted/30 px-3 text-xs text-muted-foreground">
    <Button href="/settings" variant="ghost" size="icon-xs" aria-label="Preferences" onclick={async (event: MouseEvent) => { event.preventDefault(); if (bulkBusy) return; try { await saveEditor(); location.href = "/settings"; } catch (error) { bulk.showFailure("Could not save the editor", error); } }}><IconSettings /></Button>
    <span role="status">{searching ? "Searching…" : `${ids.length.toLocaleString()} ${notesMode ? "notes" : "cards"}`}</span>
    <span class="ml-auto">{bulkBusy ? "Working…" : `${selection.size.toLocaleString()} selected`}</span>
  </footer>
</div>

<Dialog.Root
  bind:open={previewOpen}
  onOpenChange={(open) => {
    if (!open) preview = undefined;
  }}
>
  <Dialog.Content class="flex h-[min(40rem,85vh)] flex-col sm:max-w-3xl">
    <Dialog.Header>
      <Dialog.Title>Preview</Dialog.Title>
    </Dialog.Header>
    <iframe
      bind:this={previewFrame}
      src={cardFrameSrc}
      sandbox="allow-scripts"
      title="Card preview"
      class="w-full flex-1 rounded-md border"
      onload={() => previewLoaded()}
    ></iframe>
    <Dialog.Footer class="sm:justify-center">
      <Button variant="outline" onclick={() => move(-1)}>Back</Button>
      <Button onclick={flipPreview}>{previewSide === "question" ? "Show Answer" : "Show Question"}</Button>
      <Button variant="outline" onclick={() => move(1)}>Next</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .browse-workspace { --browse-sidebar: 14rem; --browse-editor: clamp(20rem, 32vw, 28rem); }
  @media (max-width: 850px) {
    .browse-workspace { --browse-sidebar: 10rem; --browse-editor: 19rem; }
  }
</style>
