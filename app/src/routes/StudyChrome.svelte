<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { IconDots } from "@tabler/icons-svelte";
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { keyIsTaken } from "$lib/keys";
  import KlausMark from "./KlausMark.svelte";
  import SyncControl from "./SyncControl.svelte";

  let { onsynced = () => {}, beforeleave = async () => true, tools }: { onsynced?: () => void; beforeleave?: () => Promise<boolean>; tools?: Snippet } = $props();
  let sync: SyncControl;
  const navigate = async (url: string) => {
    if (await beforeleave()) location.href = url;
  };
  const library = () => {
    if (location.pathname === "/library" || location.pathname === "/library/") {
      document.querySelector<HTMLIFrameElement>("#library-editor")?.contentWindow?.focus();
      return;
    }
    void navigate("/library");
  };
  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (keyIsTaken(event) || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "d") void navigate("/");
      else if (key === "a") library();
      else if (key === "b") void navigate("/browse");
      else if (key === "y") sync.syncNow();
      else return;
      event.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
</script>

<header class="grid min-h-14 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b bg-background px-4">
  <Button href="/settings" onclick={(event) => { event.preventDefault(); void navigate("/settings"); }} variant="ghost" size="icon" aria-label="Preferences" class="justify-self-start">
    <KlausMark />
  </Button>
  <nav aria-label="Main navigation" class="flex items-center gap-1">
    <div class="hidden items-center gap-1 lg:flex">
      <Button href="/" onclick={(event) => { event.preventDefault(); void navigate("/"); }} variant="ghost">Decks</Button>
      <Button onclick={library} variant="ghost">Library</Button>
      <Button href="/browse" onclick={(event) => { event.preventDefault(); void navigate("/browse"); }} variant="ghost">Browse</Button>
    </div>
    <div class="lg:hidden">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}<Button {...props} variant="ghost" size="icon" aria-label="Navigation"><IconDots /></Button>{/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start">
          <DropdownMenu.Item onSelect={() => void navigate("/")}>Decks</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={library}>Library</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => void navigate("/browse")}>Browse</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
    <SyncControl bind:this={sync} {onsynced} />
  </nav>
  {#if tools}
    <div class="col-span-3 flex justify-end pb-2 lg:col-span-1 lg:pb-0">{@render tools()}</div>
  {:else}<div aria-hidden="true"></div>{/if}
</header>
