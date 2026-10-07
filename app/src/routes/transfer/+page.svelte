<script lang="ts">
  import { onMount } from "svelte";
  import { getDeckNames } from "@generated/backend";
  import { Json } from "@generated/anki/generic_pb";
  import { postProto } from "@generated/post";
  import { Button } from "$lib/components/ui/button";
  import { IconArrowLeft, IconDownload, IconFileExport } from "@tabler/icons-svelte";

  let format = $state("apkg");
  let deck = $state("");
  let decks = $state<{ id: string; name: string }[]>([]);
  let busy = $state(false);
  let error = $state("");
  let saved = $state(false);

  onMount(async () => {
    try {
      const result = await getDeckNames({ skipEmptyDefault: false, includeFiltered: false }, { alertOnError: false });
      decks = result.entries.map(entry => ({ id: String(entry.id), name: entry.name }));
      const selected = new URLSearchParams(location.search).get("deck");
      if (selected && decks.some(item => item.id === selected)) deck = selected;
    } catch (err) { error = String(err); }
  });

  async function exportPackage() {
    busy = true; error = ""; saved = false;
    try {
      const response = await postProto("klausExportPackage", new Json({ json: new TextEncoder().encode(JSON.stringify({
        format, deckId: format === "apkg" && deck ? deck : undefined,
      })) }), Json, { alertOnError: false });
      const result = JSON.parse(new TextDecoder().decode(response.json));
      if (result.error) throw new Error(result.error);
      saved = result.saved === true;
    } catch (err) { error = String(err); }
    finally { busy = false; }
  }
</script>

<svelte:head><title>Export | KlausNote</title></svelte:head>
<main class="mx-auto max-w-2xl space-y-8 px-6 py-8">
  <a href="/" class="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><IconArrowLeft size={16} />Back to decks</a>
  <header class="space-y-2"><IconFileExport size={28} /><h1 class="text-2xl font-semibold tracking-tight">Export your cards</h1><p class="text-sm text-muted-foreground">Save a package with your cards, media, and study history.</p></header>
  <section class="space-y-5 rounded-xl border bg-card p-6">
    <label class="block space-y-2"><span class="text-sm font-medium">Format</span>
      <select class="h-10 w-full rounded-md border bg-background px-3 text-sm" bind:value={format} disabled={busy}>
        <option value="apkg">Deck package (.apkg)</option><option value="colpkg">Whole collection backup (.colpkg)</option>
      </select>
    </label>
    {#if format === "apkg"}
      <label class="block space-y-2"><span class="text-sm font-medium">Cards to include</span>
        <select class="h-10 w-full rounded-md border bg-background px-3 text-sm" bind:value={deck} disabled={busy}>
          <option value="">All decks</option>{#each decks as item}<option value={item.id}>{item.name}</option>{/each}
        </select>
      </label>
      <p class="text-sm text-muted-foreground">Import this package into another collection to add or update its cards.</p>
    {:else}
      <p class="text-sm text-muted-foreground">Includes every deck. Restoring a collection backup replaces the receiving collection.</p>
    {/if}
    <Button onclick={exportPackage} disabled={busy}><IconDownload size={16} />{busy ? "Exporting…" : "Choose where to save"}</Button>
    {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
    {#if saved}<p role="status" class="text-sm">Package saved.</p>{/if}
  </section>
  <p class="text-sm text-muted-foreground">KlausNote also keeps automatic backups without media. Set their interval and retention in <a href="/settings" class="underline">Settings</a>.</p>
</main>
