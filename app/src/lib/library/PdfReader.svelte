<script lang="ts">
  import { untrack } from 'svelte';
  import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFDocumentLoadingTask } from 'pdfjs-dist';
  import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
  import { IconChevronLeft, IconChevronRight, IconMinus, IconPlus, IconCopy, IconArrowRight, IconSearch } from '@tabler/icons-svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { toast } from 'svelte-sonner';
  import { readPdf } from './storage';
  import PdfPage from './PdfPage.svelte';
  GlobalWorkerOptions.workerSrc = worker;
  let { path, initialPage = 1, onpage, oninsert, active = true }: { path: string; initialPage?: number; onpage: (page: number) => void; oninsert: (text: string) => void; active?: boolean } = $props();
  let pdf = $state<PDFDocumentProxy>(), page = $state(1), pageInput = $state('1'), zoom = $state(1), width = $state(500);
  let error = $state(''), loading = $state(false), query = $state(''), matchQuery = $state(''), searching = $state(false), searchMessage = $state(''), selected = $state('');
  let host: HTMLDivElement;
  let documentVersion = 0, searchVersion = 0;
  $effect(() => {
    const file = path, start = untrack(() => initialPage), version = ++documentVersion;
    const controller = new AbortController();
    let task: PDFDocumentLoadingTask | undefined;
    pdf = undefined; error = ''; loading = true; searchVersion++; searching = false; selected = ''; searchMessage = ''; query = ''; matchQuery = ''; zoom = 1;
    (async () => {
      const bytes = await readPdf(file, controller.signal);
      if (version !== documentVersion) return;
      task = getDocument({ data: bytes, cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/' });
      const document = await task.promise;
      if (version !== documentVersion) return;
      pdf = document; page = Math.min(document.numPages, Math.max(1, start)); pageInput = String(page); onpage(page);
    })().catch(e => { if (version === documentVersion) error = String(e); }).finally(() => { if (version === documentVersion) loading = false; });
    return () => { documentVersion++; searchVersion++; controller.abort(); void task?.destroy(); };
  });
  function go(number: number) {
    if (!pdf) return;
    page = Math.max(1, Math.min(pdf.numPages, Math.floor(number) || 1)); pageInput = String(page); selected = ''; onpage(page);
    host?.scrollTo(0, 0);
  }
  async function find() {
    const document = pdf, term = query.trim().toLocaleLowerCase(), version = ++searchVersion, start = page;
    if (!document || !term) { searchMessage = ''; return; }
    searching = true; searchMessage = ''; matchQuery = query.trim();
    try {
      for (let offset = 1; offset <= document.numPages; offset++) {
        const number = (start + offset - 1) % document.numPages + 1;
        const source = await document.getPage(number);
        const content = await source.getTextContent();
        const text = content.items.map(item => 'str' in item ? item.str : '').join(' ');
        if (version !== searchVersion) { if (number !== page) source.cleanup(); return; }
        if (text.toLocaleLowerCase().includes(term)) { if (number !== page) source.cleanup(); go(number); searchMessage = `Found on page ${number}`; return; }
        if (number !== page) source.cleanup();
      }
      searchMessage = 'No matching text. Scanned PDFs may not contain selectable text.';
    } catch (e) { if (version === searchVersion) searchMessage = String(e); }
    finally { if (version === searchVersion) searching = false; }
  }
  function selectionChanged() {
    const selection = getSelection();
    selected = selection?.anchorNode && host?.contains(selection.anchorNode) ? selection.toString() : '';
  }
  async function copy() {
    try { await navigator.clipboard.writeText(selected); toast.success('Text copied'); }
    catch { toast.error('Copy failed. Select the text and use your copy shortcut.'); }
  }
</script>

<svelte:document onselectionchange={selectionChanged} />
<div class="flex size-full min-h-0 flex-col">
  <div class="flex min-h-11 shrink-0 flex-wrap items-center gap-1 border-b bg-background px-2 py-1">
    <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={!pdf || page <= 1} onclick={() => go(page - 1)}><IconChevronLeft /></Button>
    <Input aria-label="Page number" class="w-12" inputmode="numeric" bind:value={pageInput} onchange={() => go(Number(pageInput))} onkeydown={e => { if (e.key === 'Enter') go(Number(pageInput)); }} disabled={!pdf} />
    <span class="text-xs text-muted-foreground">/ {pdf?.numPages || '…'}</span>
    <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={!pdf || page >= pdf.numPages} onclick={() => go(page + 1)}><IconChevronRight /></Button>
    <div class="ml-auto flex items-center gap-1">
      <Button variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={!pdf || zoom <= .5} onclick={() => zoom = Math.max(.5, zoom - .25)}><IconMinus /></Button>
      <Button variant="ghost" size="sm" disabled={!pdf} onclick={() => zoom = 1} aria-label="Fit page width">{Math.round(zoom * 100)}%</Button>
      <Button variant="ghost" size="icon-sm" aria-label="Zoom in" disabled={!pdf || zoom >= 3} onclick={() => zoom = Math.min(3, zoom + .25)}><IconPlus /></Button>
    </div>
  </div>
  <form class="flex shrink-0 items-center gap-1 border-b px-2 py-2" onsubmit={e => { e.preventDefault(); void find(); }}>
    <Input aria-label="Find in PDF" placeholder="Find in PDF" bind:value={query} disabled={!pdf} />
    <Button type="submit" variant="ghost" size="icon-sm" aria-label="Find next matching page" disabled={!pdf || searching || !query.trim()}><IconSearch /></Button>
    <Button variant="ghost" size="icon-sm" aria-label="Copy selected text" disabled={!selected} onclick={copy}><IconCopy /></Button>
    <Button variant="ghost" size="icon-sm" aria-label="Insert selected text into card" disabled={!selected} onclick={() => oninsert(selected)}><IconArrowRight /></Button>
  </form>
  {#if searchMessage}<p class="border-b px-3 py-2 text-xs text-muted-foreground" role="status">{searchMessage}</p>{/if}
  <div bind:this={host} bind:clientWidth={width} class="flex min-h-0 flex-1 items-start justify-start overflow-auto bg-muted p-4">
    {#if loading}<p class="m-auto text-sm text-muted-foreground" role="status">Opening PDF…</p>
    {:else if error}<p class="m-auto text-sm text-destructive" role="alert">{error}</p>
    {:else if pdf && active}
      {#key `${page}:${zoom}:${width}:${matchQuery}`}<PdfPage {pdf} number={page} {width} {zoom} query={matchQuery} />{/key}
    {/if}
  </div>
</div>
