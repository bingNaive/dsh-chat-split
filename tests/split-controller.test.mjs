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
    catalog = { ...catalog, sessions: catalog.sessions.map(value => ({ ...value, mainView: value.id === id, mainViewCount: value.id === id ? 1 : 0 })) };
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
    retainNative(id) {
      this.set(this.catalog.sessions.map(value => value.id === id ? {
        ...value, mainView: true, mainViewCount: (value.mainViewCount ?? (value.mainView ? 1 : 0)) + 1,
      } : value));
    },
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

// Promise.all plus its commit/rejection callback must settle before inspecting a drop.
const settlePlacement = () => new Promise(resolve => setImmediate(resolve));

test('every snap layout places dropped history into its selected slot and keeps the latest other panes', async () => {
  const capacities = { columns: 2, 'wide-left': 2, 'wide-right': 2, 'three-columns': 3, 'left-stack': 3, grid: 4 };
  for (const [layout, capacity] of Object.entries(capacities)) {
    for (let slot = 0; slot < capacity; slot += 1) {
      const f = fixture();
      for (const id of ['beta', 'gamma', 'delta']) f.newSession(id);
      const before = f.controller.getSnapshot();
      const oldReferences = new Map(before.ids.map(id => [id, f.controller.ref(id)]));
      f.controller.addHistory('history', { layout, slot });
      assert.equal(f.controller.getSnapshot(), before, 'retain existing layout until reference readiness');
      assert.equal(f.records.find(record => record.id === 'alpha').releases, 0);
      await settlePlacement();
      const others = ['alpha', 'beta', 'gamma', 'delta'].slice(-(capacity - 1));
      const slots = [...others];
      slots.splice(slot, 0, 'history');
      assert.deepEqual(f.controller.getSnapshot(), {
        ids: [...others, 'history'], placement: { layout, slots }, notice: 'limit',
      });
      assert.deepEqual(f.held, [...others, 'history'].sort());
      for (const id of others) assert.equal(f.controller.ref(id), oldReferences.get(id));
      assert.equal(f.events.some(event => event[0] === 'open'), false);
      assert.equal(f.catalog.sessions.length, 5, 'rearranging or trimming never deletes conversations');
      f.controller.dispose();
      assert.ok(f.records.every(record => record.releases === 1));
    }
  }
});

test('targeted drop starts with native current draft and retains empty layout slots', async () => {
  const f = fixture();
  const original = f.controller.ref('alpha');
  f.controller.addHistory('history', { layout: 'grid', slot: 3 });
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), {
    ids: ['alpha', 'history'], placement: { layout: 'grid', slots: ['alpha', null, null, 'history'] },
  });
  assert.equal(f.controller.ref('alpha'), original);
  assert.equal(f.active, 1);
  f.controller.dispose();
});

test('dropping history into an empty grid slot preserves the other pane positions', async () => {
  const f = fixture();
  f.controller.addHistory('history', { layout: 'grid', slot: 3 });
  await settlePlacement();
  const original = f.controller.ref('history');
  f.add('other-history', false);
  f.controller.addHistory('other-history', { layout: 'grid', slot: 2 });
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), {
    ids: ['alpha', 'history', 'other-history'],
    placement: { layout: 'grid', slots: ['alpha', null, 'other-history', 'history'] },
  });
  assert.equal(f.controller.ref('history'), original);
  assert.equal(f.events.some(event => event[0] === 'open'), false);
  f.controller.dispose();
});

test('moving visible grid panes uses empty slots or swaps occupied slots without changing recency', async () => {
  const f = fixture();
  f.controller.addHistory('history', { layout: 'grid', slot: 3 });
  await settlePlacement();
  const records = [...f.records];
  f.controller.addHistory('alpha', { layout: 'grid', slot: 2 });
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), {
    ids: ['alpha', 'history'], placement: { layout: 'grid', slots: [null, null, 'alpha', 'history'] },
  });
  f.controller.addHistory('alpha', { layout: 'grid', slot: 3 });
  await settlePlacement();
  const expected = {
    ids: ['alpha', 'history'], placement: { layout: 'grid', slots: [null, null, 'history', 'alpha'] },
  };
  assert.deepEqual(f.controller.getSnapshot(), expected);
  f.controller.addHistory('alpha', { layout: 'grid', slot: 3 });
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), expected);
  assert.deepEqual(f.records, records);
  assert.ok(records.every(record => record.releases === 0));
  f.controller.dispose();
});

