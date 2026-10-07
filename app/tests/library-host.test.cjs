const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(require('node:path').join(__dirname, '../static/anki-host.js'), 'utf8');
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const turn = () => new Promise(setImmediate);
function editor({ mode = 'add', answer = false, standalone = false, fetch: fetchImpl, loaded = Promise.resolve(), loadNote, richText } = {}) {
  const requests = [], prompts = [], messages = [], loads = [], pastes = [], focuses = [], mounts = [];
  const location = { pathname: '/editor/', search: `?mode=${mode}`, hash: '', origin: 'http://localhost' };
  const parent = { location: { href: '/library' }, confirm: text => { prompts.push(text); return answer; }, postMessage: message => messages.push(message) };
  const context = vm.createContext({
    location, parent, Response, Uint8Array, Promise, Set, Error, URLSearchParams, requestAnimationFrame: callback => callback(),
    document: {
      documentElement: { classList: { add() {} } }, querySelectorAll: () => [],
      createElement: () => ({ textContent: '', get innerHTML() { return this.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } }),
    },
    fetch: async (input, init) => { requests.push(input); return fetchImpl ? fetchImpl(input, init) : new Response(new Uint8Array()); },
    addEventListener() {},
    frameElement: { hasAttribute: () => true },
    require: name => name === 'anki/ui' ? { loaded } : richText ?? { lifecycle: { onMount: callback => mounts.push(callback) }, instances: [] },
    loadNote: async args => { loads.push(args); await loadNote?.(args); },
    saveNow: async () => {},
    focusField: field => focuses.push(field),
    pasteHTML: (...args) => pastes.push(args),
  });
  context.window = context;
  if (standalone) context.parent = context;
  vm.runInContext(source, context);
  context.closeAddCards = async () => {
    await context.saveNow();
    return context.fetch('/_anki/closeAddCards', {
      body: context.hasInput ? new Uint8Array([8, 1]) : new Uint8Array(),
    });
  };
  return { context, parent, requests, prompts, messages, loads, pastes, focuses, mounts, host: context.klausNoteEditor,
    async start() { context.pycmd('editorReady'); await context.klausNoteEditor?.ready; } };
}

