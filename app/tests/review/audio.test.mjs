import assert from "node:assert/strict";
import { test } from "node:test";
import { ReviewAudio, clickedTag, mediaUrl } from "../../src/lib/review/audio.ts";

const tag = (name) => ({ value: { case: "soundOrVideo", value: name } });

test("media references stay inside the collection media directory", () => {
  for (const name of ["../private.mp3", "folder/file.mp3", "folder\\file.mp3", "https:evil", "file:secret", "..", "", "bad\0name"]) assert.equal(mediaUrl(name), undefined);
  assert.equal(mediaUrl("heart beat #1.mp3"), "/heart%20beat%20%231.mp3");
  assert.equal(mediaUrl("%2e%2e.mp3"), "/%252e%252e.mp3");
});

test("card commands only reference extracted audio by side and valid index", () => {
  const q = [tag("question.mp3")], a = [tag("answer.mp3")];
  assert.equal(clickedTag("play:q:0", q, a), q[0]);
  assert.equal(clickedTag("play:a:0", q, a), a[0]);
  for (const command of ["play:q:1", "play:a:-1", "play:file:///etc/passwd", "play:q:0x0", "play:q:0\n", "play:answer:0"]) assert.equal(clickedTag(command, q, a), undefined);
});

test("audio queue honors interrupt, replaces pending clips, and stops when leaving", async () => {
  const made = [];
  class FakeAudio {
    onended = null;
    onerror = null;
    paused = false;
    constructor(src) { this.src = src; made.push(this); }
    play() { return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute() {}
    load() {}
  }
  const original = globalThis.Audio;
  (globalThis).Audio = FakeAudio;
  try {
    const errors = [];
    const player = new ReviewAudio((error) => errors.push(error));
    player.play([tag("q.mp3"), tag("discard.mp3")]);
    assert.equal(made.length, 1);
    player.play([tag("answer.mp3")], false);
    assert.equal(made.length, 1);
    assert.equal(made[0].paused, false);
    made[0].onended?.();
    assert.equal(made[1].src, "/answer.mp3");
    player.play([tag("replay.mp3")], true);
    assert.equal(made[1].paused, true);
    assert.equal(made[2].src, "/replay.mp3");
    player.stop();
    assert.equal(made[2].paused, true);
    assert.equal(made[2].onended, null);
    assert.deepEqual(errors, []);
  } finally { globalThis.Audio = original; }
});