test('new history displaces only the target pane into an available slot in the current layout', async () => {
  for (const layout of ['grid', 'three-columns', 'left-stack']) {
    const f = fixture();
    const slot = layout === 'grid' ? 3 : 2;
    f.controller.addHistory('history', { layout, slot });
    await settlePlacement();
    const original = f.controller.ref('history');
    f.add('other-history', false);
    f.controller.addHistory('other-history', { layout, slot });
    await settlePlacement();
    assert.deepEqual(f.controller.getSnapshot(), {
      ids: ['alpha', 'history', 'other-history'],
      placement: { layout, slots: layout === 'grid'
        ? ['alpha', 'history', null, 'other-history'] : ['alpha', 'history', 'other-history'] },
    });
    assert.equal(f.controller.ref('history'), original);
    assert.deepEqual(f.held, ['alpha', 'history', 'other-history']);
    f.controller.dispose();
  }
});

test('dropping into a full layout replaces the selected pane and preserves all other slots', async () => {
  const f = fixture();
  for (const id of ['beta', 'gamma']) f.newSession(id);
  f.controller.addHistory('history', { layout: 'grid', slot: 3 });
  await settlePlacement();
  const originals = new Map(f.controller.getSnapshot().ids.map(id => [id, f.controller.ref(id)]));
  f.add('other-history', false);
  f.controller.addHistory('other-history', { layout: 'grid', slot: 1 });
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), {
    ids: ['alpha', 'gamma', 'history', 'other-history'],
    placement: { layout: 'grid', slots: ['alpha', 'other-history', 'gamma', 'history'] },
    notice: 'limit',
  });
  assert.deepEqual(f.held, ['alpha', 'gamma', 'history', 'other-history']);
  for (const id of ['alpha', 'gamma', 'history']) assert.equal(f.controller.ref(id), originals.get(id));
  assert.equal(f.records.find(record => record.id === 'beta').releases, 1);
  assert.equal(f.catalog.sessions.some(value => value.id === 'beta'), true);
  assert.equal(f.events.some(event => event[0] === 'open'), false);
  f.controller.dispose();
});

test('failed drops within the current layout roll back both displacement and staged references', async () => {
  for (const failure of ['retain', 'readiness']) {
    const f = fixture({ reentrant: true });
    f.controller.addHistory('history', { layout: 'grid', slot: 3 });
    await settlePlacement();
    const before = f.controller.getSnapshot();
    const originals = new Map(before.ids.map(id => [id, f.controller.ref(id)]));
    f.add('other-history', false);
    const ready = deferred();
    if (failure === 'retain') f.failures.set('other-history', new Error('load failed'));
    else f.readiness.set('other-history', ready);
    f.controller.addHistory('other-history', { layout: 'grid', slot: 3 });
    if (failure === 'readiness') {
      assert.equal(f.controller.getSnapshot(), before);
      ready.reject(new Error('load failed'));
    }
    await settlePlacement();
    assert.deepEqual(f.controller.getSnapshot(), { ...before, error: 'load failed' });
    assert.deepEqual(f.held, ['alpha', 'history']);
    for (const [id, reference] of originals) assert.equal(f.controller.ref(id), reference);
    f.controller.dispose();
    assert.ok(f.records.every(record => record.releases === 1));
  }
});

test('targeting a visible conversation moves it without changing recency or duplicating references', async () => {
  const f = fixture();
  for (const id of ['beta', 'gamma', 'delta']) f.newSession(id);
  const before = [...f.records];
  f.controller.addHistory('beta', { layout: 'grid', slot: 3 });
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), {
    ids: ['alpha', 'beta', 'gamma', 'delta'],
    placement: { layout: 'grid', slots: ['alpha', 'gamma', 'delta', 'beta'] },
  });
  assert.deepEqual(f.records, before);
  f.controller.addHistory('alpha', { layout: 'columns', slot: 1 });
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), {
    ids: ['alpha', 'delta'], placement: { layout: 'columns', slots: ['delta', 'alpha'] }, notice: 'limit',
  });
  assert.deepEqual(f.held, ['alpha', 'delta']);
  assert.equal(f.records.length, before.length);
  f.controller.dispose();
});

