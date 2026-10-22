import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/split-controller.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { SplitController } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const row = (id, blank = false, mainView = false) => ({ id, blank, mainView });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture(options = {}) {
  let catalog = { ready: options.ready ?? true, sessions: options.rows ?? [row('alpha', true, true), row('history')] };
  const listeners = new Set();
  const events = [];
  const records = [];
  const failures = new Map();
  const readiness = new Map();
  let openFailure;
  let activationFailure;
  let catalogFailure;
  let active = 0;
  let unsubscribeCount = 0;
  let controller;
  const emit = () => { for (const listener of [...listeners]) listener(); };
  const select = (id) => {
    catalog = { ...catalog, sessions: catalog.sessions.map(value => ({ ...value, mainView: value.id === id })) };
    emit();
  };
  controller = new SplitController({
    catalog: () => { if (catalogFailure) throw catalogFailure; return catalog; },
    subscribeCatalog(listener) {
      listeners.add(listener);
      if (options.emitOnSubscribe) listener();
      return () => { unsubscribeCount += 1; listeners.delete(listener); };
    },
    retain(id) {
      events.push(['retain', id]);
      if (failures.has(id)) throw failures.get(id);
      const record = { id, releases: 0 };
      records.push(record);
      const reference = {
        ready: readiness.get(id)?.promise ?? Promise.resolve(),
        release() {
          events.push(['release', id]);
          record.releases += 1;
          if (options.reentrant) emit();
        },
      };
      record.reference = reference;
      if (options.reentrant) emit();
      return reference;
    },
    open(id) {
      events.push(['open', id]);
      if (openFailure) throw openFailure;
      if (options.autoOpen) select(id);
    },
    activate() {
      events.push(['activate']);
      if (activationFailure) throw activationFailure;
      active += 1;
      if (options.reentrant) emit();
      return () => { events.push(['deactivate']); active -= 1; if (options.reentrant) emit(); };
    },
  });
  return {
    controller, events, records, failures, readiness,
    get active() { return active; },
    get unsubscribeCount() { return unsubscribeCount; },
    get catalog() { return catalog; },
    get held() { return records.filter(record => !record.releases).map(record => record.id).sort(); },
    setOpenFailure(error) { openFailure = error; },
    setActivationFailure(error) { activationFailure = error; },
    setCatalogFailure(error) { catalogFailure = error; },
    set(rows, ready = catalog.ready) { catalog = { ready, sessions: rows }; emit(); },
    add(id, blank = true) { catalog = { ...catalog, sessions: [...catalog.sessions, row(id, blank)] }; emit(); },
    select, emit,
    newSession(id) {
      this.add(id);
      this.set(this.catalog.sessions.map(value => value.id === id ? { ...value, mainView: true } : value));
      select(id);
    },
  };
}

test('initial ready catalog remains native and retains its current draft once', () => {
  const f = fixture({ emitOnSubscribe: true });
  assert.deepEqual(f.controller.getSnapshot(), { ids: [] });
  assert.deepEqual(f.held, ['alpha']);
  assert.equal(f.controller.ref('alpha'), f.records[0].reference);
  const initial = f.controller.getSnapshot();
  f.emit();
  assert.equal(f.controller.getSnapshot(), initial);
  assert.deepEqual(f.events, [['retain', 'alpha']]);
  f.controller.dispose();
  f.controller.dispose();
  assert.equal(f.unsubscribeCount, 1);
  assert.equal(f.records[0].releases, 1);
  assert.deepEqual(f.held, []);
});

test('first ready catalog establishes a baseline and does not split old blanks', () => {
  const f = fixture({ ready: false, rows: [] });
  f.set([row('alpha', true, true), row('old-empty', true)], true);
  f.select('old-empty');
  assert.deepEqual(f.controller.getSnapshot().ids, []);
  assert.deepEqual(f.held, ['old-empty']);
  assert.equal(f.active, 0);
  f.newSession('fresh');
  assert.deepEqual(f.controller.getSnapshot().ids, ['old-empty', 'fresh']);
  f.controller.dispose();
});

