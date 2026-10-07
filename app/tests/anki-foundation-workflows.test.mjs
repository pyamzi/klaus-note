// Build the frontend/headless bridge before running. This test never copies or
// changes built resources. Every case owns a disposable Collection under /tmp.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const playwright = require(process.env.KLAUS_PLAYWRIGHT || 'playwright');
const engine = process.env.KLAUS_TEST_BROWSER || 'chromium';
assert(['chromium', 'webkit'].includes(engine));
const fixtures = await mkdtemp(join(tmpdir(), 'klaus-foundation-protos-'));
await build({ stdin: { contents: ['generic', 'notes', 'notetypes', 'cards', 'scheduler', 'stats', 'collection'].map(name => `export * from './vendor/anki/out/ts/lib/generated/anki/${name}_pb';`).join('\n'), resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', outfile: join(fixtures, 'proto.cjs') });
const { Empty, Json, Note, NoteId, NotetypeId, NotetypeNames, AddNoteRequest, AddNoteResponse, CardIds, CardId, Card, CardStatsResponse, BuryOrSuspendCardsRequest, CongratsInfoResponse, GetQueuedCardsRequest, QueuedCards } = require(join(fixtures, 'proto.cjs'));
after(() => rm(fixtures, { recursive: true, force: true }));
const only = process.env.KLAUS_FOUNDATION_CASE;

async function scratchCase(run) {
  const directory = await mkdtemp(join(tmpdir(), 'klaus-foundation-test-'));
  const server = spawn(join(root, 'target/debug/examples/headless'), [directory], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  try {
    const auth = await new Promise((resolveURL, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Scratch bridge did not start')), 15000);
      server.once('error', error => { clearTimeout(timer); reject(error); });
      server.once('exit', code => { clearTimeout(timer); reject(new Error(`Scratch bridge exited ${code}`)); });
      server.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/KlausNote dev URL: (\S+)/);
        if (match) { clearTimeout(timer); resolveURL(match[1]); }
      });
    });
    const base = new URL(auth).origin;
    browser = await playwright[engine].launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(12000);
    page.on('dialog', dialog => dialog.accept());
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    // The session credential is deliberately never printed, including failures.
    try { await page.goto(auth); } catch { throw new Error('Scratch authentication failed'); }
    const rpc = async (method, input, Output) => {
      const response = await page.request.post(`${base}/_anki/${method}`, { headers: { 'Content-Type': 'application/binary' }, data: Buffer.from(input.toBinary()) });
      assert(response.ok(), `${method}: HTTP ${response.status()}`);
      return Output.fromBinary(await response.body());
    };
    const seed = async (front, back) => {
      const names = await rpc('getNotetypeNames', new Empty(), NotetypeNames);
      const basic = names.entries.find(entry => entry.name === 'Basic');
      assert(basic, 'Scratch Basic notetype missing');
      const note = await rpc('newNote', new NotetypeId({ ntid: basic.id }), Note);
      note.fields = [front, back];
      const added = await rpc('addNote', new AddNoteRequest({ note, deckId: 1n }), AddNoteResponse);
      const cards = await rpc('cardsOfNote', new NoteId({ nid: added.noteId }), CardIds);
      assert.equal(cards.cids.length, 1);
      return cards.cids[0];
    };
    await run({ page, base, rpc, seed });
    assert.deepEqual(errors, [], 'Unexpected frontend errors');
  } finally {
    await browser?.close();
    if (server.exitCode === null) {
      const closed = new Promise(resolveExit => server.once('exit', resolveExit));
      server.kill();
      await closed;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

test('Browser preview accepts its opaque Card frame and rejects unrelated frames', { skip: only && only !== 'preview' }, () => scratchCase(async ({ page, base, seed }) => {
  await seed('Foundation preview question', 'Foundation preview answer');
  await page.goto(`${base}/browse`);
  await page.getByRole('grid', { name: 'Search results', exact: true }).locator('tr[aria-rowindex]').filter({ hasText: 'Foundation preview question' }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.frameLocator('iframe[title="Card preview"]');
  await preview.getByText('Foundation preview question', { exact: true }).waitFor();
  const body = preview.locator('body');
  await body.click();
  await body.press('Space');
  await page.getByRole('button', { name: 'Show Question', exact: true }).waitFor();
  await until(() => body.textContent(), value => value.includes('Foundation preview answer'));
  await body.press('Enter');
  await page.getByRole('button', { name: 'Show Answer', exact: true }).waitFor();
  await body.evaluate(() => globalThis.pycmd('ans'));
  await page.getByRole('button', { name: 'Show Question', exact: true }).waitFor();
  await page.evaluate(async () => {
    const unrelated = document.createElement('iframe');
    unrelated.hidden = true; unrelated.sandbox = 'allow-scripts';
    unrelated.srcdoc = `<script>parent.postMessage({klaus:true,cmd:'ans'},'*')<\/script>`;
    const sent = new Promise(resolveSent => {
      const receive = event => { if (event.source === unrelated.contentWindow) { removeEventListener('message', receive); resolveSent(); } };
      addEventListener('message', receive);
    });
    document.body.append(unrelated);
    await sent;
    await new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    unrelated.remove();
  });
  assert.equal(await page.getByRole('button', { name: 'Show Question', exact: true }).count(), 1, 'An unrelated frame must not flip the preview');
}));

test('Committed grade survives successor failure and Retry never submits a second answer', { skip: only && only !== 'grading' }, () => scratchCase(async ({ page, base, rpc, seed }) => {
  const first = await seed('Foundation first question', 'Foundation first answer');
  await seed('Foundation next question', 'Foundation next answer');
  const before = await rpc('cardStats', new CardId({ cid: first }), CardStatsResponse);
  let answers = 0, failNext = false;
  page.on('request', request => { if (request.url().endsWith('/_anki/answerCard')) answers++; });
  await page.route('**/_anki/getQueuedCards', route => {
    if (!failNext) return route.continue();
    failNext = false;
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Forced scratch successor failure' }) });
  });
  await page.goto(`${base}/review?deck=1`);
  const card = page.frameLocator('iframe[title="Card"]');
  await card.getByText('Foundation first question', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Show Answer', exact: true }).click();
  await until(() => card.locator('body').textContent(), value => value.includes('Foundation first answer'));
  failNext = true;
  const failed = page.waitForResponse(response => response.url().endsWith('/_anki/getQueuedCards') && response.status() === 503);
  await page.getByRole('button', { name: /\bGood$/ }).click();
  await failed;
  await page.locator('[data-sonner-toast]').filter({ hasText: 'Review failed' }).waitFor();
  await page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  const committed = await rpc('cardStats', new CardId({ cid: first }), CardStatsResponse);
  assert.equal(committed.revlog.length, before.revlog.length + 1, 'The answer must already be persisted');
  const good = page.getByRole('button', { name: /\bGood$/ });
  assert(!(await good.count()) || !(await good.isEnabled()), 'A committed Card must not remain gradeable after successor failure');
  assert.equal(answers, 1);
  await page.getByRole('button', { name: /^Retry/ }).click();
  await card.getByText('Foundation next question', { exact: true }).waitFor();
  assert.equal(answers, 1, 'Retry must reload the queue rather than answer the previous Card');
  const after = await rpc('cardStats', new CardId({ cid: first }), CardStatsResponse);
  assert.equal(after.revlog.length, committed.revlog.length, 'Retry must not add another review-log entry');
}));

test('Deck overview selectively restores buried Cards and preserves suspended Cards', { skip: only && only !== 'unbury' }, () => scratchCase(async ({ page, base, rpc, seed }) => {
  const user = await seed('Foundation manually buried', 'Manual answer');
  const sibling = await seed('Foundation buried sibling', 'Sibling answer');
  const suspended = await seed('Foundation suspended', 'Suspended answer');
  const bury = (cid, mode) => rpc('buryOrSuspendCards', new BuryOrSuspendCardsRequest({ cardIds: [cid], mode }), Empty);
  const queue = async cid => (await rpc('getCard', new CardId({ cid }), Card)).queue;
  const overview = () => page.goto(`${base}/?deck=1`);
  await rpc('getQueuedCards', new GetQueuedCardsRequest({ fetchLimit: 1 }), QueuedCards);
  await bury(user, 2); await bury(sibling, 1); await bury(suspended, 0);
  const buried = await rpc('congratsInfo', new Empty(), CongratsInfoResponse);
  assert(buried.haveUserBuried && buried.haveSchedBuried, 'Scratch Collection must contain both burial classes');
  await overview();
  await page.getByRole('button', { name: 'Unbury', exact: true }).click();
  await page.getByRole('button', { name: 'Manually buried cards', exact: true }).click();
  await until(() => queue(user), value => value === 0);
  assert.equal(await queue(sibling), -2); assert.equal(await queue(suspended), -1);
  await overview();
  await page.getByRole('button', { name: 'Unbury', exact: true }).click();
  await until(() => queue(sibling), value => value === 0);
  assert.equal(await queue(suspended), -1);
  await bury(user, 2); await bury(sibling, 1); await overview();
  await page.getByRole('button', { name: 'Unbury', exact: true }).click();
  await page.getByRole('button', { name: 'Buried siblings', exact: true }).click();
  await until(() => queue(sibling), value => value === 0);
  assert.equal(await queue(user), -3); assert.equal(await queue(suspended), -1);
  await bury(sibling, 1); await overview();
  await page.getByRole('button', { name: 'Unbury', exact: true }).click();
  await page.getByRole('button', { name: 'All buried cards', exact: true }).click();
  await until(async () => [await queue(user), await queue(sibling)], value => value.every(queue => queue === 0));
  assert.equal(await queue(suspended), -1);
  const flags = await rpc('congratsInfo', new Empty(), CongratsInfoResponse);
  assert(!flags.haveUserBuried && !flags.haveSchedBuried);
}));

test('Browser retention retries failed rows on revisit without spinning while stationary', { skip: only && only !== 'retention' }, () => scratchCase(async ({ page, base, seed }) => {
  const first = await seed('Retention specimen 000', 'Retention answer');
  for (let index = 1; index < 100; index++) await seed(`Retention specimen ${String(index).padStart(3, '0')}`, 'Retention answer');
  const attempts = [];
  let failing = true;
  await page.route('**/_anki/klausBrowserRetention', route => {
    const input = Json.fromBinary(route.request().postDataBuffer());
    attempts.push(JSON.parse(new TextDecoder().decode(input.json)).ids);
    return failing ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Forced scratch retention failure' }) }) : route.continue();
  });
  await page.goto(`${base}/browse`);
  const grid = page.getByRole('grid', { name: 'Search results', exact: true });
  const top = grid.locator('tr[aria-rowindex]').filter({ hasText: 'Retention specimen 000' });
  await top.waitFor();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Retention', exact: true }).click();
  await page.keyboard.press('Escape');
  await top.getByText('Unavailable', { exact: true }).waitFor();
  const topAttempts = () => attempts.filter(ids => ids.includes(String(first))).length;
  await page.waitForLoadState('networkidle');
  const stationary = topAttempts();
  await page.waitForTimeout(500);
  assert.equal(topAttempts(), stationary, 'Permanent failures must not automatically retry the same stationary rows');
  failing = false;
  await grid.locator('..').evaluate(container => container.scrollTop = container.scrollHeight);
  await grid.locator('tr[aria-rowindex]').filter({ hasText: 'Retention specimen 099' }).getByText('No score', { exact: true }).waitFor();
  await grid.locator('..').evaluate(container => container.scrollTop = 0);
  await top.getByText('No score', { exact: true }).waitFor();
  assert.equal(topAttempts(), stationary + 1, 'Revisiting failed rows must retry once and obtain their real score');
}));

async function until(read, matches) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await read();
    if (matches(value)) return;
    await new Promise(resolveTurn => setTimeout(resolveTurn, 50));
  }
  assert.fail('Expected persisted state did not arrive');
}