test('invalid snap targets and a drop of the sole current conversation are no-ops', async () => {
  const f = fixture();
  const before = f.controller.getSnapshot();
  for (const target of [null, {}, { layout: 'unknown', slot: 0 }, { layout: 'grid', slot: -1 },
    { layout: 'grid', slot: 4 }, { layout: 'columns', slot: 2 }, { layout: 'grid', slot: .5 }]) {
    f.controller.addHistory('history', target);
  }
  f.controller.addHistory('alpha', { layout: 'grid', slot: 1 });
  await settlePlacement();
  assert.equal(f.controller.getSnapshot(), before);
  assert.deepEqual(f.events, [['retain', 'alpha']]);
  f.controller.dispose();
});

test('native New fills first empty selected-layout slot before reverting to automatic layout at capacity', async () => {
  const f = fixture();
  f.controller.addHistory('history', { layout: 'grid', slot: 3 });
  await settlePlacement();
  f.newSession('beta');
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), {
    ids: ['alpha', 'history', 'beta'], placement: { layout: 'grid', slots: ['alpha', 'beta', null, 'history'] },
  });
  f.newSession('gamma');
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), {
    ids: ['alpha', 'history', 'beta', 'gamma'], placement: { layout: 'grid', slots: ['alpha', 'beta', 'gamma', 'history'] },
  });
  f.newSession('delta');
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['history', 'beta', 'gamma', 'delta'], notice: 'limit' });
  f.controller.addHistory('alpha', { layout: 'columns', slot: 0 });
  await settlePlacement();
  f.newSession('epsilon');
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['delta', 'alpha', 'epsilon'] });
  f.controller.dispose();
});

test('closing targeted layout leaves an empty slot and restores native below two conversations', async () => {
  const f = fixture({ autoOpen: true });
  for (const id of ['beta', 'gamma']) f.newSession(id);
  f.controller.addHistory('history', { layout: 'grid', slot: 2 });
  await settlePlacement();
  f.controller.close('gamma');
  assert.deepEqual(f.controller.getSnapshot(), {
    ids: ['alpha', 'beta', 'history'], placement: { layout: 'grid', slots: ['alpha', 'beta', 'history', null] },
  });
  f.controller.close('alpha');
  assert.deepEqual(f.controller.getSnapshot(), {
    ids: ['beta', 'history'], placement: { layout: 'grid', slots: [null, 'beta', 'history', null] },
  });
  f.newSession('fresh');
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot().placement, { layout: 'grid', slots: ['fresh', 'beta', 'history', null] });
  f.controller.close('history');
  f.controller.close('fresh');
  assert.deepEqual(f.controller.getSnapshot(), { ids: [] });
  assert.deepEqual(f.held, ['beta']);
  assert.equal(f.active, 0);
  f.controller.dispose();
});

test('targeted retention and activation failures preserve the previous layout and its references', async () => {
  const f = fixture();
  for (const id of ['beta', 'gamma']) f.newSession(id);
  f.controller.addHistory('beta', { layout: 'grid', slot: 2 });
  await settlePlacement();
  const placement = f.controller.getSnapshot().placement;
  f.failures.set('history', new Error('retain denied'));
  f.controller.addHistory('history', { layout: 'columns', slot: 0 });
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', 'beta', 'gamma'], placement, error: 'retain denied' });
  assert.deepEqual(f.held, ['alpha', 'beta', 'gamma']);
  f.controller.dispose();
  const native = fixture({ reentrant: true });
  native.setActivationFailure(new Error('activation denied'));
  native.controller.addHistory('history', { layout: 'columns', slot: 0 });
  await settlePlacement();
  assert.deepEqual(native.controller.getSnapshot(), { ids: [], error: 'activation denied' });
  assert.deepEqual(native.held, ['alpha']);
  assert.equal(native.active, 0);
  native.controller.dispose();
});

test('asynchronous readiness failure rolls back only staged references and never releases visible panes', async () => {
  const f = fixture({ reentrant: true });
  for (const id of ['beta', 'gamma', 'delta']) f.newSession(id);
  const ready = deferred();
  f.readiness.set('history', ready);
  const before = f.controller.getSnapshot();
  f.controller.addHistory('history', { layout: 'columns', slot: 1 });
  await settlePlacement();
  assert.equal(f.controller.getSnapshot(), before);
  assert.deepEqual(f.held, ['alpha', 'beta', 'delta', 'gamma', 'history']);
  ready.reject(new Error('load failed'));
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', 'beta', 'gamma', 'delta'], error: 'load failed' });
  assert.deepEqual(f.held, ['alpha', 'beta', 'delta', 'gamma']);
  assert.equal(f.active, 1);
  f.controller.dispose();
});

