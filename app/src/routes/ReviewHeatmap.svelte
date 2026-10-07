<script lang="ts">
  import type { GraphsResponse } from "@generated/anki/stats_pb";
  let { data }: { data: GraphsResponse | undefined } = $props();
  const days = $derived.by(() => {
    if (!data) return [];
    const today = new Date();
    if (today.getHours() < data.rolloverHour) today.setDate(today.getDate() - 1);
    today.setHours(12, 0, 0, 0);
    // Whole weeks, with today in its correct weekday row.
    const length = 25 * 7 + today.getDay() + 1;
    return Array.from({ length }, (_, index) => {
      const offset = index - length + 1;
      const date = new Date(today);
      date.setDate(date.getDate() + offset);
      const reviews = data.reviews?.count[offset];
      const count = reviews ? reviews.learn + reviews.relearn + reviews.young + reviews.mature + reviews.filtered : 0;
      return { offset, count, date: date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) };
    });
  });
  const total = $derived(days.reduce((sum, day) => sum + day.count, 0));
  const activeDays = $derived(days.filter((day) => day.count > 0).length);
  const maximum = $derived(Math.max(1, ...days.map((day) => day.count)));
  function search(offset: number) {
    const age = -offset;
    return `/browse?query=${encodeURIComponent(`rated:${age + 1}${age ? ` -rated:${age}` : ""}`)}`;
  }
</script>

{#if data}
  <p class="mb-5 text-sm text-muted-foreground">{data.today?.answerCount ?? 0} reviews today · {Math.round((data.today?.answerMillis ?? 0) / 60000)} minutes</p>
  <div class="flex gap-2 overflow-x-auto pb-2">
    <div class="grid shrink-0 grid-rows-7 gap-1 text-[10px] leading-3 text-muted-foreground" aria-hidden="true"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div>
    <div class="grid min-w-0 flex-1 grid-flow-col grid-rows-7 gap-1" aria-label="Daily reviews over the last six months">
      {#each days as day (day.offset)}
        <a href={search(day.offset)} title="{day.date}: {day.count} reviews" aria-label="{day.date}: {day.count} reviews" class="block min-h-3 min-w-3 rounded-[3px] ring-offset-background hover:ring-2 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring" style:background={day.count ? `color-mix(in oklch, var(--primary) ${25 + Math.round(day.count / maximum * 75)}%, var(--muted))` : "var(--muted)"}></a>
      {/each}
    </div>
  </div>
  <div class="mt-4 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{total.toLocaleString()} reviews · {activeDays} active days</span><span>Less <span aria-hidden="true">░ ▒ ▓ █</span> More</span></div>
{:else}
  <p class="text-sm text-muted-foreground">Loading review history…</p>
{/if}
