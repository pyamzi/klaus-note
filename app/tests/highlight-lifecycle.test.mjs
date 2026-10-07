// Headless DOM regression against the real highlighter, without a Collection.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KLAUS_PLAYWRIGHT || 'playwright');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/browse/highlight.ts', import.meta.url))],
  bundle: true, write: false, format: 'iife', globalName: 'highlighter', platform: 'browser',
});

test('replaced editor fields release observed roots without changing content or caret', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<iframe title="Editor"></iframe>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const frame = document.querySelector('iframe');
      const doc = frame.contentDocument, win = frame.contentWindow;
      const NativeObserver = win.MutationObserver, NativeHighlight = win.Highlight;
      if (!win.CSS?.highlights || !NativeHighlight) throw new Error('Highlight fixture requires Custom Highlight support');
      const observers = [];
      win.MutationObserver = class extends NativeObserver {
        targets = new Set();
        constructor(callback) { super(callback); observers.push(this); }
        observe(target, options) { super.observe(target, options); this.targets.add(target); }
        disconnect() { super.disconnect(); this.targets.clear(); }
      };
      let paints = 0;
      win.Highlight = class extends NativeHighlight {
        constructor(...ranges) { super(...ranges); paints++; }
      };
      function field() {
        const host = doc.createElement('div');
        const root = host.attachShadow({ mode: 'open' });
        const editable = doc.createElement('div');
        editable.contentEditable = 'true';
        editable.innerHTML = '<b>kidney</b> answer';
        root.append(editable); doc.body.append(host);
        return { host, root, editable };
      }
      const first = field(), second = field();
      first.editable.focus();
      const text = first.editable.querySelector('b').firstChild;
      const selection = first.root.getSelection();
      selection.setBaseAndExtent(text, 2, text, 2);
      const before = first.editable.innerHTML;
      const stop = highlighter.highlightEditor(frame, () => ['kidney']);
      const retired = [];
      window.fixture = {
        removeSecond() { retired.push(second.root); second.host.remove(); return paints; },
        replaceSecond() { const next = field(); retired.push(next.root); return { next, paints }; },
        remove(next) { next.host.remove(); return paints; },
        snapshot() {
          const targets = observers.flatMap(observer => [...observer.targets]);
          return {
            paints, observed: targets.length,
            detached: targets.filter(root => !root.isConnected).length,
            staleStyles: retired.filter(root => !root.isConnected).reduce((n, root) => n + root.querySelectorAll('style').length, 0),
            connectedStyles: doc.head.querySelectorAll('style').length + [...doc.body.children].reduce((n, host) => n + (host.shadowRoot?.querySelectorAll('style').length || 0), 0),
            html: first.editable.innerHTML,
            caret: selection.anchorNode === text && selection.focusNode === text && selection.anchorOffset === 2 && selection.focusOffset === 2,
            highlighted: win.CSS.highlights.get('klaus-search')?.size || 0,
          };
        },
        stop, before,
        unsupported() {
          win.Highlight = undefined;
          const count = observers.length;
          highlighter.highlightEditor(frame, () => ['kidney'])();
          return observers.length === count;
        },
      };
    });
    assert.equal((await page.evaluate(() => fixture.snapshot())).observed, 3);
    const paints = await page.evaluate(() => fixture.removeSecond());
    await page.waitForFunction(previous => fixture.snapshot().paints > previous, paints);
    let state = await page.evaluate(() => fixture.snapshot());
    assert.equal(state.detached, 0, 'Detached field shadow root remains observed');
    assert.equal(state.staleStyles, 0, 'Detached field retains highlight style');
    assert.equal(state.observed, 2);
    for (let cycle = 0; cycle < 4; cycle++) {
      const previous = await page.evaluate(() => { fixture.replacement = fixture.replaceSecond(); return fixture.replacement.paints; });
      await page.waitForFunction(paintsBefore => fixture.snapshot().paints > paintsBefore, previous);
      assert.equal((await page.evaluate(() => fixture.snapshot())).observed, 3);
      const beforeRemoval = await page.evaluate(() => fixture.remove(fixture.replacement.next));
      await page.waitForFunction(paintsBefore => fixture.snapshot().paints > paintsBefore, beforeRemoval);
      state = await page.evaluate(() => fixture.snapshot());
      assert.equal(state.observed, 2);
      assert.equal(state.detached, 0);
      assert.equal(state.staleStyles, 0);
      assert.equal(state.html, await page.evaluate(() => fixture.before));
      assert(state.caret, 'Highlighting changed the retained field caret');
      assert.equal(state.highlighted, 1);
    }
    await page.evaluate(() => { fixture.stop(); fixture.stop(); });
    state = await page.evaluate(() => fixture.snapshot());
    assert.equal(state.observed, 0);
    assert.equal(state.connectedStyles, 0);
    assert.equal(state.staleStyles, 0);
    assert.equal(state.highlighted, 0);
    assert(state.caret);
    assert(await page.evaluate(() => fixture.unsupported()), 'Unsupported webviews should not create observation or styles');
    assert.equal((await page.evaluate(() => fixture.snapshot())).connectedStyles, 0);
  } finally { await browser.close(); }
});