test('native New readiness failure reports the error while preserving the created draft in its slot', async () => {
  const f = fixture();
  f.controller.addHistory('history', { layout: 'grid', slot: 3 });
  await settlePlacement();
  const ready = deferred();
  f.readiness.set('beta', ready);
  f.newSession('beta');
  const next = {
    ids: ['alpha', 'history', 'beta'], placement: { layout: 'grid', slots: ['alpha', 'beta', null, 'history'] },
  };
  assert.deepEqual(f.controller.getSnapshot(), next);
  ready.reject(new Error('new conversation failed'));
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), { ...next, error: 'new conversation failed' });
  assert.deepEqual(f.held, ['alpha', 'beta', 'history']);
  f.controller.dispose();
});

test('rapid native New actions keep both drafts in empty snap slots while the first draft is loading', async () => {
  const f = fixture({ reentrant: true });
  f.controller.addHistory('history', { layout: 'grid', slot: 3 });
  await settlePlacement();
  const beta = deferred();
  const gamma = deferred();
  f.readiness.set('beta', beta);
  f.readiness.set('gamma', gamma);
  f.newSession('beta');
  const betaReference = f.controller.ref('beta');
  f.newSession('gamma');
  const expected = {
    ids: ['alpha', 'history', 'beta', 'gamma'],
    placement: { layout: 'grid', slots: ['alpha', 'beta', 'gamma', 'history'] },
  };
  assert.deepEqual(f.controller.getSnapshot(), expected);
  assert.deepEqual(f.held, ['alpha', 'beta', 'gamma', 'history']);
  gamma.resolve();
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), expected);
  beta.resolve();
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), expected);
  assert.equal(f.controller.ref('beta'), betaReference);
  assert.equal(f.records.filter(record => record.id === 'beta').length, 1);
  f.controller.dispose();
  assert.ok(f.records.every(record => record.releases === 1));
});

test('navigation, close, exit and disposal cancel pending targeted drops without late reactivation', async () => {
  for (const action of ['navigate', 'close', 'exit', 'dispose']) {
    const f = fixture({ autoOpen: true });
    for (const id of ['beta', 'gamma']) f.newSession(id);
    f.add('other', false);
    const ready = deferred();
    f.readiness.set('history', ready);
    f.controller.addHistory('history', { layout: 'columns', slot: 0 });
    if (action === 'navigate') f.select('other');
    if (action === 'close') f.controller.close('alpha');
    if (action === 'exit') f.controller.exit('beta');
    if (action === 'dispose') f.controller.dispose();
    const before = f.controller.getSnapshot();
    assert.equal(f.controller.ref('history'), undefined);
    ready.resolve();
    await settlePlacement();
    assert.equal(f.controller.getSnapshot(), before, action);
    f.controller.dispose();
    assert.ok(f.records.every(record => record.releases === 1));
  }
});

test('a newer targeted drop supersedes a pending one and ignores its late readiness failure', async () => {
  const f = fixture();
  f.add('other', false);
  const old = deferred();
  f.readiness.set('history', old);
  f.controller.addHistory('history', { layout: 'columns', slot: 0 });
  f.controller.addHistory('other', { layout: 'wide-right', slot: 1 });
  await settlePlacement();
  const before = f.controller.getSnapshot();
  assert.deepEqual(before, { ids: ['alpha', 'other'], placement: { layout: 'wide-right', slots: ['alpha', 'other'] } });
  old.reject(new Error('stale failure'));
  await settlePlacement();
  assert.equal(f.controller.getSnapshot(), before);
  assert.deepEqual(f.held, ['alpha', 'other']);
  f.controller.dispose();
});

