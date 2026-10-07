<script lang="ts">
  import { onMount } from "svelte";
  import { getPreferences, setPreferences, getProfileConfigJson, setProfileConfigJson } from "@generated/backend";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { IconArrowLeft, IconChevronRight } from "@tabler/icons-svelte";

  const quiet = { alertOnError: false };
  const profileKeys = ["autoSync", "syncMedia", "hide_top_bar", "hide_bottom_bar", "top_bar_hide_mode", "bottom_bar_hide_mode", "syncUrl"];
  let loaded = $state(false);
  let saving = $state(false);
  let error = $state("");
  let saved = $state(false);
  let rollover = $state(4);
  let autoSync = $state(true);
  let syncMedia = $state(true);
  let hideTop = $state(false);
  let hideBottom = $state(false);
  let topMode = $state("1");
  let bottomMode = $state("1");
  let daily = $state(12);
  let weekly = $state(10);
  let monthly = $state(9);
  let minimumInterval = $state(30);
  let syncUrl = $state("");
  let originalProfile: Record<string, unknown> = {};
  let originalPreferences: Record<string, number> = {};
  const separateWindow = new URLSearchParams(location.search).has("window");

  async function load() {
    loaded = false;
    error = "";
    saved = false;
    try {
      const [prefs, values] = await Promise.all([
        getPreferences({}, quiet),
        Promise.all(profileKeys.map(async (key) => {
          const result = await getProfileConfigJson({ val: key }, quiet);
          return [key, JSON.parse(new TextDecoder().decode(result.json))] as const;
        })),
      ]);
      if (!prefs.scheduling || !prefs.backups) throw new Error("The collection did not return its preferences.");
      rollover = prefs.scheduling.rollover;
      daily = prefs.backups.daily;
      weekly = prefs.backups.weekly;
      monthly = prefs.backups.monthly;
      minimumInterval = prefs.backups.minimumIntervalMins;
      originalPreferences = { rollover, daily, weekly, monthly, minimumInterval };
      originalProfile = Object.fromEntries(values);
      autoSync = originalProfile.autoSync !== false;
      syncMedia = originalProfile.syncMedia !== false;
      hideTop = originalProfile.hide_top_bar === true;
      hideBottom = originalProfile.hide_bottom_bar === true;
      topMode = originalProfile.top_bar_hide_mode === 0 ? "0" : "1";
      bottomMode = originalProfile.bottom_bar_hide_mode === 0 ? "0" : "1";
      syncUrl = typeof originalProfile.syncUrl === "string" ? originalProfile.syncUrl : "";
      loaded = true;
    } catch (err) { error = `Could not load settings: ${String(err)}`; }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    error = "";
    saved = false;
    try {
      if (![rollover, daily, weekly, monthly, minimumInterval].every(Number.isInteger)
        || rollover < 0 || rollover > 23 || daily < 0 || weekly < 0 || monthly < 0 || minimumInterval < 1) {
        throw new Error("Use whole numbers within the displayed limits.");
      }
      // Fetch first so changing these fields cannot overwrite unrelated preferences.
      const prefs = await getPreferences({}, quiet);
      if (!prefs.scheduling || !prefs.backups) throw new Error("The collection did not return its preferences.");
      const changed = { rollover, daily, weekly, monthly, minimumInterval };
      if (Object.entries(changed).some(([key, value]) => originalPreferences[key] !== value)) {
        if (rollover !== originalPreferences.rollover) prefs.scheduling.rollover = rollover;
        if (daily !== originalPreferences.daily) prefs.backups.daily = daily;
        if (weekly !== originalPreferences.weekly) prefs.backups.weekly = weekly;
        if (monthly !== originalPreferences.monthly) prefs.backups.monthly = monthly;
        if (minimumInterval !== originalPreferences.minimumInterval) prefs.backups.minimumIntervalMins = minimumInterval;
        await setPreferences(prefs, quiet);
        originalPreferences = changed;
      }
      const values = { autoSync, syncMedia, hide_top_bar: hideTop, hide_bottom_bar: hideBottom, top_bar_hide_mode: Number(topMode), bottom_bar_hide_mode: Number(bottomMode) };
      for (const [key, value] of Object.entries(values)) {
        if (originalProfile[key] !== value) {
          await setProfileConfigJson({ key, valueJson: new TextEncoder().encode(JSON.stringify(value)) }, quiet);
          originalProfile[key] = value;
        }
      }
      saved = true;
    } catch (err) { error = `Could not save all settings. Reload to check what was saved. ${String(err)}`; }
    finally { saving = false; }
  }

  onMount(() => { load(); });
</script>

<svelte:head><title>Settings · KlausNote</title></svelte:head>