test('new blank waits for native selection to settle, preserving the original draft', () => {
  const f = fixture();
  const original = f.controller.ref('alpha');
  f.add('beta');
  assert.deepEqual(f.controller.getSnapshot().ids, []);
  assert.deepEqual(f.held, ['alpha']);
  f.set(f.catalog.sessions.map(value => value.id === 'beta' ? { ...value, mainView: true } : value));
  assert.deepEqual(f.controller.getSnapshot().ids, []);
  assert.deepEqual(f.held, ['alpha']);
  f.select('beta');
  assert.deepEqual(f.controller.getSnapshot().ids, ['alpha', 'beta']);
  assert.equal(f.controller.ref('alpha'), original);
  assert.deepEqual(f.held, ['alpha', 'beta']);
  assert.deepEqual(f.events, [['retain', 'alpha'], ['retain', 'beta'], ['activate']]);
  f.controller.dispose();
});

test('new selected blank delivered in one catalog update still splits', () => {
  const f = fixture();
  f.set([row('alpha', true), row('beta', true, true)]);
  assert.deepEqual(f.controller.getSnapshot().ids, ['alpha', 'beta']);
  assert.equal(f.active, 1);
  f.controller.dispose();
});

test('first selected blank with no previous conversation stays native', () => {
  const f = fixture({ rows: [] });
  f.newSession('first');
  assert.deepEqual(f.controller.getSnapshot().ids, []);
  assert.deepEqual(f.held, ['first']);
  assert.equal(f.active, 0);
  f.controller.dispose();
});

test('repeated native New appends once and fifth pane keeps recent four without deleting sessions', () => {
  const f = fixture();
  for (const id of ['beta', 'gamma', 'delta', 'epsilon']) f.newSession(id);
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['beta', 'gamma', 'delta', 'epsilon'], notice: 'limit' });
  assert.deepEqual(f.held, ['beta', 'delta', 'epsilon', 'gamma']);
  assert.equal(f.records.find(record => record.id === 'alpha').releases, 1);
  assert.equal(f.catalog.sessions.some(value => value.id === 'alpha'), true);
  assert.equal(f.events.filter(value => value[0] === 'activate').length, 1);
  f.emit();
  f.select('gamma');
  assert.deepEqual(f.controller.getSnapshot().ids, ['beta', 'gamma', 'delta', 'epsilon']);
  assert.equal(f.records.length, 5);
  assert.equal(f.events.some(value => value[0] === 'open'), false);
  f.controller.dispose();
  assert.equal(f.active, 0);
  assert.ok(f.records.every(record => record.releases === 1));
});

test('ordinary historical or nonblank navigation exits split and keeps a native baseline reference', () => {
  const f = fixture();
  f.newSession('beta');
  f.select('history');
  assert.deepEqual(f.controller.getSnapshot().ids, []);
  assert.equal(f.active, 0);
  assert.deepEqual(f.held, ['history']);
  assert.equal(f.events.some(value => value[0] === 'open'), false);
  f.add('remote-history', false);
  f.select('remote-history');
  assert.deepEqual(f.controller.getSnapshot().ids, []);
  assert.deepEqual(f.held, ['remote-history']);
  f.controller.dispose();
});

test('unrelated navigation clears unselected blank candidates', () => {
  const f = fixture();
  f.add('unselected-blank');
  f.select('history');
  f.select('unselected-blank');
  assert.deepEqual(f.controller.getSnapshot().ids, []);
  assert.deepEqual(f.held, ['unselected-blank']);
  f.newSession('fresh');
  assert.deepEqual(f.controller.getSnapshot().ids, ['unselected-blank', 'fresh']);
  f.controller.dispose();
});

