import type { AVTag } from "@generated/anki/card_rendering_pb";

/** Collection media is a single directory. Never let a deck name a URL or path. */
export function mediaUrl(filename: string): string | undefined {
  if (!filename || /[/\\\x00-\x1f]/.test(filename) || filename === "." || filename === ".." || /^[a-z][a-z\d+.-]*:/i.test(filename)) return;
  return `/${encodeURIComponent(filename)}`;
}

export function clickedTag(command: string, question: AVTag[], answer: AVTag[]): AVTag | undefined {
  const match = /^play:([qa]):(\d+)$/.exec(command);
  return match ? (match[1] === "q" ? question : answer)[Number(match[2])] : undefined;
}

/** One queue for the trusted reviewer. Card scripts can only reference extracted tags. */
export class ReviewAudio {
  private queue: AVTag[] = [];
  private cancelCurrent: (() => void) | undefined;
  private report: (message: string) => void;
  constructor(report: (message: string) => void) { this.report = report; }

  play(tags: AVTag[], interrupt = true) {
    this.queue = [];
    if (interrupt) this.stop();
    this.queue = tags.slice();
    this.next();
  }

  stop() {
    this.queue = [];
    this.cancelCurrent?.();
    this.cancelCurrent = undefined;
  }

  private next() {
    if (this.cancelCurrent) return;
    const tag = this.queue.shift();
    if (!tag) return;
    const complete = () => { this.cancelCurrent = undefined; this.next(); };
    if (tag.value.case === "soundOrVideo") {
      const url = mediaUrl(tag.value.value);
      if (!url) { this.report("This card's audio filename is not supported."); this.next(); return; }
      const audio = new Audio(url);
      const cancel = () => { audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute("src"); audio.load(); };
      this.cancelCurrent = cancel;
      audio.onended = () => { cancel(); complete(); };
      audio.onerror = () => { cancel(); this.report("Could not play this card's audio. Check that its media was synced."); complete(); };
      audio.play().catch(() => {
        if (this.cancelCurrent !== cancel) return;
        cancel(); this.queue = []; this.report("Audio could not start. Press R or choose Replay Audio to try again."); complete();
      });
    } else if (tag.value.case === "tts") {
      const tts = tag.value.value;
      const synth = globalThis.speechSynthesis;
      const voices = synth?.getVoices().filter((voice) => voice.localService) ?? [];
      const lang = tts.lang.replaceAll("_", "-").toLowerCase();
      const voice = voices.find((v) => tts.voices.includes(v.name)) ?? voices.find((v) => v.lang.toLowerCase() === lang);
      if (!voice) { this.report(`No local speech voice is available for ${tts.lang}.`); this.next(); return; }
      const utterance = new SpeechSynthesisUtterance(tts.fieldText);
      utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = tts.speed || 1;
      this.cancelCurrent = () => { utterance.onend = null; utterance.onerror = null; synth.cancel(); };
      utterance.onend = complete;
      utterance.onerror = () => { this.report("Speech playback failed."); complete(); };
      synth.speak(utterance);
    } else this.next();
  }
}