<main class="mx-auto max-w-2xl px-6 py-7 sm:px-10">
  {#if !separateWindow}
    <Button href="/" variant="ghost" size="sm" class="mb-6 -ml-2"><IconArrowLeft /> Decks</Button>
  {/if}
  <header class="mb-8">
    <h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
    <p class="mt-2 text-sm text-muted-foreground">Your study routine and this device.</p>
    <Button href="/settings/models" variant="outline" class="mt-4">Local models</Button>
  </header>
  {#if error}
    <div role="alert" class="mb-5 rounded-lg border border-destructive/40 p-4 text-sm">
      <p>{error}</p><Button variant="outline" size="sm" class="mt-3" onclick={load} disabled={saving}>Reload settings</Button>
    </div>
  {/if}
  {#if loaded}
    <form onsubmit={save} oninput={() => { saved = false; }}>
      <fieldset disabled={saving} class="space-y-8">
        <section aria-labelledby="study-heading">
          <h2 id="study-heading" class="mb-4 text-base font-semibold">Study</h2>
          <div class="flex items-start justify-between gap-5">
            <label for="rollover" class="text-sm"><span class="font-medium">A new study day starts at</span><span class="mt-1 block text-muted-foreground">Choose the hour when your daily card counts reset.</span></label>
            <select id="rollover" bind:value={rollover} class="rounded-md border border-input bg-background px-3 py-2 text-sm">
              {#each Array.from({ length: 24 }, (_, hour) => hour) as hour}<option value={hour}>{String(hour).padStart(2, "0")}:00</option>{/each}
            </select>
          </div>
        </section>
        <section aria-labelledby="sync-heading" class="border-t pt-6">
          <h2 id="sync-heading" class="mb-4 text-base font-semibold">Sync</h2>
          <div class="space-y-5">
            <div class="flex items-center justify-between gap-5"><label for="auto-sync" class="text-sm"><span class="font-medium">Sync automatically</span><span class="mt-1 block text-muted-foreground">Keep your collection in sync when signed in.</span></label><Checkbox id="auto-sync" bind:checked={autoSync} /></div>
            <div class="flex items-center justify-between gap-5"><label for="sync-media" class="text-sm"><span class="font-medium">Include images and audio</span><span class="mt-1 block text-muted-foreground">Sync the media used by your cards.</span></label><Checkbox id="sync-media" bind:checked={syncMedia} /></div>
          </div>
        </section>
        <section aria-labelledby="appearance-heading" class="border-t pt-6">
          <h2 id="appearance-heading" class="mb-4 text-base font-semibold">Appearance</h2>
          <p class="mb-5 text-sm text-muted-foreground">Light and dark appearance follow your device.</p>
          <div class="space-y-5">
            <div class="flex items-center justify-between gap-5"><label for="hide-top" class="text-sm font-medium">Hide the top bar while studying</label><Checkbox id="hide-top" bind:checked={hideTop} /></div>
            {#if hideTop}<label class="flex items-center justify-between gap-5 text-sm" for="top-mode">Hide top bar<select id="top-mode" bind:value={topMode} class="rounded-md border border-input bg-background px-3 py-2"><option value="1">Always during study</option><option value="0">Only in full screen</option></select></label>{/if}
            <div class="flex items-center justify-between gap-5"><label for="hide-bottom" class="text-sm font-medium">Hide the answer bar while studying</label><Checkbox id="hide-bottom" bind:checked={hideBottom} /></div>
            {#if hideBottom}<label class="flex items-center justify-between gap-5 text-sm" for="bottom-mode">Hide answer bar<select id="bottom-mode" bind:value={bottomMode} class="rounded-md border border-input bg-background px-3 py-2"><option value="1">Always during study</option><option value="0">Only in full screen</option></select></label><p class="text-xs text-muted-foreground">Use Space to reveal an answer and 1–4 to grade.</p>{/if}
          </div>
        </section>
        <details class="group border-t pt-6">
          <summary class="flex cursor-pointer list-none items-center justify-between text-base font-semibold">Advanced<IconChevronRight class="size-4 transition-transform group-open:rotate-90" /></summary>
          <div class="mt-6 space-y-6">
            <section aria-labelledby="backup-heading">
              <h2 id="backup-heading" class="text-sm font-semibold">Backup retention</h2>
              <p class="mt-1 text-sm text-muted-foreground">Limits for collection backups. These settings do not create a backup immediately.</p>
              <div class="mt-4 grid grid-cols-3 gap-3">
                <label for="daily" class="space-y-2 text-sm"><span>Daily copies</span><Input id="daily" type="number" min="0" max="9999" step="1" bind:value={daily} required /></label>
                <label for="weekly" class="space-y-2 text-sm"><span>Weekly copies</span><Input id="weekly" type="number" min="0" max="9999" step="1" bind:value={weekly} required /></label>
                <label for="monthly" class="space-y-2 text-sm"><span>Monthly copies</span><Input id="monthly" type="number" min="0" max="9999" step="1" bind:value={monthly} required /></label>
              </div>
              <label for="backup-interval" class="mt-4 flex items-center justify-between gap-5 text-sm">Minimum interval, minutes<Input id="backup-interval" class="w-24" type="number" min="1" max="525600" step="1" bind:value={minimumInterval} required /></label>
            </section>
            <section aria-labelledby="server-heading" class="border-t pt-5">
              <h2 id="server-heading" class="text-sm font-semibold">Account sync server</h2>
              <p class="mt-2 break-all text-sm">{syncUrl || "Provided by your Klaus account"}</p>
              <p class="mt-1 text-xs text-muted-foreground">Managed by sign-in. Custom server configuration is not available here yet.</p>
            </section>
          </div>
        </details>
        <div class="flex items-center justify-between gap-4 border-t pt-6">
          <p role="status" aria-live="polite" class="text-sm text-muted-foreground">{saved ? "Settings saved." : saving ? "Saving…" : "Changes apply after saving."}</p>
          <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
        </div>
      </fieldset>
    </form>
  {:else if !error}<p role="status" class="text-sm text-muted-foreground">Loading settings…</p>{/if}
</main>