if (require.main === module) {
test('Library navigation checks Anki input and stays when discard is declined', async () => {
  const e = editor(); await e.start();
  e.context.hasInput = true;
  assert.equal(await e.host.canLeave(), false);
  assert.equal(e.parent.location.href, '/library');
  assert.deepEqual(e.prompts, ['Discard current input?']);
  assert.equal(e.requests.length, 0);
});

test('accepted outer navigation does not also trigger editor Close', async () => {
  const e = editor({ answer: true }); await e.start();
  e.context.hasInput = true;
  assert.equal(await e.host.canLeave(), true);
  assert.equal(e.parent.location.href, '/library');
  assert.equal(e.requests.length, 0);
});

test('empty input leaves without a prompt and repeated checks remain usable', async () => {
  const e = editor(); await e.start();
  assert.equal(await e.host.canLeave(), true);
  e.context.hasInput = true;
  assert.equal(await e.host.canLeave(), false);
  assert.equal(e.prompts.length, 1);
});

test('direct editor Close returns Home after accepted discard only', async () => {
  const e = editor({ answer: true }); await e.start();
  e.context.hasInput = true;
  await e.context.closeAddCards();
  assert.equal(e.parent.location.href, '/');
  assert.equal(e.prompts.length, 1);
  assert.equal(e.requests.length, 0);
});

test('a malformed close check rejects and preserves the draft workspace', async () => {
  const e = editor(); await e.start();
  e.context.closeAddCards = () => e.context.fetch('/_anki/closeAddCards', { body: new Uint8Array([1]) });
  await assert.rejects(e.host.canLeave(), /Could not check/);
  assert.equal(e.parent.location.href, '/library');
});

test('pending Add blocks outer and direct Close until the attempt succeeds', async () => {
  const response = deferred();
  const e = editor({ fetch: () => response.promise }); await e.start();
  const add = e.context.fetch('/_anki/addNote', { body: new Uint8Array() });
  let outerDone = false, directDone = false;
  const outer = e.host.canLeave().then(value => { outerDone = true; return value; });
  const direct = e.context.closeAddCards().then(() => directDone = true);
  await turn();
  assert.equal(outerDone, false); assert.equal(directDone, false);
  assert.equal(e.prompts.length, 0); assert.equal(e.parent.location.href, '/library');
  response.resolve(new Response(new Uint8Array()));
  await add; assert.equal(await outer, true); await direct;
});

test('failed Add remains latched across empty saves and guards both close paths', async () => {
  let succeed = false;
  const e = editor({ fetch: () => new Response(new Uint8Array(), { status: succeed ? 200 : 500 }) }); await e.start();
  await e.context.fetch('/_anki/addNote', { body: new Uint8Array() });
  await assert.rejects(e.host.save(), /could not save/);
  await assert.rejects(e.host.save(), /could not save/);
  await assert.rejects(e.host.canLeave(), /could not save/);
  await assert.rejects(e.context.closeAddCards(), /could not save/);
  assert.equal(e.parent.location.href, '/library'); assert.equal(e.prompts.length, 0);
  succeed = true;
  await e.context.fetch('/_anki/addNote', { body: new Uint8Array() });
  await e.host.save(); assert.equal(await e.host.canLeave(), true);
});

test('Add fields initialize once after UI startup, with hook installed before load', async () => {
  const ui = deferred(), initial = deferred();
  let e;
  e = editor({ loaded: ui.promise, loadNote: async () => { assert.equal(e.mounts.length, 1); await initial.promise; } });
  assert(e.host); let ready = false; e.host.ready.then(() => ready = true);
  e.context.pycmd('editorReady'); e.context.pycmd('editorReady');
  await turn(); assert.equal(e.loads.length, 0); assert.equal(ready, false);
  ui.resolve(); await turn(); assert.equal(e.loads.length, 1); assert.equal(ready, false);
  initial.resolve(); await e.host.ready; assert.equal(ready, true);
  e.context.pycmd('editorReady'); await turn(); assert.equal(e.loads.length, 1);
});

for (const mode of ['add', 'browser']) {
  test(`${mode} fields use native caret for unsupported shadow selection and remove listeners`, async () => {
    const e = editor({ mode }); await e.start();
    assert.equal(e.mounts.length, 1);
    let flushes = 0, focus, removed = false;
    const element = {
      getRootNode: () => ({}),
      addEventListener: (name, listener, capture) => { assert.equal(name, 'focus'); assert(capture); focus = listener; },
      removeEventListener: (name, listener, capture) => { assert.equal(name, 'focus'); assert.equal(listener, focus); assert(capture); removed = true; },
    };
    const cleanup = await e.mounts[0]({ element: Promise.resolve(element), editable: { focusHandler: { flushCaret: () => flushes++ } } });
    assert.equal(flushes, 1); focus(); assert.equal(flushes, 2); cleanup(); assert(removed);
    // The registered callback remains available for replacement fields.
    await e.mounts[0]({ element: Promise.resolve(element), editable: { focusHandler: { flushCaret: () => flushes++ } } });
    assert.equal(flushes, 3);
  });
}

test('supported shadow selection retains Anki restoration unchanged', async () => {
  const e = editor(); await e.start();
  const element = { getRootNode: () => ({ getSelection() {} }), addEventListener: () => assert.fail('Supported selection must retain existing handlers') };
  assert.equal(await e.mounts[0]({ element: Promise.resolve(element) }), undefined);
});

test('missing optional RichTextInput API still initializes and inserts via focusField', async () => {
  const e = editor({ richText: {} }); await e.start();
  e.context.pycmd('focus:1'); await e.host.insertText('Text');
  assert.deepEqual(e.focuses, [1]);
  assert.deepEqual(e.pastes[0], ['Text', false, false]);
});

test('insertion escapes plain text and focuses the actual RichTextInput instance', async () => {
  let focused = 0, flushes = 0;
  const target = { getRootNode: () => ({}) };
  const input = { element: Promise.resolve(target), editable: { focusHandler: { flushCaret: () => flushes++ } }, focus: async () => focused++ };
  const e = editor({ richText: { instances: [input] } }); await e.start();
  e.context.document.querySelectorAll = () => [{}, { shadowRoot: { querySelector: () => target } }];
  e.context.pycmd('focus:1'); await e.host.insertText('<script>&\nNext');
  assert.equal(focused, 1); assert.equal(flushes, 1);
  assert.deepEqual(e.pastes[0], ['&lt;script&gt;&amp;<br>Next', false, false]);
  assert.equal(e.focuses.length, 0);
});

test('standalone Add retains its original initialization and native Close handling', async () => {
  const e = editor({ standalone: true });
  assert.equal(e.host, undefined);
  e.context.pycmd('editorReady'); await turn();
  assert.equal(e.loads.length, 1); assert.equal(e.mounts.length, 0);
  await e.context.closeAddCards();
  assert.deepEqual(e.requests, ['/_anki/closeAddCards']);
});

test('startup failure rejects readiness without resetting on repeated editorReady', async () => {
  const e = editor({ loadNote: async () => { throw new Error('initial load failed'); } });
  e.context.pycmd('editorReady');
  await assert.rejects(e.host.ready, /initial load failed/);
  e.context.pycmd('editorReady'); await turn(); assert.equal(e.loads.length, 1);
});

}
module.exports = { editor, deferred, turn };