test('removed and reappearing IDs are never mistaken for newly created blanks', () => {
  const f = fixture({ rows: [row('alpha', true, true), row('old-empty', true)] });
  f.set([row('alpha', true, true)]);
  f.add('old-empty');
  f.select('old-empty');
  assert.deepEqual(f.controller.getSnapshot().ids, []);
  assert.equal(f.active, 0);
  f.controller.dispose();
});

test('a candidate that becomes nonblank before selection does not split', () => {
  const f = fixture();
  f.add('candidate');
  f.set(f.catalog.sessions.map(value => value.id === 'candidate' ? { ...value, blank: false } : value));
  f.select('candidate');
  assert.deepEqual(f.controller.getSnapshot().ids, []);
  assert.deepEqual(f.held, ['candidate']);
  f.controller.dispose();
});

test('closing one of two panes restores native view and bridges references until selection completes', () => {
  const f = fixture();
  f.newSession('beta');
  f.controller.close('beta');
  assert.deepEqual(f.controller.getSnapshot().ids, []);
  assert.equal(f.active, 0);
  assert.deepEqual(f.held, ['alpha', 'beta']);
  assert.deepEqual(f.events.slice(-2), [['deactivate'], ['open', 'alpha']]);
  f.set(f.catalog.sessions.map(value => ({ ...value, mainView: true })));
  assert.deepEqual(f.held, ['alpha', 'beta']);
  f.select('alpha');
  assert.deepEqual(f.held, ['alpha']);
  assert.equal(f.controller.ref('beta'), undefined);
  f.newSession('gamma');
  assert.deepEqual(f.controller.getSnapshot().ids, ['alpha', 'gamma']);
  f.controller.dispose();
});

test('closing current pane in a larger split keeps remaining references and navigates within it', () => {
  const f = fixture({ autoOpen: true });
  f.newSession('beta');
  f.newSession('gamma');
  const alpha = f.controller.ref('alpha');
  const beta = f.controller.ref('beta');
  f.controller.close('gamma');
  assert.deepEqual(f.controller.getSnapshot().ids, ['alpha', 'beta']);
  assert.equal(f.active, 1);
  assert.equal(f.controller.ref('alpha'), alpha);
  assert.equal(f.controller.ref('beta'), beta);
  assert.deepEqual(f.held, ['alpha', 'beta']);
  assert.deepEqual(f.events.at(-1), ['open', 'beta']);
  const before = f.events.length;
  f.controller.close('unknown');
  assert.equal(f.events.length, before);
  f.controller.dispose();
});

test('exit can select a pane or other known session and ignores unavailable IDs', () => {
  const f = fixture({ autoOpen: true });
  f.newSession('beta');
  f.controller.exit('missing');
  assert.deepEqual(f.controller.getSnapshot().ids, ['alpha', 'beta']);
  assert.match(f.controller.getSnapshot().error, /no longer available/);
  f.controller.exit('history');
  assert.deepEqual(f.controller.getSnapshot(), { ids: [] });
  assert.deepEqual(f.held, ['history']);
  assert.equal(f.active, 0);
  f.controller.dispose();
});

test('native navigation can supersede an unfinished exit handoff', () => {
  const f = fixture();
  f.newSession('beta');
  f.controller.exit('alpha');
  assert.deepEqual(f.held, ['alpha', 'beta']);
  f.select('history');
  assert.deepEqual(f.held, ['history']);
  assert.deepEqual(f.controller.getSnapshot().ids, []);
  f.newSession('gamma');
  assert.deepEqual(f.controller.getSnapshot().ids, ['history', 'gamma']);
  f.controller.dispose();
});

test('synchronous retain failure never activates split and retains the old draft until recovery', () => {
  const f = fixture();
  f.failures.set('beta', new Error('retain denied'));
  f.newSession('beta');
  assert.deepEqual(f.controller.getSnapshot().ids, []);
  assert.match(f.controller.getSnapshot().error, /retain denied/);
  assert.equal(f.active, 0);
  assert.deepEqual(f.held, ['alpha']);
  f.failures.delete('beta');
  f.emit();
  assert.deepEqual(f.held, ['beta']);
  f.controller.dispose();
});

