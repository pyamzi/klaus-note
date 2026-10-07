import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/lib/editor/note-editor.ts'], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'scratch-backend', setup(build) {
  build.onResolve({ filter: /^@generated\/backend$/ }, () => ({ path: 'backend', namespace: 'scratch' }));
  build.onLoad({ filter: /.*/, namespace: 'scratch' }, () => ({ contents: 'export const getNote = args => globalThis.lookupNote(args);' }));
} }] });
const { noteEditor } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture(mode='existing', overrides={}, present=true) {
  const events = new EventTarget(), frame = new EventTarget(), calls=[];
  globalThis.addEventListener = events.addEventListener.bind(events);
  globalThis.removeEventListener = events.removeEventListener.bind(events);
  globalThis.location = { origin: 'http://scratch' };
  globalThis.lookupNote = async ({nid}) => ({ notetypeId: nid + 100n });
  const host = { ready: Promise.resolve(), save: async()=>{calls.push('save');}, loadNote: async target=>{calls.push(target);}, insertText: async text=>{calls.push(text);}, canLeave: async()=>false, ...overrides };
  frame.contentWindow = { klausNoteEditor: present ? host : undefined }; frame.focus = ()=>calls.push('focus');
  let editor, ready=0, updated=0, preview=0; const busy=[];
  const action = noteEditor(frame, { mode, attach: value=>editor=value, onready:()=>ready++, onupdated:()=>updated++, onpreview:()=>preview++, onbusy:value=>busy.push(value) });
  function message(command, origin='http://scratch', source=frame.contentWindow) {
    const event = new Event('message'); Object.assign(event, { origin, source, data: { klausEditor: command } }); events.dispatchEvent(event);
  }
  return { frame, host, calls, action, message, busy, get editor(){return editor;}, get ready(){return ready;}, get updated(){return updated;}, get preview(){return preview;} };
}
test('attaching after readiness and duplicate notifications loads once with Study context', async()=>{
  const f=fixture(); f.message('editorReady'); f.message('editorReady');
  assert.equal(await f.editor.show(1n,{cardId:2n,deckId:3n}), true);
  assert.deepEqual(f.calls, ['save',{noteId:1n,notetypeId:101n,cardId:2n,deckId:3n}]); assert.equal(f.ready,1); assert.deepEqual(f.busy,[true,false]); f.action.destroy();
});
test('operation waits for host published later and its retained readiness',async()=>{
  const gate=deferred(), f=fixture('existing',{ready:gate.promise},false);
  const show=f.editor.show(1n); await turn(); assert.deepEqual(f.calls,[]);
  f.frame.contentWindow.klausNoteEditor=f.host; f.message('editorReady'); await turn(); assert.deepEqual(f.calls,[]);
  gate.resolve(); assert.equal(await show,true); f.action.destroy();
});
test('latest selection wins while an earlier Note lookup is delayed',async()=>{
  const gate=deferred(), f=fixture(); const first=f.editor.show(gate.promise); await turn();
  const second=f.editor.show(2n); gate.resolve(1n);
  assert.equal(await first,false); assert.equal(await second,true);
  assert.deepEqual(f.calls.filter(call=>typeof call==='object').map(call=>call.noteId),[2n]); f.action.destroy();
});
test('loads serialize even when selection changes during an upstream load',async()=>{
  const gate=deferred(), loads=[], f=fixture('existing',{loadNote:async target=>{loads.push(target.noteId); if(target.noteId===1n) await gate.promise;}});
  const first=f.editor.show(1n); await turn(); assert.deepEqual(loads,[1n]);
  const second=f.editor.show(2n); await turn(); assert.deepEqual(loads,[1n]); gate.resolve();
  assert.equal(await first,false); assert.equal(await second,true); assert.deepEqual(loads,[1n,2n]); f.action.destroy();
});
test('failed saves prevent switching and settling, then acknowledged recovery works',async()=>{
  let failed=true; const f=fixture('existing',{save:async()=>{if(failed)throw new Error('save failure');}});
  await assert.rejects(f.editor.show(1n),/save failure/); await assert.rejects(f.editor.settle(),/save failure/);
  assert.deepEqual(f.calls,[]); failed=false; assert.equal(await f.editor.show(2n),true); assert.equal(await f.editor.settle(),true); f.action.destroy();
});
test('Add exposes real discard decision and forwards insertion after focus',async()=>{
  const f=fixture('add'); assert.equal(await f.editor.settle(),false); await f.editor.insert('<text>\nnext');
  assert.deepEqual(f.calls,['focus','<text>\nnext']); assert.deepEqual(f.busy,[true,false]); await assert.rejects(f.editor.show(1n),/Add editor/); f.action.destroy();
});
test('messages require exact origin and frame and stop after disposal',async()=>{
  const f=fixture(); f.message('noteUpdated','http://other'); f.message('preview','http://scratch',{}); assert.equal(f.updated,0); assert.equal(f.preview,0);
  f.message('noteUpdated'); f.message('preview'); assert.equal(f.updated,1); assert.equal(f.preview,1); f.action.destroy(); f.message('noteUpdated'); assert.equal(f.updated,1); assert.equal(f.editor,undefined);
});
test('disposal rejects pending readiness and leaves no late callbacks',async()=>{
  const gate=deferred(), f=fixture('existing',{ready:gate.promise}); const editor=f.editor;
  const operation=editor.show(1n); f.action.destroy(); await assert.rejects(operation,{name:'AbortError'}); gate.resolve(); await turn(); assert.equal(f.ready,0); assert.deepEqual(f.calls,[]); await assert.rejects(editor.settle(),{name:'AbortError'});
});
test('missing host on frame load and failed initialization reject operations',async()=>{
  const f=fixture('existing',{},false); f.frame.dispatchEvent(new Event('load')); await assert.rejects(f.editor.settle(),/unavailable/); f.action.destroy();
  const gate=deferred(), g=fixture('add',{ready:gate.promise}); const op=g.editor.insert('text'); gate.reject(new Error('initialization failed')); await assert.rejects(op,/initialization failed/); g.action.destroy();
});
test('replaced frame cannot silently save through a stale host',async()=>{
  const f=fixture(); await f.editor.show(1n); f.frame.contentWindow={}; await assert.rejects(f.editor.settle(),/frame changed/); f.action.destroy();
});
test('settling for bulk actions finishes a pending selection rather than cancelling it',async()=>{
  const gate=deferred(), f=fixture(); const show=f.editor.show(gate.promise); await turn();
  const settle=f.editor.settle(); gate.resolve(1n); assert.equal(await show,true); assert.equal(await settle,true);
  assert.deepEqual(f.calls,['save',{noteId:1n,notetypeId:101n},'save']); f.action.destroy();
});
test('stale lookup failure is suppressed without swallowing current failures',async()=>{
  const gate=deferred(), f=fixture(); const first=f.editor.show(gate.promise); await turn();
  const second=f.editor.show(2n); gate.reject(new Error('stale lookup')); assert.equal(await first,false); assert.equal(await second,true);
  await assert.rejects(f.editor.show(Promise.reject(new Error('current lookup'))),/current lookup/); f.action.destroy();
});
test('disposal during load rejects without a late shown notification',async()=>{
  const gate=deferred(), f=fixture('existing',{loadNote:async()=>gate.promise}); const show=f.editor.show(1n); await turn();
  f.action.destroy(); await assert.rejects(show,{name:'AbortError'}); gate.resolve(); await turn(); assert.equal(f.editor,undefined);
});
