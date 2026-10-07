<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { IconFolder, IconFolderPlus, IconFileTypePdf, IconChevronRight, IconChevronDown, IconUpload, IconRefresh, IconLayoutSidebar, IconBook, IconCards } from '@tabler/icons-svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Field from '$lib/components/ui/field';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import { toast } from 'svelte-sonner';
  import { getJson, setJson } from '$lib/config';
  import { nightHash } from '$lib/theme';
  import { cn } from '$lib/utils';
  import { listFolder, createFolder, importPdf, type LibraryEntry } from '$lib/library/storage';
  import { noteEditor, type NoteEditor } from '$lib/editor/note-editor';
  import PdfReader from '$lib/library/PdfReader.svelte';
  import StudyChrome from '../StudyChrome.svelte';

  type Workspace = { selected: string; pages: Record<string, number>; expanded: string[]; panes: string[]; widths: number[] };
  const defaults: Workspace = { selected: '', pages: {}, expanded: [], panes: ['files', 'reader', 'card'], widths: [24, 46, 30] };
  let selected = $state(''), pages = $state<Record<string, number>>({}), expanded = $state<string[]>([]), panes = $state(['files', 'reader', 'card']), widths = $state([24, 46, 30]);
  let mobilePane = $state('files'), folder = $state(''), rootLabel = $state('Library'), entries = $state<Record<string, LibraryEntry[]>>({});
  let loading = $state(false), busy = $state(false), error = $state(''), filter = $state(''), initialized = $state(false);
  let newFolderOpen = $state(false), newFolderName = $state(''), folderError = $state(''), editorSrc = $state('');
  let fileInput: HTMLInputElement, workspace: HTMLDivElement;
  let editor: NoteEditor | undefined;
  let editorBusy = $state(false);
  let saveTimer: ReturnType<typeof setTimeout>;
  let narrow = $state(false), resizing = $state(false);
  const title = $derived(selected.split('/').at(-1) || 'PDF reader');
  const readerActive = $derived(narrow ? mobilePane === 'reader' : panes.includes('reader'));
  const grid = $derived(['files', 'reader', 'card'].map((name, i) => panes.includes(name) ? `${widths[i]}fr` : '0fr').join(' '));
  onMount(() => {
    let alive = true;
    editorSrc = `/editor/?mode=add${nightHash()}`;
    const media = matchMedia('(max-width: 899px)');
    const resize = () => narrow = media.matches; resize(); media.addEventListener('change', resize);
    (async () => {
      try {
        const saved = await getJson<Workspace>('klausLibraryWorkspace', defaults);
        if (!alive) return;
        selected = typeof saved.selected === 'string' ? saved.selected : '';
        pages = saved.pages && typeof saved.pages === 'object' ? saved.pages : {};
        expanded = Array.isArray(saved.expanded) ? saved.expanded.filter(p => typeof p === 'string') : [];
        const visible = Array.isArray(saved.panes) ? saved.panes.filter(p => ['files', 'reader', 'card'].includes(p)) : defaults.panes;
        panes = visible.length ? visible : defaults.panes;
        if (saved.widths?.length === 3 && saved.widths.every(n => Number.isFinite(n) && n >= 10)) widths = saved.widths;
        if (selected) mobilePane = 'reader';
      } catch (e) { toast.error(`Could not restore Library layout: ${String(e)}`); }
      if (!alive) return;
      initialized = true; await refresh();
    })();
    return () => { alive = false; media.removeEventListener('change', resize); clearTimeout(saveTimer); };
  });
  $effect(() => {
    const state: Workspace = { selected, pages, expanded, panes, widths };
    if (!initialized) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void setJson('klausLibraryWorkspace', state).catch(e => toast.error(`Could not save Library layout: ${String(e)}`)); }, 200);
  });
  async function loadFolder(path: string) {
    const listing = await listFolder(path);
    rootLabel = listing.rootLabel; entries = { ...entries, [path]: listing.entries };
  }
  async function refresh() {
    loading = true; error = '';
    try {
      await loadFolder('');
      for (const path of expanded) {
        try { await loadFolder(path); } catch { expanded = expanded.filter(p => p !== path); const next = { ...entries }; delete next[path]; entries = next; }
      }
    } catch (e) { error = String(e); }
    finally { loading = false; }
  }
  async function choose(entry: LibraryEntry) {
    if (entry.kind === 'pdf') { selected = entry.path; mobilePane = 'reader'; if (!panes.includes('reader')) panes = [...panes, 'reader']; return; }
    folder = entry.path;
    if (expanded.includes(entry.path)) expanded = expanded.filter(p => p !== entry.path);
    else {
      try { await loadFolder(entry.path); expanded = [...expanded, entry.path]; }
      catch (e) { toast.error(`Could not open folder: ${String(e)}`); }
    }
  }
  async function importFiles(event: Event) {
    const input = event.currentTarget as HTMLInputElement, files = Array.from(input.files || []);
    input.value = ''; if (!files.length) return;
    busy = true;
    let imported = 0;
    try {
      for (const file of files) {
        const result = await importPdf(folder, file); imported++; selected = result.path;
      }
      await loadFolder(folder);
      if (folder && !expanded.includes(folder)) expanded = [...expanded, folder];
      mobilePane = 'reader'; if (!panes.includes('reader')) panes = [...panes, 'reader'];
      toast.success(`Imported ${imported} PDF${imported === 1 ? '' : 's'}`);
    } catch (e) {
      await loadFolder(folder).catch(() => {});
      toast.error(`${imported ? `${imported} imported. ` : ''}${String(e)}`);
    } finally { busy = false; }
  }
  async function addFolder(event: SubmitEvent) {
    event.preventDefault(); busy = true; folderError = '';
    try {
      await createFolder(folder, newFolderName.trim()); await loadFolder(folder);
      if (folder && !expanded.includes(folder)) expanded = [...expanded, folder];
      newFolderOpen = false; newFolderName = '';
    } catch (e) { folderError = String(e); }
    finally { busy = false; }
  }
  async function canLeave(): Promise<boolean> {
    try {
      if (!editor) throw new Error('Note editor is unavailable');
      return await editor.settle();
    } catch (e) { toast.error(`Could not check the card draft: ${String(e)}`); return false; }
  }
  async function insertText(text: string) {
    mobilePane = 'card'; if (!panes.includes('card')) panes = [...panes, 'card'];
    await tick();
    try {
      if (!editor) throw new Error('Note editor is unavailable');
      await editor.insert(text);
    } catch (e) { toast.error(`Could not insert the selected text: ${String(e)}`); }
  }
  function resizePanes(index: number, event: PointerEvent) {
    if (narrow || panes.length !== 3) return;
    const start = event.clientX, original = [...widths], width = workspace.clientWidth;
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId); resizing = true;
    const move = (e: PointerEvent) => {
      const total = original.reduce((a, b) => a + b, 0), delta = (e.clientX - start) / width * total;
      const next = [...original], pair = original[index] + original[index + 1];
      next[index] = Math.max(15, Math.min(pair - 15, original[index] + delta)); next[index + 1] = pair - next[index]; widths = next;
    };
    const done = () => { resizing = false; handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', done); handle.removeEventListener('pointercancel', done); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', done); handle.addEventListener('pointercancel', done);
  }
  function resizeKey(index: number, event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); const delta = event.key === 'ArrowLeft' ? -2 : 2, next = [...widths];
    if (next[index] + delta < 15 || next[index + 1] - delta < 15) return;
    next[index] += delta; next[index + 1] -= delta; widths = next;
  }
  function shown(name: string) { return narrow ? mobilePane === name : panes.includes(name); }
