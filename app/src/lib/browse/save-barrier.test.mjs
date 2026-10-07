import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editor, deferred, turn } from '../../../tests/library-host.test.cjs';

async function host(options = {}) {
  const e = editor({ mode: 'browser', ...options });
  await e.start();
  await e.host.loadNote({ noteId: 1n, notetypeId: 2n });
  return e;
}

test('save barrier drains tag save even when caller does not await fetch', async () => {
  const response = deferred();
  const e = await host({ fetch: () => response.promise });
  e.context.saveNow = async () => { void e.context.fetch('/_anki/updateNotes'); };
  let drained = false;
  const barrier = e.host.save().then(() => { drained = true; });
  await turn();
  assert.equal(drained, false);
  assert.equal(e.requests.length, 1);
  response.resolve(new Response(new Uint8Array()));
  await barrier;
  assert.equal(drained, true);
  assert.equal(e.messages.filter(message => message.klausEditor === 'noteUpdated').length, 1);
});

test('save barrier waits for every serialized pending Note write', async () => {
  const first = deferred(), second = deferred();
  const e = await host({ fetch: () => e.requests.length === 1 ? first.promise : second.promise });
  const one = e.context.fetch('/_anki/updateNotes');
  const two = e.context.fetch('/_anki/updateNotes');
  let drained = false;
  const barrier = e.host.save().then(() => { drained = true; });
  await turn();
  assert.equal(e.requests.length, 1);
  first.resolve(new Response(new Uint8Array()));
  await one; await turn();
  assert.equal(e.requests.length, 2);
  assert.equal(drained, false);
  second.resolve(new Response(new Uint8Array()));
  await two; await barrier;
  assert.equal(drained, true);
});

test('caught failed save remains visible until an acknowledged later Note write', async () => {
  let succeed = false;
  const retryResponse = deferred();
  const e = await host({ fetch: () => succeed ? retryResponse.promise : new Response(new Uint8Array(), { status: 500 }) });
  await e.context.fetch('/_anki/updateNotes');
  await assert.rejects(e.host.save(), /HTTP 500/);
  await assert.rejects(e.host.save(), /HTTP 500/);
  await assert.rejects(e.host.canLeave(), /HTTP 500/);
  assert.equal(e.messages.filter(message => message.klausEditor === 'noteUpdated').length, 0);
  succeed = true;
  const retry = e.context.fetch('/_anki/updateNotes');
  let drained = false;
  const barrier = e.host.save().then(() => { drained = true; });
  await turn(); assert.equal(drained, false);
  retryResponse.resolve(new Response(new Uint8Array()));
  await retry; await barrier;
  assert.equal(await e.host.canLeave(), true);
});

test('caught network failure blocks the save barrier and leaving the Note', async () => {
  const e = await host({ fetch: () => Promise.reject(new Error('network failed')) });
  await e.context.fetch('/_anki/updateNotes').catch(() => {});
  await assert.rejects(e.host.save(), /network failed/);
  await assert.rejects(e.host.canLeave(), /network failed/);
});

test('an earlier successful write cannot hide a later failed Note write', async () => {
  const first = deferred(), second = deferred();
  const e = await host({ fetch: () => e.requests.length === 1 ? first.promise : second.promise });
  const one = e.context.fetch('/_anki/updateNotes');
  const two = e.context.fetch('/_anki/updateNotes');
  await turn();
  first.resolve(new Response(new Uint8Array()));
  await one; await turn();
  second.resolve(new Response(new Uint8Array(), { status: 500 }));
  await two;
  await assert.rejects(e.host.save(), /HTTP 500/);
  await assert.rejects(e.host.canLeave(), /HTTP 500/);
});
