import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/history-drag.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { HistoryDrag } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const MIME = 'application/x-harness-chatsplit-session';

function element(children = [], right = 268) {
  return {
    contains(candidate) { return this === candidate || children.some(child => child.contains(candidate)); },
    getBoundingClientRect() { return { right }; },
  };
}

function transfer() {
  const values = new Map();
  return {
    effectAllowed: 'uninitialized', dropEffect: 'none',
    setData(type, value) { values.set(type, value); },
    getData(type) { return values.get(type) ?? ''; },
  };
}

function fixture() {
  const listeners = new Map();
  const events = {
    addEventListener(type, callback, capture = false) {
      const entries = listeners.get(type) ?? [];
      entries.push({ callback, capture });
      listeners.set(type, entries);
    },
    removeEventListener(type, callback, capture = false) {
      listeners.set(type, (listeners.get(type) ?? []).filter(entry => entry.callback !== callback || entry.capture !== capture));
    },
    emit(type, values = {}, nativeHandler = () => {}) {
      const event = {
        target: null, button: 0, clientX: 0, clientY: 0,
        defaultPrevented: false, propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        ...values,
      };
      for (const entry of listeners.get(type) ?? []) entry.callback(event);
      if (!event.propagationStopped) nativeHandler(event);
      return event;
    },
    get listenerCount() { return [...listeners.values()].reduce((sum, list) => sum + list.length, 0); },
  };
  const title = element();
  const marker = element();
  const row = element([title, marker]);
  const preview = element();
  const zone = element([preview]);
  const outside = element();
  const dataTransfer = transfer();
  const available = new Set(['history']);
  let allowed = true;
  const added = [];
  const drag = new HistoryDrag({
    events, available: id => available.has(id), allowed: () => allowed,
    add: id => added.push(id),
  });
  const unanchor = drag.anchor(marker, 'history');
  drag.setZone(zone);
  return {
    events, drag, title, marker, row, zone, preview, outside, dataTransfer, available, added, unanchor,
    setAllowed(value) { allowed = value; },
    down(values = {}) { return events.emit('pointerdown', { target: title, clientX: 60, clientY: 100, ...values }); },
    start(values = {}, nativeHandler) {
      return events.emit('dragstart', { target: row, clientX: 80, clientY: 102, dataTransfer, ...values }, nativeHandler);
    },
    begin() { this.down(); return this.start(); },
    drop(values = {}) { return events.emit('drop', { target: preview, dataTransfer, ...values }); },
  };
}

test('rightward history drag uses the registered row identity and adds only on an accepted drop', () => {
  const f = fixture();
  let nativeReorders = 0;
  let notifications = 0;
  const unsubscribe = f.drag.subscribe(() => { notifications += 1; });
  f.down();
  const start = f.start({}, () => { nativeReorders += 1; });
  assert.equal(start.propagationStopped, true);
  assert.equal(start.defaultPrevented, false, 'The browser drag itself must remain active.');
  assert.equal(nativeReorders, 0, 'Do not start native reorder state that can commit on dragend.');
  assert.equal(f.drag.getSnapshot().id, 'history');
  assert.equal(f.dataTransfer.effectAllowed, 'copy');
  assert.equal(f.dataTransfer.getData(MIME), 'history');
  assert.deepEqual(f.added, [], 'Previewing must not open or retain another conversation.');
  const over = f.events.emit('dragover', { target: f.preview, dataTransfer: f.dataTransfer });
  assert.equal(over.defaultPrevented, true);
  assert.equal(f.dataTransfer.dropEffect, 'copy');
  const drop = f.drop();
  assert.equal(drop.propagationStopped, true);
  assert.deepEqual(f.added, ['history']);
  assert.deepEqual(f.drag.getSnapshot(), {});
  f.drop();
  f.events.emit('dragend');
  assert.deepEqual(f.added, ['history'], 'Duplicate drop/end events must not add twice.');
  assert.equal(notifications, 2);
  unsubscribe();
  f.drag.dispose();
});

test('vertical, leftward and sub-threshold gestures stay available to native sidebar ordering', () => {
  for (const position of [
    { clientX: 61, clientY: 130 },
    { clientX: 65, clientY: 80 },
    { clientX: 40, clientY: 100 },
    { clientX: 62, clientY: 100 },
  ]) {
    const f = fixture();
    let nativeStarts = 0;
    f.down();
    const event = f.start(position, () => { nativeStarts += 1; });
    assert.equal(nativeStarts, 1);
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.propagationStopped, false);
    assert.deepEqual(f.drag.getSnapshot(), {});
    f.drop();
    assert.deepEqual(f.added, []);
    f.drag.dispose();
  }
});

