<script lang="ts">
  import { ContextMenu } from "bits-ui";
  import type { Snippet } from "svelte";
  let { children, onedit }: { children: Snippet; onedit: () => void } = $props();
</script>
<ContextMenu.Root>
  <ContextMenu.Trigger>{@render children()}</ContextMenu.Trigger>
  <ContextMenu.Portal>
    <ContextMenu.Content class="z-50 min-w-40 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md">
      <ContextMenu.Item onSelect={onedit} class="cursor-default rounded-md px-2 py-1.5 outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground">Edit Widgets</ContextMenu.Item>
    </ContextMenu.Content>
  </ContextMenu.Portal>
</ContextMenu.Root>