test('activation failure releases extra references and exposes the failure in native view', () => {
  const f = fixture();
  f.setActivationFailure(new Error('slot unavailable'));
  f.newSession('beta');
  assert.deepEqual(f.controller.getSnapshot(), { ids: [], error: 'slot unavailable' });
  assert.deepEqual(f.held, ['beta']);
  assert.equal(f.active, 0);
  f.controller.dispose();
});

test('failed navigation keeps both drafts and exposes an error until native selection recovers', () => {
  const f = fixture();
  f.newSession('beta');
  f.setOpenFailure(new Error('navigation rejected'));
  f.controller.close('beta');
  assert.deepEqual(f.controller.getSnapshot(), { ids: [], error: 'navigation rejected' });
  assert.deepEqual(f.held, ['alpha', 'beta']);
  assert.equal(f.active, 0);
  f.select('alpha');
  assert.deepEqual(f.held, ['alpha']);
  f.controller.dispose();
});

test('readiness errors are reported only while their corresponding reference is live', async () => {
  const f = fixture({ autoOpen: true });
  const beta = deferred();
  f.readiness.set('beta', beta);
  f.newSession('beta');
  beta.reject(new Error('connection failed'));
  await Promise.resolve();
  assert.deepEqual(f.controller.getSnapshot().ids, ['alpha', 'beta']);
  assert.equal(f.controller.getSnapshot().error, 'connection failed');
  const gamma = deferred();
  f.readiness.set('gamma', gamma);
  f.newSession('gamma');
  f.controller.close('gamma');
  assert.equal(f.controller.getSnapshot().error, undefined);
  gamma.reject(new Error('released reference failed late'));
  await Promise.resolve();
  assert.equal(f.controller.getSnapshot().error, undefined);
  const delta = deferred();
  f.readiness.set('delta', delta);
  f.newSession('delta');
  f.controller.dispose();
  delta.reject(new Error('disposed reference failed late'));
  await Promise.resolve();
  assert.deepEqual(f.controller.getSnapshot(), { ids: [] });
});

test('reentrant catalog notifications settle without duplicate retains, activations, or releases', () => {
  const f = fixture({ reentrant: true, autoOpen: true, emitOnSubscribe: true });
  let notifications = 0;
  const unsubscribe = f.controller.subscribe(() => { notifications += 1; f.controller.syncCatalog(); });
  f.newSession('beta');
  f.newSession('gamma');
  assert.deepEqual(f.controller.getSnapshot().ids, ['alpha', 'beta', 'gamma']);
  assert.equal(f.records.length, 3);
  assert.equal(f.active, 1);
  f.controller.exit('alpha');
  assert.deepEqual(f.held, ['alpha']);
  assert.equal(f.active, 0);
  assert.ok(notifications > 0);
  unsubscribe();
  f.controller.dispose();
  f.controller.dispose();
  assert.equal(f.unsubscribeCount, 1);
  assert.ok(f.records.every(record => record.releases === 1));
  const count = f.events.length;
  f.newSession('after-disposal');
  f.controller.syncCatalog();
  f.controller.close('alpha');
  f.controller.exit('history');
  assert.equal(f.events.length, count);
});

test('catalog read errors preserve live references and subsequent navigation recovers', () => {
  const f = fixture();
  f.newSession('beta');
  f.setCatalogFailure(new Error('catalog unavailable'));
  f.emit();
  assert.deepEqual(f.controller.getSnapshot().ids, ['alpha', 'beta']);
  assert.equal(f.controller.getSnapshot().error, 'catalog unavailable');
  assert.deepEqual(f.held, ['alpha', 'beta']);
  f.setCatalogFailure(undefined);
  f.select('history');
  assert.deepEqual(f.controller.getSnapshot(), { ids: [] });
  assert.deepEqual(f.held, ['history']);
  f.controller.dispose();
});