test('latest pointer movement supplies direction when Chromium dragstart reports the press origin', () => {
  const f = fixture();
  f.down();
  f.events.emit('pointermove', { target: f.title, clientX: 82, clientY: 103, buttons: 1 });
  const event = f.start({ clientX: 60, clientY: 100 });
  assert.equal(event.propagationStopped, true, 'A rightward pointer movement must start split even if dragstart coordinates remain at the press origin.');
  assert.equal(f.drag.getSnapshot().id, 'history');
  f.drop();
  assert.deepEqual(f.added, ['history']);
  f.drag.dispose();

  const vertical = fixture();
  vertical.down();
  vertical.events.emit('pointermove', { target: vertical.title, clientX: 61, clientY: 125, buttons: 1 });
  assert.equal(vertical.start({ clientX: 60, clientY: 100 }).propagationStopped, false);
  assert.deepEqual(vertical.drag.getSnapshot(), {}, 'Vertical native ordering must still be preserved with press-origin dragstart coordinates.');
  vertical.drag.dispose();
});

test('unregistered, mismatched, unavailable and non-conversation drag sources are ignored', () => {
  const scenarios = [
    f => f.unanchor(),
    f => f.available.clear(),
    f => f.setAllowed(false),
    f => f.down({ target: f.outside }),
    f => f.down({ button: 2 }),
  ];
  for (const change of scenarios) {
    const f = fixture();
    f.down();
    change(f);
    const event = f.start();
    assert.equal(event.propagationStopped, false);
    assert.deepEqual(f.drag.getSnapshot(), {});
    f.drop();
    assert.deepEqual(f.added, []);
    f.drag.dispose();
  }
});

test('dragstart requires a live primary pointer origin and does not accept text or parent-container drags', () => {
  for (const reset of [undefined, 'pointerup', 'pointercancel']) {
    const f = fixture();
    if (reset) { f.down(); f.events.emit(reset); }
    assert.equal(f.start().propagationStopped, false);
    assert.deepEqual(f.drag.getSnapshot(), {});
    f.drag.dispose();
  }
  const f = fixture();
  f.down();
  assert.equal(f.start({ target: f.title }).propagationStopped, false, 'Dragging selected title text is not dragging the registered row.');
  const secondMarker = element();
  const parent = element([f.row, secondMarker]);
  f.drag.anchor(secondMarker, 'second-history');
  f.down();
  assert.equal(f.start({ target: parent }).propagationStopped, false, 'Ambiguous sources must not choose an arbitrary history row.');
  f.drag.dispose();
});

test('Escape, dragend and window blur cancel the preview without adding a session', () => {
  for (const [type, values] of [['keydown', { key: 'Escape' }], ['dragend', {}], ['blur', {}]]) {
    const f = fixture();
    f.begin();
    f.events.emit(type, values);
    assert.deepEqual(f.drag.getSnapshot(), {});
    f.drop();
    assert.deepEqual(f.added, []);
    assert.equal(f.start().propagationStopped, false, 'A cancelled gesture cannot reuse its old pointer origin.');
    f.drag.dispose();
  }
});

test('outside drop cancels the split gesture and cannot reach another drop handler', () => {
  const f = fixture();
  f.begin();
  const over = f.events.emit('dragover', { target: f.outside, dataTransfer: f.dataTransfer });
  assert.equal(over.propagationStopped, true);
  assert.equal(f.dataTransfer.dropEffect, 'none');
  let otherDrops = 0;
  const drop = f.events.emit('drop', { target: f.outside, dataTransfer: f.dataTransfer }, () => { otherDrops += 1; });
  assert.equal(drop.defaultPrevented, true);
  assert.equal(otherDrops, 0);
  assert.deepEqual(f.added, []);
  assert.deepEqual(f.drag.getSnapshot(), {});
  f.drag.dispose();
});

test('drop validates the gesture payload and rechecks the session and active panel', () => {
  for (const change of [
    f => f.dataTransfer.setData(MIME, 'another-session'),
    f => f.dataTransfer.setData(MIME, ''),
    f => f.available.clear(),
    f => f.setAllowed(false),
    f => f.drag.setZone(null),
  ]) {
    const f = fixture();
    f.begin();
    change(f);
    f.drop();
    assert.deepEqual(f.added, []);
    assert.deepEqual(f.drag.getSnapshot(), {});
    f.drag.dispose();
  }
  const f = fixture();
  f.dataTransfer.setData(MIME, 'history');
  assert.equal(f.drop().propagationStopped, false, 'An external matching payload alone is not a live gesture.');
  assert.deepEqual(f.added, []);
  f.drag.dispose();
});

test('disposal removes capture listeners and clears the active gesture', () => {
  const f = fixture();
  f.begin();
  assert.ok(f.events.listenerCount > 0);
  f.drag.dispose();
  f.drag.dispose();
  assert.equal(f.events.listenerCount, 0);
  assert.deepEqual(f.drag.getSnapshot(), {});
  f.down();
  assert.equal(f.start().propagationStopped, false);
  assert.equal(f.drop().propagationStopped, false);
  assert.deepEqual(f.added, []);
});