</script>

<svelte:head><title>Library · KlausNote</title></svelte:head>
<div class="flex h-dvh min-h-0 flex-col overflow-hidden">
  <h1 class="sr-only">Library</h1>
  <StudyChrome beforeleave={canLeave}>
    {#snippet tools()}
    {#if narrow}
      <ToggleGroup.Root type="single" value={mobilePane} onValueChange={value => { if (value) mobilePane = value; }} size="sm" aria-label="Workspace pane">
        <ToggleGroup.Item value="files" aria-label="Files"><IconLayoutSidebar data-icon="inline-start" />Files</ToggleGroup.Item>
        <ToggleGroup.Item value="reader" aria-label="Reader"><IconBook data-icon="inline-start" />Reader</ToggleGroup.Item>
        <ToggleGroup.Item value="card" aria-label="Card editor"><IconCards data-icon="inline-start" />Card</ToggleGroup.Item>
      </ToggleGroup.Root>
    {:else}
      <ToggleGroup.Root type="multiple" value={panes} onValueChange={value => { if (value.length) panes = value; }} size="sm" aria-label="Visible workspace panes">
        <ToggleGroup.Item value="files" aria-label="Toggle files pane"><IconLayoutSidebar data-icon="inline-start" />Files</ToggleGroup.Item>
        <ToggleGroup.Item value="reader" aria-label="Toggle reader pane"><IconBook data-icon="inline-start" />Reader</ToggleGroup.Item>
        <ToggleGroup.Item value="card" aria-label="Toggle card editor"><IconCards data-icon="inline-start" />Card</ToggleGroup.Item>
      </ToggleGroup.Root>
    {/if}
    {/snippet}
  </StudyChrome>
  <div bind:this={workspace} class={cn('library-workspace relative grid min-h-0 flex-1', resizing && 'select-none')} style:grid-template-columns={narrow ? 'minmax(0, 1fr)' : grid}>
    <section aria-label="Library files" class="min-h-0 min-w-0 flex-col border-r bg-sidebar" hidden={!shown('files')} style:grid-column="1" style:display={shown('files') ? 'flex' : 'none'}>
      <div class="flex min-h-11 shrink-0 items-center gap-1 border-b px-3">
        <Button variant="ghost" size="sm" class="min-w-0 flex-1 justify-start" onclick={() => folder = ''} title="Import into Library root"><span class="truncate">{rootLabel || 'Library'}</span></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Refresh files" disabled={loading || busy} onclick={refresh}><IconRefresh /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Create folder" disabled={busy} onclick={() => { folderError = ''; newFolderOpen = true; }}><IconFolderPlus /></Button>
      </div>
      <div class="flex flex-col gap-2 p-3">
        <Input aria-label="Filter visible files" placeholder="Filter visible files" bind:value={filter} />
        <Button variant="outline" size="sm" disabled={busy} onclick={() => fileInput.click()}><IconUpload data-icon="inline-start" />{busy ? 'Importing…' : 'Import PDF'}</Button>
        <input bind:this={fileInput} class="hidden" type="file" accept=".pdf,application/pdf" multiple onchange={importFiles} aria-label="Import PDFs" />
        {#if folder}<p class="truncate text-xs text-muted-foreground" title={folder}>Import into {folder.split('/').at(-1)}</p>{/if}
      </div>
      <div class="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {#if error}<div class="flex flex-col gap-2 p-3"><p class="text-sm text-destructive" role="alert">{error}</p><Button variant="outline" size="sm" onclick={refresh}>Try again</Button></div>
        {:else if !entries['']}<p class="p-3 text-sm text-muted-foreground" role="status">Loading files…</p>
        {:else if !entries[''].length}<div class="flex flex-col gap-2 px-3 py-8"><IconFolder class="size-7 text-muted-foreground" /><h2 class="text-sm font-medium">Your PDFs belong here</h2><p class="text-xs leading-relaxed text-muted-foreground">Import a PDF, open it alongside a card, and bring selected text into your notes.</p></div>
        {:else}{@render tree('', 0)}{/if}
      </div>
    </section>
    <section aria-label="PDF reader" class="flex min-h-0 min-w-0 flex-col border-r" hidden={!shown('reader')} style:grid-column={narrow ? 1 : 2} style:display={shown('reader') ? 'flex' : 'none'}>
      <div class="flex min-h-11 shrink-0 items-center border-b px-3"><h2 class="truncate text-sm font-medium" title={title}>{title}</h2></div>
      {#if selected}
        {#key selected}<PdfReader path={selected} initialPage={pages[selected] || 1} onpage={page => pages = { ...pages, [selected]: page }} oninsert={insertText} active={readerActive} />{/key}
      {:else}<div class="m-auto flex max-w-64 flex-col items-center gap-3 px-6 text-center"><IconBook class="size-8 text-muted-foreground" /><h2 class="text-sm font-medium">Open a PDF</h2><p class="text-sm leading-relaxed text-muted-foreground">Choose a file from the Library to read it beside your cards.</p><Button variant="outline" size="sm" onclick={() => { mobilePane = 'files'; if (!panes.includes('files')) panes = [...panes, 'files']; }}>Choose a file</Button></div>{/if}
    </section>
    <section aria-label="Card editor" class="flex min-h-0 min-w-0 flex-col" hidden={!shown('card')} style:grid-column={narrow ? 1 : 3} style:display={shown('card') ? 'flex' : 'none'}>
      <div class="flex min-h-11 shrink-0 items-center border-b px-3"><h2 class="text-sm font-medium">Create a card</h2></div>
      {#if editorSrc}<iframe id="library-editor" data-klaus-library-editor use:noteEditor={{ mode: "add", attach: value => editor = value, onbusy: value => editorBusy = value }} src={editorSrc} title="Card editor" class="min-h-0 w-full flex-1 border-0" inert={resizing || editorBusy}></iframe>{/if}
    </section>
    {#if !narrow && panes.length === 3}
      {#each [0, 1] as index}
        <div role="slider" aria-label={index === 0 ? 'Resize files and reader panes' : 'Resize reader and card panes'} aria-orientation="horizontal" aria-valuenow={Math.round(widths[index])} aria-valuemin="15" aria-valuemax="85" tabindex="0" class="pane-resizer absolute inset-y-0 w-2 cursor-col-resize touch-none hover:bg-ring/20 focus-visible:bg-ring/20" style:left="calc({widths.slice(0, index + 1).reduce((a, b) => a + b, 0) / widths.reduce((a, b) => a + b, 0) * 100}% - 4px)" onpointerdown={e => resizePanes(index, e)} onkeydown={e => resizeKey(index, e)}></div>
      {/each}
    {/if}
  </div>
</div>

{#snippet tree(path: string, depth: number)}
  {#each entries[path] || [] as entry (entry.path)}
    {#if entry.kind === 'folder' || !filter || entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())}
      <button type="button" class={cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring', (entry.kind === 'pdf' ? selected === entry.path : folder === entry.path) && 'bg-muted font-medium')} style:padding-left="{depth * 14 + 8}px" aria-expanded={entry.kind === 'folder' ? expanded.includes(entry.path) : undefined} aria-current={selected === entry.path ? 'true' : undefined} onclick={() => choose(entry)} title={entry.name}>
        {#if entry.kind === 'folder'}{#if expanded.includes(entry.path)}<IconChevronDown class="size-3 shrink-0" />{:else}<IconChevronRight class="size-3 shrink-0" />{/if}<IconFolder class="size-4 shrink-0 text-muted-foreground" />{:else}<IconFileTypePdf class="ml-5 size-4 shrink-0 text-muted-foreground" />{/if}<span class="truncate">{entry.name}</span>
      </button>
      {#if entry.kind === 'folder' && expanded.includes(entry.path)}{@render tree(entry.path, depth + 1)}{/if}
    {/if}
  {/each}
{/snippet}

<Dialog.Root bind:open={newFolderOpen}>
  <Dialog.Content>
    <Dialog.Header><Dialog.Title>New folder</Dialog.Title><Dialog.Description>Create a folder in {folder || 'Library'}.</Dialog.Description></Dialog.Header>
    <form class="flex flex-col gap-4" onsubmit={addFolder}>
      <Field.FieldGroup><Field.Field data-invalid={!!folderError}><Field.FieldLabel for="library-folder-name">Folder name</Field.FieldLabel><Input id="library-folder-name" bind:value={newFolderName} aria-invalid={!!folderError} autofocus />{#if folderError}<Field.FieldError>{folderError}</Field.FieldError>{/if}</Field.Field></Field.FieldGroup>
      <Dialog.Footer><Button type="button" variant="outline" onclick={() => newFolderOpen = false}>Cancel</Button><Button type="submit" disabled={busy || !newFolderName.trim()}>Create folder</Button></Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