test('a repeated catalog failure settles even when an observer requests a synchronous refresh', () => {
  const f = fixture();
  let notifications = 0;
  f.controller.subscribe(() => { notifications += 1; f.controller.syncCatalog(); });
  f.setCatalogFailure(new Error('offline'));
  f.emit();
  assert.equal(notifications, 1);
  assert.equal(f.controller.getSnapshot().error, 'offline');
  assert.deepEqual(f.held, ['alpha']);
  f.setCatalogFailure(undefined);
  f.select('history');
  assert.deepEqual(f.held, ['history']);
  f.controller.dispose();
});

test('dropping known history splits with the native conversation without navigating or replacing its draft', () => {
  const f = fixture();
  const original = f.controller.ref('alpha');
  f.controller.addHistory('history');
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', 'history'] });
  assert.deepEqual(f.held, ['alpha', 'history']);
  assert.equal(f.controller.ref('alpha'), original);
  assert.equal(f.catalog.sessions.find(value => value.mainView).id, 'alpha');
  assert.deepEqual(f.events, [['retain', 'alpha'], ['retain', 'history'], ['activate']]);
  f.controller.dispose();
  assert.ok(f.records.every(record => record.releases === 1));
});

test('dropping the current or an already visible conversation never duplicates panes or references', () => {
  const f = fixture();
  f.controller.addHistory('alpha');
  assert.deepEqual(f.controller.getSnapshot(), { ids: [] });
  assert.deepEqual(f.events, [['retain', 'alpha']]);
  f.controller.addHistory('history');
  const snapshot = f.controller.getSnapshot();
  const eventCount = f.events.length;
  f.controller.addHistory('history');
  f.controller.addHistory('alpha');
  assert.equal(f.controller.getSnapshot(), snapshot);
  assert.equal(f.events.length, eventCount);
  f.controller.dispose();
});

test('history drops and native New append to the same layout in either order', () => {
  const f = fixture();
  f.controller.addHistory('history');
  f.newSession('beta');
  assert.deepEqual(f.controller.getSnapshot().ids, ['alpha', 'history', 'beta']);
  f.add('older-history', false);
  f.controller.addHistory('older-history');
  assert.deepEqual(f.controller.getSnapshot().ids, ['alpha', 'history', 'beta', 'older-history']);
  f.newSession('gamma');
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['history', 'beta', 'older-history', 'gamma'], notice: 'limit' });
  assert.deepEqual(f.held, ['beta', 'gamma', 'history', 'older-history']);
  assert.equal(f.events.some(event => event[0] === 'open'), false);
  assert.equal(f.active, 1);
  f.controller.dispose();
});

test('a fifth history pane releases the oldest pane without changing native selection or deleting it', () => {
  const f = fixture();
  for (const id of ['second-history', 'third-history', 'fourth-history']) f.add(id, false);
  for (const id of ['history', 'second-history', 'third-history', 'fourth-history']) f.controller.addHistory(id);
  assert.deepEqual(f.controller.getSnapshot(), {
    ids: ['history', 'second-history', 'third-history', 'fourth-history'], notice: 'limit',
  });
  assert.deepEqual(f.held, ['fourth-history', 'history', 'second-history', 'third-history']);
  assert.equal(f.catalog.sessions.find(value => value.mainView).id, 'alpha');
  assert.equal(f.catalog.sessions.some(value => value.id === 'alpha'), true);
  assert.equal(f.events.some(event => event[0] === 'open'), false);
  f.newSession('fresh');
  assert.deepEqual(f.controller.getSnapshot().ids, ['second-history', 'third-history', 'fourth-history', 'fresh']);
  f.controller.dispose();
});