test('targeted commit rechecks catalog availability and preserves the previous layout on failure', async () => {
  for (const failure of ['removed', 'not-ready', 'catalog-error']) {
    const f = fixture();
    f.newSession('beta');
    const ready = deferred();
    f.readiness.set('history', ready);
    f.controller.addHistory('history', { layout: 'columns', slot: 0 });
    if (failure === 'removed') f.set(f.catalog.sessions.filter(value => value.id !== 'history'));
    if (failure === 'not-ready') f.set(f.catalog.sessions, false);
    if (failure === 'catalog-error') f.setCatalogFailure(new Error('catalog unavailable'));
    ready.resolve();
    await settlePlacement();
    assert.deepEqual(f.controller.getSnapshot().ids, ['alpha', 'beta']);
    assert.equal(typeof f.controller.getSnapshot().error, 'string');
    assert.deepEqual(f.held, ['alpha', 'beta']);
    f.controller.dispose();
  }
});

test('targeted layouts settle through reentrant catalog notifications without duplicate lifetimes', async () => {
  const f = fixture({ reentrant: true, autoOpen: true });
  const unsubscribe = f.controller.subscribe(() => {
    f.controller.syncCatalog();
    f.controller.addHistory('history', { layout: 'columns', slot: 0 });
  });
  f.controller.addHistory('history', { layout: 'grid', slot: 2 });
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), {
    ids: ['alpha', 'history'], placement: { layout: 'grid', slots: ['alpha', null, 'history', null] },
  });
  assert.equal(f.records.length, 2);
  assert.equal(f.active, 1);
  f.newSession('beta');
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot().placement, { layout: 'grid', slots: ['alpha', 'beta', 'history', null] });
  assert.equal(f.records.length, 3);
  unsubscribe();
  f.controller.dispose();
  assert.ok(f.records.every(record => record.releases === 1));
});

test('workspace selection replaces its source with an existing or newly created blank, without appending a pane', async () => {
  for (const existing of [true, false]) {
    const f = fixture({ reentrant: true });
    if (existing) f.add('workspace-draft');
    f.newSession('beta');
    const other = f.controller.ref('alpha');
    const before = f.controller.getSnapshot();
    f.controller.beginWorkspaceChange('beta');
    if (!existing) f.add('workspace-draft');
    f.retainNative('workspace-draft');
    assert.equal(f.controller.getSnapshot(), before, 'native beforeOpen has not completed');
    assert.equal(f.records.find(record => record.id === 'beta').releases, 0);
    f.select('workspace-draft');
    assert.equal(f.controller.getSnapshot(), before, 'wait for destination readiness before releasing source');
    await settlePlacement();
    assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', 'workspace-draft'] });
    assert.equal(f.controller.ref('alpha'), other);
    assert.deepEqual(f.held, ['alpha', 'workspace-draft']);
    assert.equal(f.active, 1);
    assert.equal(f.events.some(event => event[0] === 'open' || event[0] === 'deactivate'), false);
    f.controller.dispose();
    assert.ok(f.records.every(record => record.releases === 1));
  }
});

test('workspace selection is scoped to a noncurrent pane and keeps every grid slot', async () => {
  for (const full of [false, true]) {
    const f = fixture();
    f.newSession('beta');
    if (full) f.newSession('gamma');
    f.controller.addHistory('history', { layout: 'grid', slot: 3 });
    await settlePlacement();
    const before = f.controller.getSnapshot();
    const retained = new Map(before.ids.filter(id => id !== 'alpha').map(id => [id, f.controller.ref(id)]));
    f.controller.beginWorkspaceChange('alpha');
    f.add('workspace-draft');
    f.retainNative('workspace-draft');
    f.select('workspace-draft');
    await settlePlacement();
    assert.deepEqual(f.controller.getSnapshot(), {
      ids: before.ids.map(id => id === 'alpha' ? 'workspace-draft' : id),
      placement: { layout: 'grid', slots: before.placement.slots.map(id => id === 'alpha' ? 'workspace-draft' : id) },
    });
    for (const [id, ref] of retained) assert.equal(f.controller.ref(id), ref);
    assert.equal(f.records.find(record => record.id === 'alpha').releases, 1);
    f.controller.dispose();
  }
});

