<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { IconArrowLeft, IconChevronRight, IconRefresh, IconTrash, IconDownload } from '@tabler/icons-svelte';
  import { modelCall, capabilityLabel, sizeLabel, type Preferences, type Model, type Job } from '$lib/models/client';

  let prefs = $state<Preferences>({ endpoint: 'http://127.0.0.1:11434', embedding: '', vision: '', matchSensitivity: 0.5 });
  let models = $state<Model[]>([]);
  let job = $state<Job | null>(null);
  let online = $state<boolean | null>(null);
  let runtimeError = $state('');
  let error = $state('');
  let notice = $state('');
  let loaded = $state(false);
  let busy = $state(false);
  let refreshing = $state(false);
  let downloadName = $state('');
  let sensitivity = $state(50);
  let removal = $state<Model | null>(null);
  let removalDialog: HTMLDialogElement;
  let stopped = false;
  const downloading = $derived(job?.state === 'running' || job?.state === 'cancelling');
  const embeddingModels = $derived(models.filter(m => m.capabilities.includes('embedding')));
  const visionModels = $derived(models.filter(m => m.capabilities.includes('vision')));
  const percent = $derived(job && job.total > 0 ? Math.min(100, Math.round(job.completed / job.total * 100)) : null);

  async function refresh() {
    refreshing = true;
    try {
      const result = await modelCall<{ online: boolean; models: Model[]; error?: string }>('refresh');
      online = result.online; models = result.models; runtimeError = result.error ?? '';
    } catch (err) { online = false; runtimeError = String(err); }
    finally { refreshing = false; }
  }
  async function status(initial = false) {
    const result = await modelCall<{ preferences: Preferences; job: Job | null }>('status');
    const completedNow = downloading && result.job?.state === 'complete';
    job = result.job;
    if (initial) { prefs = result.preferences; sensitivity = Math.round(prefs.matchSensitivity * 100); loaded = true; }
    if (completedNow) await refresh();
  }
  async function poll() {
    if (stopped) return;
    try { await status(); } catch (err) { error = `Could not check download progress: ${String(err)}`; }
    if (!stopped) setTimeout(poll, 1000);
  }
  async function save(event: SubmitEvent) {
    event.preventDefault(); busy = true; error = ''; notice = '';
    try {
      const result = await modelCall<{ preferences: Preferences }>('save', { preferences: { ...prefs, matchSensitivity: sensitivity / 100 } });
      prefs = result.preferences; notice = 'Model preferences saved.'; await refresh();
    } catch (err) { error = String(err); } finally { busy = false; }
  }
  async function download(event: SubmitEvent) {
    event.preventDefault(); busy = true; error = ''; notice = '';
    try { job = await modelCall<Job>('pull', { model: downloadName }); }
    catch (err) { error = String(err); } finally { busy = false; }
  }
  async function cancel() {
    try { job = await modelCall<Job>('cancel'); } catch (err) { error = String(err); }
  }
  async function remove() {
    if (!removal) return;
    busy = true; error = ''; notice = '';
    try {
      const result = await modelCall<{ preferences: Preferences }>('delete', { model: removal.name, confirmed: true });
      prefs = result.preferences; notice = `${removal.name} removed from Ollama.`;
      removalDialog.close(); removal = null; await refresh();
    } catch (err) { error = String(err); removalDialog.close(); } finally { busy = false; }
  }
  onMount(() => {
    void (async () => { try { await status(true); await refresh(); } catch (err) { error = String(err); } void poll(); })();
    return () => { stopped = true; };
  });
</script>