test('unknown history is rejected without replacing the existing split', () => {
  const f = fixture();
  f.newSession('beta');
  const eventCount = f.events.length;
  f.controller.addHistory('missing');
  assert.deepEqual(f.controller.getSnapshot().ids, ['alpha', 'beta']);
  assert.match(f.controller.getSnapshot().error, /no longer available/);
  assert.equal(f.events.length, eventCount);
  assert.deepEqual(f.held, ['alpha', 'beta']);
  f.controller.dispose();
});

test('history drops wait for a ready catalog and an existing native conversation', () => {
  const pending = fixture({ ready: false });
  const count = pending.events.length;
  pending.controller.addHistory('history');
  assert.deepEqual(pending.controller.getSnapshot(), { ids: [] });
  assert.equal(pending.events.length, count);
  pending.controller.dispose();
  const noCurrent = fixture({ rows: [row('history')] });
  noCurrent.controller.addHistory('history');
  assert.deepEqual(noCurrent.controller.getSnapshot(), { ids: [] });
  assert.deepEqual(noCurrent.events, []);
  noCurrent.controller.dispose();
});

test('history drops cannot interrupt an unfinished return to native view', () => {
  const f = fixture();
  f.newSession('beta');
  f.controller.exit('alpha');
  const snapshot = f.controller.getSnapshot();
  const eventCount = f.events.length;
  f.controller.addHistory('history');
  assert.equal(f.controller.getSnapshot(), snapshot);
  assert.equal(f.events.length, eventCount);
  assert.deepEqual(f.held, ['alpha', 'beta']);
  f.select('alpha');
  f.controller.addHistory('history');
  assert.deepEqual(f.controller.getSnapshot().ids, ['alpha', 'history']);
  f.controller.dispose();
});

test('history retain failure at capacity preserves all existing panes and references', () => {
  const f = fixture();
  for (const id of ['beta', 'gamma', 'delta']) f.newSession(id);
  f.failures.set('history', new Error('history unavailable'));
  f.controller.addHistory('history');
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', 'beta', 'gamma', 'delta'], error: 'history unavailable' });
  assert.deepEqual(f.held, ['alpha', 'beta', 'delta', 'gamma']);
  assert.equal(f.active, 1);
  f.failures.delete('history');
  f.controller.addHistory('history');
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['beta', 'gamma', 'delta', 'history'], notice: 'limit' });
  f.controller.dispose();
});

test('history activation failure rolls back only the new reference and preserves the native draft', () => {
  const f = fixture({ reentrant: true });
  const original = f.controller.ref('alpha');
  f.setActivationFailure(new Error('slot unavailable'));
  f.controller.addHistory('history');
  assert.deepEqual(f.controller.getSnapshot(), { ids: [], error: 'slot unavailable' });
  assert.deepEqual(f.held, ['alpha']);
  assert.equal(f.controller.ref('alpha'), original);
  assert.equal(f.active, 0);
  f.setActivationFailure(undefined);
  f.controller.addHistory('history');
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', 'history'] });
  assert.equal(f.active, 1);
  assert.equal(f.events.some(event => event[0] === 'open'), false);
  f.controller.dispose();
  assert.ok(f.records.every(record => record.releases === 1));
});

test('history drops handle synchronous catalog notifications and are inert after disposal', () => {
  const f = fixture({ reentrant: true });
  f.controller.subscribe(() => { f.controller.syncCatalog(); f.controller.addHistory('history'); });
  f.controller.addHistory('history');
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', 'history'] });
  assert.equal(f.records.length, 2);
  assert.equal(f.active, 1);
  f.newSession('beta');
  assert.deepEqual(f.controller.getSnapshot().ids, ['alpha', 'history', 'beta']);
  f.controller.dispose();
  const eventCount = f.events.length;
  f.controller.addHistory('history');
  assert.deepEqual(f.controller.getSnapshot(), { ids: [] });
  assert.equal(f.events.length, eventCount);
  assert.ok(f.records.every(record => record.releases === 1));
});