test('switching to a visible draft swaps panes without duplicates, even if it is already native current', async () => {
  for (const explicit of [false, true]) {
    for (const alreadyCurrent of [false, true]) {
      const f = fixture();
      f.newSession('beta');
      f.newSession('gamma');
      if (explicit) {
        f.controller.addHistory('beta', { layout: 'grid', slot: 3 });
        await settlePlacement();
      }
      const target = alreadyCurrent ? 'gamma' : 'beta';
      const before = f.controller.getSnapshot();
      const refs = [...f.records];
      f.controller.beginWorkspaceChange('alpha');
      f.retainNative(target);
      await settlePlacement();
      assert.equal(f.controller.getSnapshot(), before, 'the same-current 1 -> 2 retain is not a completed switch');
      f.select(target);
      await settlePlacement();
      const swap = id => id === 'alpha' ? target : id === target ? 'alpha' : id;
      assert.deepEqual(f.controller.getSnapshot(), {
        ids: explicit ? before.ids : before.ids.map(swap),
        ...(explicit ? { placement: { layout: 'grid', slots: before.placement.slots.map(swap) } } : {}),
      });
      assert.deepEqual(f.records, refs);
      assert.ok(refs.every(record => record.releases === 0));
      f.controller.dispose();
    }
  }
});

test('workspace selection of the source itself is a no-op and clears the pending operation', async () => {
  const f = fixture();
  f.newSession('beta');
  const before = f.controller.getSnapshot();
  f.controller.beginWorkspaceChange('beta');
  f.retainNative('beta');
  f.select('beta');
  await settlePlacement();
  assert.equal(f.controller.getSnapshot(), before);
  f.newSession('gamma');
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', 'beta', 'gamma'] });
  f.controller.dispose();
});

test('workspace change waits for asynchronous loading and native beforeOpen before releasing the source', async () => {
  const f = fixture({ reentrant: true });
  f.newSession('beta');
  const ready = deferred();
  f.readiness.set('workspace-draft', ready);
  const before = f.controller.getSnapshot();
  const source = f.records.find(record => record.id === 'alpha');
  f.controller.beginWorkspaceChange('alpha');
  f.add('workspace-draft');
  f.retainNative('workspace-draft');
  await settlePlacement();
  assert.equal(f.controller.ref('workspace-draft'), undefined, 'native beforeOpen still owns the migration');
  f.select('workspace-draft');
  await settlePlacement();
  assert.equal(f.controller.getSnapshot(), before);
  assert.equal(source.releases, 0);
  ready.resolve();
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['workspace-draft', 'beta'] });
  assert.equal(source.releases, 1);
  f.controller.dispose();
});

test('workspace destination loading errors preserve the source pane and clean up staged references', async () => {
  for (const failure of ['retain', 'readiness']) {
    const f = fixture({ reentrant: true });
    f.newSession('beta');
    const before = f.controller.getSnapshot();
    const ready = deferred();
    if (failure === 'retain') f.failures.set('workspace-draft', new Error('workspace load failed'));
    else f.readiness.set('workspace-draft', ready);
    f.controller.beginWorkspaceChange('alpha');
    f.add('workspace-draft');
    f.retainNative('workspace-draft');
    f.select('workspace-draft');
    if (failure === 'readiness') ready.reject(new Error('workspace load failed'));
    await settlePlacement();
    assert.deepEqual(f.controller.getSnapshot(), { ...before, error: 'workspace load failed' });
    assert.deepEqual(f.held, ['alpha', 'beta']);
    f.emit();
    assert.deepEqual(f.controller.getSnapshot().ids, before.ids);
    f.newSession('gamma');
    assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', 'beta', 'gamma'] });
    f.controller.dispose();
    assert.ok(f.records.every(record => record.releases === 1));
  }
});

test('cancelled workspace selection leaves native New and sidebar navigation unchanged', () => {
  for (const action of ['new', 'history']) {
    const f = fixture();
    f.newSession('beta');
    f.controller.beginWorkspaceChange('alpha');
    f.controller.cancelWorkspaceChange();
    if (action === 'new') {
      f.newSession('gamma');
      assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', 'beta', 'gamma'] });
    } else {
      f.select('history');
      assert.deepEqual(f.controller.getSnapshot(), { ids: [] });
      assert.deepEqual(f.held, ['history']);
    }
    f.controller.dispose();
  }
});

