<script lang="ts">
  // The review screen: what Anki's Qt reviewer (aqt/reviewer.py) and its bottom bar
  // do. Cards render in a sandboxed frame (static/card.html) running Anki's reviewer
  // JS; this page owns the queue, grading and undo.
  import { answerCard, describeNextStates, getQueuedCards, setCurrentDeck, undo, redo, buryOrSuspendCards, setFlag, getNote, addNoteTags, removeNoteTags, removeNotes, getProfileConfigJson, cardStats } from "@generated/backend";
  import { BuryOrSuspendCardsRequest_Mode as BuryMode, CardAnswer_Rating, type QueuedCards_QueuedCard } from "@generated/anki/scheduler_pb";
  import type { CardStatsResponse } from "@generated/anki/stats_pb";
  import type { RenderCardResponse } from "@generated/klaus_pb";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { cardBodyClass, cardFrameSrc, night, openCardLink, postToCard, renderCard as render } from "$lib/card";
  import ReviewEditor from "./ReviewEditor.svelte";
  import { ReviewAudio, clickedTag } from "$lib/review/audio";
  import StudyChrome from "../StudyChrome.svelte";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import * as Dialog from "$lib/components/ui/dialog";
  import { keyIsTaken } from "$lib/keys";
  import { Button } from "$lib/components/ui/button";

  const ratings = [CardAnswer_Rating.AGAIN, CardAnswer_Rating.HARD, CardAnswer_Rating.GOOD, CardAnswer_Rating.EASY];
  const ratingNames = ["Again", "Hard", "Good", "Easy"];

  let frame: HTMLIFrameElement;
  let current: QueuedCards_QueuedCard | undefined = $state();
  let counts = $state([0, 0, 0]);
  let labels: string[] = $state([]);
  let side: "question" | "answer" = $state("question");
  let rendered: RenderCardResponse | undefined;
  let shownAt = 0;
  let typedAnswer: string | undefined;
  // Card transitions run one at a time: reveal/grade are dropped while one is in
  // flight or queued (no double grades from key repeat), undo waits its turn.
  // A failed transition shows a toast, and later ones still run.
  let last: Promise<void> = Promise.resolve();
  let pending = $state(0);
  let queueError = $state("");
  let frameReady: Promise<void>;
  let pendingTyped: ((typed: string | null) => void) | undefined;
  let destroyed = false;
  const deck = BigInt(new URLSearchParams(location.search).get("deck") ?? "1");
  let marked = $state(false);
  let deleteOpen = $state(false);
  let infoOpen = $state(false);
  let info: CardStatsResponse | undefined = $state();
  let infoError = $state("");
  let editOpen = $state(false);
  let audioMessage = $state("");
  const audio = new ReviewAudio((message) => { audioMessage = message; });
  function replay() {
    if (!rendered) return;
    audioMessage = "";
    const tags = side === "question" ? rendered.questionAvTags
      : [...(rendered.replayQuestionAudio ? rendered.questionAvTags : []), ...rendered.answerAvTags];
    audio.play(tags, rendered.interruptAudio);
  }
  async function finishEdit() {
    if (!current) return;
    const updated = await render(current.card!.id, typedAnswer);
    const note = await getNote({ nid: current.card!.noteId }, { alertOnError: false });
    rendered = updated;
    marked = note.tags.some((tag) => tag.toLowerCase() === "marked");
    post({ show: side, html: updated[side], answer: updated.answer, bodyClass: bodyClass(current) });
    editOpen = false;
  }
  async function showInfo() {
    if (!current) return;
    info = undefined; infoError = ""; infoOpen = true;
    try { info = await cardStats({ cid: current.card!.id }, { alertOnError: false }); }
    catch (err) { infoError = String(err); }
  }
  let topHidden = $state(false);
  let bottomHidden = $state(false);
  let fullscreen = $state(false);
  let hideTop = false, hideBottom = false, topMode = 0, bottomMode = 0;
  function updateBarVisibility() {
    fullscreen = Boolean(document.fullscreenElement || (window as Window & { __klausFullscreen?: boolean }).__klausFullscreen);
    topHidden = hideTop && (topMode === 1 || fullscreen);
    bottomHidden = hideBottom && (bottomMode === 1 || fullscreen);
  }
  async function loadBarPreferences() {
    const values = await Promise.all(["hide_top_bar", "hide_bottom_bar", "top_bar_hide_mode", "bottom_bar_hide_mode"].map(async (val) => {
      const result = await getProfileConfigJson({ val }, { alertOnError: false });
      return JSON.parse(new TextDecoder().decode(result.json));
    }));
    [hideTop, hideBottom, topMode, bottomMode] = [values[0] === true, values[1] === true, values[2] === 1 ? 1 : 0, values[3] === 1 ? 1 : 0];
    updateBarVisibility();
  }
  function edit() {
    if (pending || !current) return;
    exclusive(async () => {
      audio.stop();
      editOpen = true;
    });
  }
  function bury(note: boolean, suspend = false) {
    if (pending || !current) return;
    const card = current.card!;
    exclusive(async () => {
      await buryOrSuspendCards({ cardIds: note ? [] : [card.id], noteIds: note ? [card.noteId] : [], mode: suspend ? BuryMode.SUSPEND : BuryMode.BURY_USER }, { alertOnError: false });
      await next();
    });
  }
  function flag(value: number) {
    if (pending || !current) return;
    const card = current.card!;
    exclusive(async () => {
      await setFlag({ cardIds: [card.id], flag: value }, { alertOnError: false });
      // Keep the question/answer side and timer when changing a flag.
      card.flags = (card.flags & ~7) | value;
      toast(`Flag ${value === 0 ? "removed" : "updated"}`);
    });
  }
  function toggleMark() {
    if (pending || !current) return;
    const noteId = current.card!.noteId;
    exclusive(async () => {
      const action = marked ? removeNoteTags : addNoteTags;
      await action({ noteIds: [noteId], tags: "marked" }, { alertOnError: false });
      marked = !marked;
      toast(marked ? "Note marked" : "Note unmarked");
    });
  }
  function deleteNote() {
    if (pending || !current) return;
    const noteId = current.card!.noteId;
    exclusive(async () => {
      await removeNotes({ noteIds: [noteId], cardIds: [] }, { alertOnError: false });
      deleteOpen = false;
      await next();
    });
  }

  function bodyClass(card: QueuedCards_QueuedCard): string {
    return cardBodyClass(card.card?.templateIdx ?? 0);
  }

  function exclusive(fn: () => Promise<void>): Promise<void> {
    pending++;
    const run = last
      .then(fn)
      .catch((err: unknown) => {
        toast.error("Review failed", { description: String(err) });
      })
      .finally(() => pending--);
    last = run;
    return run;
  }

  function post(msg: object) {
    postToCard(frame, msg);
  }

  // Call only inside exclusive().
  async function next() {
    audio.play([], rendered?.interruptAudio ?? true); audioMessage = "";
    typedAnswer = undefined;
    current = undefined;
    rendered = undefined;
    queueError = "";
    try {
      const queued = await getQueuedCards({ fetchLimit: 1, intradayLearningOnly: false }, { alertOnError: false });
      // Left via client-side navigation (Decks) while this was in flight.
      if (destroyed) return;
      const card = queued.cards[0];
      if (!card) {
        current = undefined;
        audio.stop();
        location.href = `/?deck=${deck}`;
        return;
      }
      const nextLabels = (await describeNextStates(card.states!, { alertOnError: false })).vals;
      const nextRendered = await render(card.card!.id);
      const note = await getNote({ nid: card.card!.noteId }, { alertOnError: false });
      await frameReady;
      if (destroyed) return;
      marked = note.tags.some((tag) => tag.toLowerCase() === "marked");
      [current, rendered, labels, side] = [card, nextRendered, nextLabels, "question"];
      counts = [queued.newCount, queued.learningCount, queued.reviewCount];
      // The answer goes along so the reviewer preloads its images and MathJax.
      post({ show: "question", html: rendered.question, answer: rendered.answer, bodyClass: bodyClass(card) });
      shownAt = Date.now();
      audio.play(rendered.autoplay ? rendered.questionAvTags : [], rendered.interruptAudio);
    } catch (err) {
      if (!destroyed) queueError = String(err);
      throw err;
    }
  }

  function reviewOverlayOpen() {
    return editOpen || deleteOpen || infoOpen || Boolean(document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'));
  }

  function reveal() {
    if (reviewOverlayOpen() || pending || !current || side !== "question") return;
    exclusive(async () => {
      const card = current!;
      post({ ask: "typedAnswer" });
      // Card JS that throws or overrides getTypedAnswer never replies: carry on without.
      const typed = await new Promise<string | null>((resolve) => {
        pendingTyped = resolve;
        setTimeout(() => resolve(null), 1000);
      });
      pendingTyped = undefined;
      typedAnswer = typed ?? undefined;
      const answer = typed === null ? rendered!.answer : (await render(card.card!.id, typed)).answer;
      side = "answer";
      post({ show: "answer", html: answer, bodyClass: bodyClass(card) });
      audioMessage = "";
      audio.play(rendered!.autoplay ? rendered!.answerAvTags : [], rendered!.interruptAudio);
    });
  }

  function grade(ease: number) {
    if (reviewOverlayOpen() || pending || !current || side !== "answer") return;
    const card = current;
    const states = card.states!;
    exclusive(async () => {
      await answerCard(
        {
          cardId: card.card!.id,
          currentState: states.current,
          newState: [states.again, states.hard, states.good, states.easy][ease - 1],
          rating: ratings[ease - 1],
          answeredAtMillis: BigInt(Date.now()),
          millisecondsTaken: Date.now() - shownAt,
        },
        { alertOnError: false },
      );
      await next();
    });
  }

  function undoLast(redoing = false) {
    // Native menu events also reach this handler while the note editor is open.
    // Keep unsaved editor writes and scheduler history from racing each other.
    if (editOpen || deleteOpen || infoOpen) return;
    exclusive(async () => {
      // Nothing to undo is not an error worth showing (Anki ignores UndoEmpty too).
      const result = await (redoing ? redo : undo)({}, { alertOnError: false }).catch(() => undefined);
      if (result) { toast(`${result.operation} ${redoing ? "redone" : "undone"}`); await next(); }
    });
  }

  // Anki's reviewer shortcuts (aqt/reviewer.py _shortcutKeys), subset for #7.
  /** True if the key was a reviewer shortcut. */
  function onKey(key: string, ctrl: boolean, alt = false): boolean {
    if (editOpen || deleteOpen || infoOpen) return false;
    if (key === "Escape") location.href = `/?deck=${deck}`;
    else if (ctrl && !alt && key === "z") undoLast();
    else if (ctrl && !alt && /^[0-7]$/.test(key)) flag(Number(key));
    else if (ctrl || alt) return false;
    else if (key === " " || key === "Enter") side === "question" ? reveal() : grade(3);
    else if (["1", "2", "3", "4"].includes(key)) grade(Number(key));
    else if (key === "u") undoLast();
    else if (key === "e") edit();
    else if (key.toLowerCase() === "r" || key === "F5") replay();
    else if (key === "i") void showInfo();
    else if (key === "*") toggleMark();
    else if (key === "-") bury(false);
    else if (key === "=") bury(true);
    else if (key === "!") bury(true, true);
    else if (key === "@") bury(false, true);
    else return false;
    return true;
  }

  // Commands the card frame may send (Anki's reviewer _linkHandler); anything else,
  // e.g. from card JS, is ignored.
  function onCommand(cmd: string) {
    if (cmd === "ans") reveal();
    else if (/^ease[1-4]$/.test(cmd)) grade(Number(cmd.slice(4)));
    else if (cmd === "replayAudio" && !reviewOverlayOpen()) replay();
    else if (rendered && !reviewOverlayOpen()) {
      const tag = clickedTag(cmd, rendered.questionAvTags, rendered.answerAvTags);
      if (tag) { audioMessage = ""; audio.play([tag], rendered.interruptAudio); }
    }
  }

  onMount(() => {
    frameReady = new Promise((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || !event.data?.klaus) return;
      const { cmd, key, typedAnswer, openLink } = event.data;
      if (typeof cmd === "string") onCommand(cmd);
      if (openLink !== undefined) openCardLink(openLink);
      // Card JS can post these too, so only reveal/grade keys count from the frame.
      if (typeof key === "string" && [" ", "Enter", "1", "2", "3", "4"].includes(key)) onKey(key, false);
      if ("typedAnswer" in event.data) pendingTyped?.(typeof typedAnswer === "string" ? typedAnswer : null);
    };
    // A focused button would also activate on Space/Enter: handle the key once.
    const onKeydown = (e: KeyboardEvent) =>
      !keyIsTaken(e) && onKey(e.key, e.ctrlKey || e.metaKey, e.altKey) && e.preventDefault();
    addEventListener("message", onMessage);
    addEventListener("keydown", onKeydown);
    const refreshPreferences = () => { loadBarPreferences().catch(() => {}); };
    refreshPreferences();
    addEventListener("focus", refreshPreferences);
    addEventListener("fullscreenchange", updateBarVisibility);
    addEventListener("klaus-fullscreen", updateBarVisibility);
    const onHistory = (event: Event) => {
      const action = (event as CustomEvent).detail;
      if (action === "undo" || action === "redo") undoLast(action === "redo");
    };
    addEventListener("klaus-collection-history", onHistory);
    exclusive(async () => {
      await setCurrentDeck({ did: deck }, { alertOnError: false });
      await next();
    });
    return () => {
      destroyed = true;
      audio.stop();
      removeEventListener("message", onMessage);
      removeEventListener("keydown", onKeydown);
      removeEventListener("focus", refreshPreferences);
      removeEventListener("fullscreenchange", updateBarVisibility);
      removeEventListener("klaus-fullscreen", updateBarVisibility);
      removeEventListener("klaus-collection-history", onHistory);
    };
  });
</script>

<div class="flex h-screen flex-col">
  <div hidden={topHidden}><StudyChrome /></div>
  <iframe bind:this={frame} title="Card" src={cardFrameSrc} sandbox="allow-scripts" inert={pending > 0 || !!queueError} class="min-h-0 w-full flex-1 border-0"></iframe>
  {#if queueError}<div role="alert" class="flex items-center justify-center gap-3 border-t px-3 py-2 text-sm"><span>Could not load the next card.</span><Button variant="outline" size="sm" disabled={pending > 0} onclick={() => exclusive(next)}>Retry</Button></div>{/if}
  {#if audioMessage}<div class="flex items-center justify-center gap-3 px-3 py-2 text-xs text-muted-foreground" role="status">{audioMessage}<Button variant="ghost" size="sm" onclick={replay}>Replay Audio</Button></div>{/if}
  {#if !bottomHidden}
    <footer class="grid grid-cols-[auto_1fr_auto] items-center gap-2 border-t px-3 py-2 sm:gap-4 sm:px-4">
      <Button variant="ghost" size="sm" onclick={edit} disabled={!current || pending > 0}>Edit</Button>
      <div class="flex min-w-0 flex-col items-center gap-1.5">
        {#if side === "question"}
          <div class="flex gap-3 text-sm tabular-nums" aria-label="New, learning, due">
            {#each counts as count, i (i)}<span class={["text-count-new", "text-count-learn", "text-count-review"][i]} class:underline={current?.queue === i}>{count}</span>{/each}
          </div>
          <Button variant="ghost" class="min-w-32" onclick={reveal} disabled={!current || pending > 0}>Show Answer</Button>
        {:else}
          <div class="grid w-full max-w-md grid-cols-4 gap-1 sm:gap-2">
            {#each ratingNames as name, i (name)}
              <Button variant="ghost" class="h-auto min-w-0 flex-col gap-1 px-1 py-1.5" onclick={() => grade(i + 1)} disabled={!current || pending > 0}>
                <span class="text-[10px] text-muted-foreground sm:text-xs">{labels[i] ?? ""}</span>
                <span class="text-xs sm:text-sm">{name}</span>
              </Button>
            {/each}
          </div>
        {/if}
      </div>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>{#snippet child({ props })}<Button {...props} variant="ghost" size="sm" disabled={!current || pending > 0}>More</Button>{/snippet}</DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-52">
          <DropdownMenu.Item onSelect={() => undoLast()}>Undo</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={toggleMark}>{marked ? "Unmark Note" : "Mark Note"}</DropdownMenu.Item>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger>Flag</DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent>
              {#each ["No flag", "Red", "Orange", "Green", "Blue", "Pink", "Turquoise", "Purple"] as name, value (value)}<DropdownMenu.Item onSelect={() => flag(value)}>{name}</DropdownMenu.Item>{/each}
            </DropdownMenu.SubContent>
          </DropdownMenu.Sub>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onSelect={() => bury(false)}>Bury Card</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => bury(true)}>Bury Note</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => bury(false, true)}>Suspend Card</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => bury(true, true)}>Suspend Note</DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onSelect={replay}>Replay Audio <span class="ml-auto text-xs text-muted-foreground">R</span></DropdownMenu.Item>
          <DropdownMenu.Item onSelect={showInfo}>Card Info</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => (location.href = `/deck-options/${deck}${night ? "#night" : ""}`)}>Options</DropdownMenu.Item>
          <DropdownMenu.Item variant="destructive" onSelect={() => (deleteOpen = true)}>Delete Note</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </footer>
  {/if}
</div>

<Dialog.Root open={editOpen}>
  <Dialog.Content class="flex h-[80vh] max-w-3xl flex-col sm:max-w-3xl" showCloseButton={false} onEscapeKeydown={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()}>
    <Dialog.Header><Dialog.Title>Edit current note</Dialog.Title><Dialog.Description>Save your edits and continue reviewing this card.</Dialog.Description></Dialog.Header>
    {#if editOpen && current}<ReviewEditor noteId={current.card!.noteId} cardId={current.card!.id} deckId={current.card!.deckId} ondone={finishEdit} oncancel={() => (editOpen = false)} />{/if}
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={deleteOpen}>
  <Dialog.Content>
    <Dialog.Header><Dialog.Title>Delete this note?</Dialog.Title><Dialog.Description>All cards belonging to this note will be deleted. You can undo this operation.</Dialog.Description></Dialog.Header>
    <Dialog.Footer><Dialog.Close>{#snippet child({ props })}<Button {...props} variant="outline" disabled={pending > 0}>Cancel</Button>{/snippet}</Dialog.Close><Button variant="destructive" onclick={deleteNote} disabled={pending > 0}>Delete Note</Button></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={infoOpen}>
  <Dialog.Content class="h-[80vh] max-w-3xl sm:max-w-3xl grid-rows-[auto_1fr]">
    <Dialog.Header><Dialog.Title>Card Info</Dialog.Title></Dialog.Header>
    <div class="min-h-0 overflow-auto">
      {#if infoError}<p role="alert" class="text-destructive">{infoError}</p>
      {:else if info}
        <dl class="grid grid-cols-[auto_1fr] gap-x-8 gap-y-2 text-sm">
          {#each [["Deck", info.deck], ["Note type", info.notetype], ["Card type", info.cardType], ["Interval", `${info.interval} days`], ["Due", info.dueDate !== undefined ? new Date(Number(info.dueDate) * 1000).toLocaleString() : info.duePosition !== undefined ? `Position ${info.duePosition}` : "Not scheduled"], ["Preset", info.preset], ["Ease", info.ease ? `${(info.ease / 10).toFixed(0)}%` : "Not available"], ["Stability", info.memoryState ? `${info.memoryState.stability.toFixed(1)} days` : "Not available"], ["Difficulty", info.memoryState ? info.memoryState.difficulty.toFixed(1) : "Not available"], ["Retrievability", info.fsrsRetrievability !== undefined ? `${(info.fsrsRetrievability * 100).toFixed(1)}%` : "Not available"], ["Reviews", info.reviews], ["Lapses", info.lapses], ["Average time", `${info.averageSecs.toFixed(1)} seconds`], ["Total time", `${Math.round(info.totalSecs)} seconds`], ["Card ID", String(info.cardId)], ["Note ID", String(info.noteId)]] as [label, value] (label)}<dt class="text-muted-foreground">{label}</dt><dd>{value}</dd>{/each}
        </dl>
        <h3 class="mb-2 mt-6 font-semibold">Review history</h3>
        {#if info.revlog.length}
          <table class="w-full text-left text-xs"><thead><tr class="border-b"><th class="py-2">Date</th><th>Rating</th><th>Interval</th><th>Time</th></tr></thead><tbody>
            {#each info.revlog as entry, index (index)}<tr class="border-b"><td class="py-2">{new Date(Number(entry.time) * 1000).toLocaleString()}</td><td>{ratingNames[entry.buttonChosen - 1] ?? "Manual"}</td><td>{entry.interval >= 86400 ? `${Math.round(entry.interval / 86400)} days` : `${entry.interval} sec`}</td><td>{entry.takenSecs.toFixed(1)} sec</td></tr>{/each}
          </tbody></table>
        {:else}<p class="text-muted-foreground">No reviews yet.</p>{/if}
      {:else}<p class="text-muted-foreground">Loading card information…</p>{/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