<svelte:head><title>Local models · KlausNote</title></svelte:head>
<main class="mx-auto max-w-3xl px-6 py-7 sm:px-10">
  <Button href="/settings" variant="ghost" size="sm" class="mb-6 -ml-2"><IconArrowLeft /> Settings</Button>
  <header class="mb-8"><h1 class="text-2xl font-semibold tracking-tight">Local models</h1><p class="mt-2 text-sm text-muted-foreground">Your model library, on this device.</p></header>
  {#if error}<p role="alert" class="mb-5 rounded-lg border border-destructive/40 p-4 text-sm break-words">{error}</p>{/if}
  {#if notice}<p role="status" class="mb-5 text-sm text-muted-foreground">{notice}</p>{/if}
  {#if !loaded}<p role="status" class="text-sm text-muted-foreground">Loading model settings…</p>{:else}
    <section aria-labelledby="runtime-heading" class="mb-8 rounded-xl border bg-card p-5">
      <div class="flex items-center justify-between gap-4">
        <div><h2 id="runtime-heading" class="font-semibold">Ollama</h2><p role="status" class="mt-1 text-sm text-muted-foreground">{refreshing ? 'Checking connection…' : online ? 'Connected on this device' : online === false ? 'Not connected' : 'Not checked'}</p></div>
        <Button variant="outline" size="sm" onclick={refresh} disabled={refreshing || busy}><IconRefresh /> Refresh</Button>
      </div>
      {#if online === false}<p class="mt-4 text-sm text-muted-foreground">Open Ollama, then refresh. If it is not installed, get it from <a href="https://ollama.com/download" target="_blank" rel="noreferrer" class="underline">ollama.com</a>.</p>{/if}
    </section>
    <section aria-labelledby="installed-heading" class="mb-8">
      <div class="mb-4 flex items-center gap-2"><h2 id="installed-heading" class="font-semibold">Installed models</h2><span class="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{models.length}</span></div>
      {#if models.length}
        <ul class="divide-y rounded-xl border">
          {#each models as model (model.name)}
            <li class="flex items-start justify-between gap-4 p-4">
              <div class="min-w-0"><h3 class="break-all text-sm font-medium">{model.name}</h3><p class="mt-1 text-xs text-muted-foreground">{model.runtime} · {sizeLabel(model.size)}</p>
                <div class="mt-2 flex flex-wrap gap-1.5">{#each model.capabilities as capability}<span class="rounded-md bg-secondary px-2 py-1 text-xs">{capabilityLabel(capability)}</span>{/each}{#if !model.capabilitiesKnown}<span class="text-xs text-muted-foreground">Capabilities unavailable</span>{/if}</div>
              </div>
              <Button variant="ghost" size="icon" aria-label={`Remove ${model.name}`} disabled={busy || downloading} onclick={() => { removal = model; removalDialog.showModal(); }}><IconTrash class="size-4" /></Button>
            </li>
          {/each}
        </ul>
      {:else}<p class="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">{online ? 'No models installed yet. Download a model below to get started.' : 'Connect to Ollama to see your installed models.'}</p>{/if}
      <p class="mt-3 text-xs text-muted-foreground">Labels come from each model's runtime. A model for text or images does not automatically support transcription. Speech models will appear here when the speech runtime is connected.</p>
    </section>
    <section aria-labelledby="download-heading" class="mb-8 border-t pt-6">
      <h2 id="download-heading" class="mb-3 font-semibold">Download a model</h2>
      <form onsubmit={download} class="flex flex-wrap items-end gap-3"><label for="model-name" class="min-w-40 flex-1 text-sm"><span class="mb-2 block">Ollama model name</span><Input id="model-name" bind:value={downloadName} placeholder="e.g. nomic-embed-text" required disabled={downloading || busy} /></label><Button type="submit" disabled={!online || busy || downloading || !downloadName.trim()}><IconDownload /> Download</Button></form>
      <p class="mt-2 text-xs text-muted-foreground">Downloads use your internet connection and device storage. Enter a name from the <a href="https://ollama.com/library" target="_blank" rel="noreferrer" class="underline">Ollama library</a>.</p>
      {#if job}<div class="mt-4 rounded-lg bg-muted p-4"><div class="flex items-center justify-between gap-3"><p class="break-all text-sm font-medium">{job.model}</p>{#if downloading}<Button variant="outline" size="sm" onclick={cancel} disabled={job.state === 'cancelling'}>Cancel</Button>{/if}</div><p role="status" class="mt-2 break-words text-sm text-muted-foreground">{job.status}</p>{#if downloading && percent !== null}<progress class="mt-3 h-2 w-full accent-primary" max="100" value={percent} aria-label="Current model layer download"></progress><p class="mt-1 text-xs text-muted-foreground">Current layer: {percent}% · {sizeLabel(job.completed)} of {sizeLabel(job.total)}</p>{/if}</div>{/if}
    </section>
    <form onsubmit={save}>
      <fieldset disabled={busy || downloading} class="space-y-6">
        <section aria-labelledby="matching-heading" class="border-t pt-6">
          <h2 id="matching-heading" class="mb-2 font-semibold">Study setup</h2>
          <p class="mb-5 text-sm text-muted-foreground">Save model choices for card matching and scanned pages. Card indexing and OCR are not connected in this version.</p>
          <div class="space-y-4">
            <label for="embedding-model" class="block text-sm font-medium">Card matching model<select id="embedding-model" bind:value={prefs.embedding} class="mt-2 block w-full rounded-md border border-input bg-background px-3 py-2 font-normal"><option value="">Choose later</option>{#if prefs.embedding && !embeddingModels.some(m => m.name === prefs.embedding)}<option value={prefs.embedding}>{prefs.embedding} (not available)</option>{/if}{#each embeddingModels as model}<option value={model.name}>{model.name}</option>{/each}</select></label>
            <label for="vision-model" class="block text-sm font-medium">Image model<select id="vision-model" bind:value={prefs.vision} class="mt-2 block w-full rounded-md border border-input bg-background px-3 py-2 font-normal"><option value="">Choose later</option>{#if prefs.vision && !visionModels.some(m => m.name === prefs.vision)}<option value={prefs.vision}>{prefs.vision} (not available)</option>{/if}{#each visionModels as model}<option value={model.name}>{model.name}</option>{/each}</select></label>
            <label for="sensitivity" class="block text-sm font-medium"><span class="flex justify-between gap-4"><span>Default match sensitivity</span><span>{sensitivity}%</span></span><input id="sensitivity" class="mt-3 w-full accent-primary" type="range" min="20" max="80" step="1" bind:value={sensitivity} /><span class="mt-1 block text-xs font-normal text-muted-foreground">Saved for future card indexing. Higher values will require a closer match.</span></label>
          </div>
          <div class="mt-5 grid gap-3 sm:grid-cols-2"><div class="rounded-lg bg-muted p-4"><h3 class="text-sm font-medium">Card index</h3><p class="mt-1 text-xs text-muted-foreground">Not connected yet. Your cards have not been indexed here.</p></div><div class="rounded-lg bg-muted p-4"><h3 class="text-sm font-medium">External tools · MCP</h3><p class="mt-1 text-xs text-muted-foreground">Not connected yet. No external tool has access through this page.</p></div></div>
        </section>
        <details class="group border-t pt-6"><summary class="flex cursor-pointer list-none items-center justify-between font-semibold">Advanced<IconChevronRight class="size-4 transition-transform group-open:rotate-90" /></summary><div class="mt-5 space-y-4"><label for="endpoint" class="block text-sm font-medium">Ollama address<Input id="endpoint" class="mt-2" bind:value={prefs.endpoint} required /></label><p class="text-xs text-muted-foreground">Local loopback addresses only. Clear model selections before switching addresses. Runtime installation, starting and stopping are managed in Ollama.</p>{#if runtimeError}<p class="break-words rounded-lg bg-muted p-3 font-mono text-xs">{runtimeError}</p>{/if}</div></details>
        <div class="flex justify-end border-t pt-6"><Button type="submit" disabled={busy || downloading}>{busy ? 'Working…' : 'Save preferences'}</Button></div>
      </fieldset>
    </form>
  {/if}
</main>
<dialog bind:this={removalDialog} class="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border bg-background p-6 text-foreground shadow-lg backdrop:bg-black/40" oncancel={() => { removal = null; }}>
  <h2 class="text-lg font-semibold">Remove this model?</h2><p class="mt-3 break-words text-sm text-muted-foreground">{removal?.name} will be removed from Ollama on this device. Other apps using this model will need to download it again. Your cards and documents will stay in place.</p><div class="mt-6 flex justify-end gap-3"><Button variant="outline" disabled={busy} onclick={() => { removalDialog.close(); removal = null; }}>Keep model</Button><Button variant="destructive" disabled={busy} onclick={remove}>Remove model</Button></div>
</dialog>