test('close, exit, drag, cancellation and disposal invalidate pending workspace readiness', async () => {
  for (const action of ['close', 'exit', 'drag', 'cancel', 'dispose']) {
    const f = fixture({ autoOpen: true });
    f.newSession('beta');
    f.newSession('gamma');
    const ready = deferred();
    f.readiness.set('workspace-draft', ready);
    f.controller.beginWorkspaceChange('alpha');
    f.add('workspace-draft');
    f.retainNative('workspace-draft');
    f.select('workspace-draft');
    if (action === 'close') f.controller.close('alpha');
    if (action === 'exit') f.controller.exit('beta');
    if (action === 'drag') f.controller.addHistory('history', { layout: 'grid', slot: 3 });
    if (action === 'cancel') f.controller.cancelWorkspaceChange();
    if (action === 'dispose') f.controller.dispose();
    await settlePlacement();
    const before = f.controller.getSnapshot();
    assert.equal(f.controller.ref('workspace-draft'), undefined);
    ready.resolve();
    await settlePlacement();
    assert.equal(f.controller.getSnapshot(), before, action);
    f.controller.dispose();
    assert.ok(f.records.every(record => record.releases === 1));
  }
});

test('beginning a workspace change cancels a pending drag so its later commit cannot release the source', async () => {
  const f = fixture();
  f.newSession('beta');
  const dragReady = deferred();
  f.readiness.set('history', dragReady);
  f.controller.addHistory('history', { layout: 'columns', slot: 0 });
  f.controller.beginWorkspaceChange('alpha');
  const before = f.controller.getSnapshot();
  dragReady.resolve();
  await settlePlacement();
  assert.equal(f.controller.getSnapshot(), before);
  assert.deepEqual(f.held, ['alpha', 'beta']);
  f.add('workspace-draft');
  f.retainNative('workspace-draft');
  f.select('workspace-draft');
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['workspace-draft', 'beta'] });
  f.controller.dispose();
});

test('workspace selection supports batched native catalog updates and legacy boolean catalogs', async () => {
  const f = fixture();
  f.newSession('beta');
  f.controller.beginWorkspaceChange('alpha');
  f.set([row('alpha', true), row('beta', true), row('workspace-draft', true, true)]);
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['workspace-draft', 'beta'] });
  f.controller.dispose();
});

test('workspace loading waits through a temporarily unavailable catalog and recovers on readiness', async () => {
  const f = fixture();
  f.newSession('beta');
  f.controller.beginWorkspaceChange('alpha');
  f.add('workspace-draft');
  f.retainNative('workspace-draft');
  f.select('workspace-draft');
  f.set(f.catalog.sessions, false);
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', 'beta'] });
  assert.deepEqual(f.held, ['alpha', 'beta', 'workspace-draft']);
  f.set(f.catalog.sessions, true);
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['workspace-draft', 'beta'] });
  f.controller.dispose();
});

test('native single view and unknown sources cannot start a workspace replacement', async () => {
  const f = fixture();
  f.controller.beginWorkspaceChange('alpha');
  f.newSession('beta');
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', 'beta'] });
  f.controller.beginWorkspaceChange('missing');
  f.select('history');
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), { ids: [] });
  f.controller.dispose();
});

test('a deleted workspace destination cannot leave a pending replacement blocking later navigation', async () => {
  for (const selected of [false, true]) {
    const f = fixture({ reentrant: true });
    f.newSession('beta');
    const ready = deferred();
    f.readiness.set('workspace-draft', ready);
    f.controller.beginWorkspaceChange('alpha');
    f.add('workspace-draft');
    f.retainNative('workspace-draft');
    if (selected) f.select('workspace-draft');
    f.set(f.catalog.sessions.filter(value => value.id !== 'workspace-draft').map(value => ({
      ...value, mainView: value.id === 'beta', mainViewCount: value.id === 'beta' ? 1 : 0,
    })));
    await settlePlacement();
    assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', 'beta'], error: 'This conversation is no longer available.' });
    assert.deepEqual(f.held, ['alpha', 'beta']);
    const before = f.controller.getSnapshot();
    ready.resolve();
    await settlePlacement();
    assert.equal(f.controller.getSnapshot(), before);
    f.select('history');
    assert.deepEqual(f.controller.getSnapshot(), { ids: [] });
    assert.deepEqual(f.held, ['history']);
    f.controller.dispose();
  }
});

test('native workspace rollback cancels the pending source and does not consume the next New', async () => {
  const f = fixture({ reentrant: true });
  f.newSession('beta');
  f.controller.beginWorkspaceChange('alpha');
  f.add('workspace-draft');
  f.retainNative('workspace-draft');
  f.select('beta');
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', 'beta'] });
  f.newSession('gamma');
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', 'beta', 'gamma'] });
  f.controller.dispose();
});

