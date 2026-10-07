const assert = require('node:assert/strict');
const { test } = require('node:test');
const { editor, deferred, turn } = require('./library-host.test.cjs');

async function existing(options = {}) {
  const e = editor({ mode: 'browser', ...options }); await e.start();
  await e.host.loadNote({ noteId: 1700000000001n, notetypeId: 1700000000002n });
  return e;
}

test('Browser readiness never auto-loads and saving before the first Note is harmless', async () => {
  const e = editor({ mode: 'browser' }); await e.start();
  e.context.saveNow = () => assert.fail('No Note loaded');
  await e.host.save(); assert.equal(e.loads.length, 0);
  assert.equal(await e.host.canLeave(), true);
  assert.equal(e.context.klausWaitForNoteSaves, undefined);
  assert.equal(e.context.klausConfirmAddClose, undefined);
});

test('Study Note loading preserves bigint IDs, Card context and focus', async () => {
  const e = editor({ mode: 'browser' }); await e.start();
  await e.host.loadNote({ noteId: 1700000000001n, notetypeId: 1700000000002n, cardId: 1700000000003n, deckId: 1n });
  assert.equal(e.loads[0].nid, 1700000000001n);
  assert.equal(e.loads[0].reviewerCardId, 1700000000003n);
  assert.equal(e.loads[0].deckId, 1n); assert.equal(e.loads[0].focusTo, 0);
});

test('failed first load leaves pre-load saves harmless', async () => {
  const e = editor({ mode: 'browser', loadNote: async () => { throw new Error('missing Note'); } }); await e.start();
  await assert.rejects(e.host.loadNote({ noteId: 1n, notetypeId: 2n }), /missing Note/);
  e.context.saveNow = () => assert.fail('No Note loaded');
  await e.host.save();
});

test('save waits for unawaited tag writes and preserves Note update notification', async () => {
  const response = deferred();
  const e = await existing({ fetch: () => response.promise });
  e.context.saveNow = async () => { void e.context.fetch('/_anki/updateNotes', { body: new Uint8Array([1]) }); };
  let done = false;
  const saved = e.host.save().then(() => done = true);
  await turn(); assert.equal(done, false); assert.equal(e.requests.length, 1);
  response.resolve(new Response(new Uint8Array())); await saved;
  assert.equal(e.messages.filter(message => message.klausEditor === 'noteUpdated').length, 1);
});

test('failed write stays latched across clean drains and clears on acknowledged recovery only', async () => {
  let succeed = false;
  const e = await existing({ fetch: () => new Response(new Uint8Array(), { status: succeed ? 200 : 500 }) });
  await e.context.fetch('/_anki/updateNotes', { body: new Uint8Array([1]) });
  await assert.rejects(e.host.save(), /HTTP 500/);
  await assert.rejects(e.host.save(), /HTTP 500/);
  await assert.rejects(e.host.canLeave(), /HTTP 500/);
  assert.equal(e.messages.filter(message => message.klausEditor === 'noteUpdated').length, 0);
  succeed = true;
  const recovered = e.context.fetch('/_anki/updateNotes', { body: new Uint8Array([2]) });
  await recovered; await e.host.save(); assert.equal(await e.host.canLeave(), true);
});

test('write requests serialize whole-Note snapshots without replay after failure', async () => {
  const first = deferred(), second = deferred();
  const calls = [];
  const e = await existing({ fetch: (url, init) => { calls.push(init.body[0]); return calls.length === 1 ? first.promise : second.promise; } });
  const one = e.context.fetch('/_anki/updateNotes', { body: new Uint8Array([1]) });
  const two = e.context.fetch('/_anki/updateNotes', { body: new Uint8Array([2]) });
  await turn(); assert.deepEqual(calls, [1]);
  first.resolve(new Response(new Uint8Array(), { status: 500 })); await one;
  await turn(); assert.deepEqual(calls, [1, 2]);
  let drained = false;
  const saved = e.host.save().then(() => drained = true);
  await turn(); assert.equal(drained, false);
  second.resolve(new Response(new Uint8Array())); await two; await saved;
  assert.deepEqual(calls, [1, 2]);
});

test('network failure is retained even when upstream catches its own request error', async () => {
  const e = await existing({ fetch: () => Promise.reject(new Error('offline')) });
  await e.context.fetch('/_anki/updateNotes').catch(() => {});
  await assert.rejects(e.host.save(), /offline/);
  await assert.rejects(e.host.canLeave(), /offline/);
});

test('Browser direct close keeps its native endpoint while host canLeave saves', async () => {
  const e = await existing();
  let saves = 0; e.context.saveNow = async () => saves++;
  assert.equal(await e.host.canLeave(), true); assert.equal(saves, 1);
  await e.context.closeAddCards();
  assert.deepEqual(e.requests, ['/_anki/closeAddCards']);
});
