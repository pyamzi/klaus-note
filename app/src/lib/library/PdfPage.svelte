<script lang="ts">
  import { onMount } from 'svelte';
  import { TextLayer, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
  import 'pdfjs-dist/web/pdf_viewer.css';
  let { pdf, number, width, zoom, query = '' }: { pdf: PDFDocumentProxy; number: number; width: number; zoom: number; query?: string } = $props();
  let canvas: HTMLCanvasElement, textHost: HTMLDivElement;
  let pageWidth = $state(1), pageHeight = $state(1), scale = $state(1), error = $state('');
  onMount(() => {
    const surface = canvas;
    let alive = true, page: PDFPageProxy | undefined, render: RenderTask | undefined, text: TextLayer | undefined;
    (async () => {
      page = await pdf.getPage(number);
      if (!alive) { page.cleanup(); return; }
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.max(100, width - 32) / base.width * zoom });
      pageWidth = viewport.width; pageHeight = viewport.height; scale = viewport.scale * page.userUnit;
      // Keep a single raster under both an area and a side-length limit, even for unusual pages.
      const ratio = Math.min(devicePixelRatio || 1, 4096 / viewport.width, 4096 / viewport.height, Math.sqrt(8 * 1024 * 1024 / (viewport.width * viewport.height)));
      surface.width = Math.max(1, Math.floor(viewport.width * ratio));
      surface.height = Math.max(1, Math.floor(viewport.height * ratio));
      render = page.render({ canvas: surface, canvasContext: surface.getContext('2d')!, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      text = new TextLayer({ textContentSource: page.streamTextContent(), container: textHost, viewport });
      await Promise.all([render.promise, text.render()]);
      if (!alive) return;
      if (query) for (const span of text.textDivs) if (span.textContent?.toLocaleLowerCase().includes(query.toLocaleLowerCase())) span.classList.add('library-match');
    })().catch(e => { if (alive) error = String(e); });
    return () => {
      alive = false; render?.cancel(); text?.cancel();
      // PDF.js may still be writing to the canvas until cancellation settles.
      Promise.resolve(render?.promise).catch(() => {}).finally(() => { surface.width = surface.height = 0; page?.cleanup(); });
    };
  });
</script>

<div class="library-pdf-page" style:width="{pageWidth}px" style:height="{pageHeight}px" style:--total-scale-factor={scale}>
  <canvas bind:this={canvas} aria-label="PDF page {number}" style:width="{pageWidth}px" style:height="{pageHeight}px"></canvas>
  <div bind:this={textHost} class="textLayer"></div>
  {#if error}<p class="absolute inset-0 p-4 text-destructive" role="alert">{error}</p>{/if}
</div>

<style>
  .library-pdf-page { --scale-round-x: 1px; --scale-round-y: 1px; position: relative; flex: none; background: white; color-scheme: only light; box-shadow: 0 1px 5px color-mix(in srgb, var(--foreground), transparent 85%); }
  canvas { display: block; }
  :global(.library-pdf-page .library-match) { background: color-mix(in srgb, Highlight, transparent 65%); }
</style>