test('catalog errors cancel a staged workspace change and ignore late readiness', async () => {
  const f = fixture({ reentrant: true });
  f.newSession('beta');
  const ready = deferred();
  f.readiness.set('workspace-draft', ready);
  f.controller.beginWorkspaceChange('alpha');
  f.add('workspace-draft');
  f.retainNative('workspace-draft');
  f.select('workspace-draft');
  f.setCatalogFailure(new Error('catalog unavailable'));
  f.emit();
  const before = f.controller.getSnapshot();
  assert.deepEqual(before, { ids: ['alpha', 'beta'], error: 'catalog unavailable' });
  assert.deepEqual(f.held, ['alpha', 'beta']);
  f.setCatalogFailure(undefined);
  ready.resolve();
  await settlePlacement();
  f.emit();
  assert.equal(f.controller.getSnapshot(), before);
  f.newSession('gamma');
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', 'beta', 'gamma'] });
  f.controller.dispose();
});

test('a newer workspace selection supersedes old loading without releasing a visible source', async () => {
  const f = fixture({ reentrant: true });
  f.newSession('beta');
  const old = deferred();
  f.readiness.set('old-workspace', old);
  f.controller.beginWorkspaceChange('alpha');
  f.add('old-workspace');
  f.retainNative('old-workspace');
  f.select('old-workspace');
  f.controller.beginWorkspaceChange('beta');
  assert.deepEqual(f.held, ['alpha', 'beta']);
  f.add('new-workspace');
  f.retainNative('new-workspace');
  f.select('new-workspace');
  await settlePlacement();
  const before = f.controller.getSnapshot();
  assert.deepEqual(before, { ids: ['alpha', 'new-workspace'] });
  old.reject(new Error('stale workspace error'));
  await settlePlacement();
  assert.equal(f.controller.getSnapshot(), before);
  assert.deepEqual(f.held, ['alpha', 'new-workspace']);
  f.controller.dispose();
  assert.ok(f.records.every(record => record.releases === 1));
});

test('cancelling a loading workspace then reopening that same native target shows its native conversation', async () => {
  const f = fixture({ reentrant: true });
  f.newSession('beta');
  const ready = deferred();
  f.readiness.set('workspace-draft', ready);
  f.controller.beginWorkspaceChange('alpha');
  f.add('workspace-draft');
  f.retainNative('workspace-draft');
  f.select('workspace-draft');
  f.controller.cancelWorkspaceChange();
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', 'beta'] }, 'release reentrancy must not be mistaken for a sidebar re-open');
  assert.deepEqual(f.held, ['alpha', 'beta']);
  f.emit();
  f.controller.cancelWorkspaceChange();
  f.retainNative('workspace-draft');
  assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', 'beta'] }, 'wait until native beforeOpen completes');
  f.select('workspace-draft');
  assert.deepEqual(f.controller.getSnapshot(), { ids: [] });
  assert.deepEqual(f.held, ['workspace-draft']);
  ready.resolve();
  await settlePlacement();
  assert.deepEqual(f.controller.getSnapshot(), { ids: [] }, 'cancelled readiness cannot restore the split');
  f.controller.dispose();
  assert.ok(f.records.every(record => record.releases === 1));
});

test('cancelled workspace re-open tracking does not change native New or a subsequent workspace picker', async () => {
  for (const action of ['new', 'same-target-picker', 'other-target-picker']) {
    const f = fixture({ reentrant: true });
    f.newSession('beta');
    const ready = deferred();
    f.readiness.set('workspace-draft', ready);
    f.controller.beginWorkspaceChange('alpha');
    f.add('workspace-draft');
    f.retainNative('workspace-draft');
    f.select('workspace-draft');
    f.controller.cancelWorkspaceChange();
    if (action === 'new') {
      f.newSession('gamma');
      assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', 'beta', 'gamma'] });
    } else {
      f.controller.beginWorkspaceChange('beta');
      const target = action === 'same-target-picker' ? 'workspace-draft' : 'other-workspace';
      if (action === 'other-target-picker') f.add(target);
      f.retainNative(target);
      f.select(target);
      ready.resolve();
      await settlePlacement();
      assert.deepEqual(f.controller.getSnapshot(), { ids: ['alpha', target] });
    }
    ready.resolve();
    await settlePlacement();
    f.controller.dispose();
    assert.ok(f.records.every(record => record.releases === 1));
  }
});
