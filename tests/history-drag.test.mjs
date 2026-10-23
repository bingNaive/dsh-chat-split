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
  const rect = { left: 0, top: 0, right, bottom: 800 };
  return {
    children,
    setRect(bounds) { Object.assign(rect, bounds); },
    contains(candidate) { return this === candidate || children.some(child => child.contains(candidate)); },
    getBoundingClientRect() { return { ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top }; },
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
    innerWidth: 1280, innerHeight: 800,
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
        target: null, relatedTarget: null, button: 0, clientX: 500, clientY: 300,
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
  zone.setRect({ left: 280, right: 1280 });
  const outside = element();
  const dataTransfer = transfer();
  const available = new Set(['history']);
  let allowed = true;
  let layout;
  const added = [];
  const placements = [];
  const drag = new HistoryDrag({
    events, available: id => available.has(id), allowed: () => allowed, layout: () => layout,
    add: (id, target) => { added.push(id); placements.push(target); },
  });
  const unanchor = drag.anchor(marker, 'history');
  drag.setZone(zone);
  return {
    events, drag, title, marker, row, zone, preview, outside, dataTransfer, available, added, placements, unanchor,
    setAllowed(value) { allowed = value; },
    setLayout(value) { layout = value; },
    down(values = {}) { return events.emit('pointerdown', { target: title, clientX: 60, clientY: 100, ...values }); },
    start(values = {}, nativeHandler) {
      return events.emit('dragstart', { target: row, clientX: 80, clientY: 102, dataTransfer, ...values }, nativeHandler);
    },
    begin() { this.down(); return this.start(); },
    over(values = {}) { return events.emit('dragover', { target: preview, dataTransfer, ...values }); },
    drop(values = {}) { return events.emit('drop', { target: preview, dataTransfer, ...values }); },
    cell(target, bounds) {
      const child = element();
      const cell = element([child]);
      cell.setRect(bounds);
      zone.children.push(cell);
      const unregister = drag.registerTarget(cell, target);
      return { cell, child, unregister };
    },
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
  assert.equal(notifications, 3);
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

test('left and right halves preview and place exactly at the horizontal seam', () => {
  for (const [x, slot] of [[280, 0], [779.9, 0], [780, 1], [1279.9, 1]]) {
    const f = fixture();
    f.begin();
    f.over({ clientX: x, clientY: 124 });
    assert.deepEqual(f.drag.getSnapshot().target, { layout: 'columns', slot });
    assert.equal(f.drag.getSnapshot().picker, undefined);
    assert.equal(f.dataTransfer.dropEffect, 'copy');
    f.drop({ clientX: x, clientY: 124 });
    assert.deepEqual(f.placements, [{ layout: 'columns', slot }]);
    f.drag.dispose();
  }
});

test('subsequent drags use all four current grid cells, including both horizontal and vertical seams', () => {
  for (const [x, y, slot] of [
    [500, 200, 0], [1000, 200, 1], [500, 600, 2], [1000, 600, 3],
    [779.9, 399.9, 0], [780, 399.9, 1], [779.9, 400, 2], [780, 400, 3],
  ]) {
    const f = fixture();
    f.setLayout('grid');
    f.begin();
    f.over({ clientX: x, clientY: y });
    assert.deepEqual(f.drag.getSnapshot().target, { layout: 'grid', slot });
    f.drop({ clientX: x, clientY: y });
    assert.deepEqual(f.placements, [{ layout: 'grid', slot }]);
    f.drag.dispose();
  }
});

test('body placement follows the selected unequal, three-column and stacked layouts', () => {
  for (const [layout, points] of [
    ['wide-left', [[900, 300, 0], [1100, 300, 1]]],
    ['wide-right', [[500, 300, 0], [700, 300, 1]]],
    ['three-columns', [[500, 300, 0], [800, 300, 1], [1100, 300, 2]]],
    ['left-stack', [[500, 600, 0], [1000, 200, 1], [1000, 600, 2]]],
  ]) {
    for (const [x, y, slot] of points) {
      const f = fixture();
      f.setLayout(layout);
      f.begin();
      f.over({ clientX: x, clientY: y });
      assert.deepEqual(f.drag.getSnapshot().target, { layout, slot });
      f.drop({ clientX: x, clientY: y });
      assert.deepEqual(f.placements, [{ layout, slot }]);
      f.drag.dispose();
    }
  }
});

test('drop reads the current layout again, and returning to a single chat restores default halves', () => {
  const f = fixture();
  f.setLayout('grid');
  f.begin();
  f.over({ clientX: 1000, clientY: 600 });
  assert.deepEqual(f.drag.getSnapshot().target, { layout: 'grid', slot: 3 });
  f.setLayout('left-stack');
  f.drop({ clientX: 1000, clientY: 600 });
  assert.deepEqual(f.placements, [{ layout: 'left-stack', slot: 2 }]);
  f.setLayout(undefined);
  f.begin();
  f.drop({ clientX: 1000, clientY: 600 });
  assert.deepEqual(f.placements[1], { layout: 'columns', slot: 1 });
  f.drag.dispose();
});

test('a selected grid still permits an explicit layout change from the top picker', () => {
  const f = fixture();
  f.setLayout('grid');
  const target = { layout: 'wide-left', slot: 1 };
  const { child } = f.cell(target, { left: 400, right: 450, top: 24, bottom: 80 });
  f.begin();
  f.over({ target: child, clientX: 420, clientY: 50 });
  assert.deepEqual(f.drag.getSnapshot().target, target);
  f.drop({ target: child, clientX: 420, clientY: 50 });
  assert.deepEqual(f.placements, [target]);
  f.drag.dispose();
});

test('grid hit testing and preview share the rendered area below the titlebar and update after resizing', () => {
  const f = fixture();
  f.setLayout('grid');
  const grid = element();
  grid.setRect({ left: 300, top: 60, right: 1280, bottom: 800 });
  f.drag.setLayoutZone(grid);
  f.begin();
  f.over({ clientX: 500, clientY: 420 });
  assert.deepEqual(f.drag.getSnapshot().target, { layout: 'grid', slot: 0 }, 'Use the visible grid midpoint at 430, not the overlay midpoint at 400.');
  assert.deepEqual(f.drag.getSnapshot().area, { left: 20, top: 60, width: 980, height: 740 });
  grid.setRect({ bottom: 700 });
  f.over({ clientX: 500, clientY: 420 });
  assert.deepEqual(f.drag.getSnapshot().area, { left: 20, top: 60, width: 980, height: 640 });
  f.drop({ clientX: 500, clientY: 420 });
  assert.deepEqual(f.placements, [{ layout: 'grid', slot: 2 }]);
  f.begin();
  f.drop({ clientX: 290, clientY: 300 });
  assert.equal(f.placements.length, 1, 'Space outside the rendered grid is not a cell.');
  f.drag.setLayoutZone(null);
  f.drag.dispose();
});

test('top strip shows the layout picker but whitespace never accepts a drop', () => {
  for (const [x, y] of [[280, 0], [500, 10], [1100, 70], [600, 123.9]]) {
    const f = fixture();
    f.begin();
    f.over({ clientX: x, clientY: y });
    assert.equal(f.drag.getSnapshot().picker, true);
    assert.equal(f.drag.getSnapshot().target, undefined);
    assert.equal(f.dataTransfer.dropEffect, 'none');
    f.drop({ clientX: x, clientY: y });
    assert.deepEqual(f.added, []);
    assert.deepEqual(f.drag.getSnapshot(), {});
    f.drag.dispose();
  }
});

test('each owned mini-cell previews its layout and slot, including descendant targets', () => {
  const layouts = { columns: 2, 'wide-left': 2, 'wide-right': 2, 'three-columns': 3, 'left-stack': 3, grid: 4 };
  for (const [layout, count] of Object.entries(layouts)) {
    for (let slot = 0; slot < count; slot += 1) {
      const f = fixture();
      const target = { layout, slot };
      const { child } = f.cell(target, { left: 400, right: 450, top: 24, bottom: 80 });
      f.begin();
      f.over({ clientX: 420, clientY: 50, target: child });
      assert.deepEqual(f.drag.getSnapshot().target, target);
      assert.equal(f.drag.getSnapshot().picker, true);
      assert.equal(f.dataTransfer.dropEffect, 'copy');
      f.drop({ clientX: 420, clientY: 50, target: child });
      assert.deepEqual(f.placements, [target]);
      f.drag.dispose();
    }
  }
});

test('picker cell hit tests require both registered ownership and actual bounds', () => {
  for (const scenario of ['wrong-element', 'outside-cell', 'right-edge', 'bottom-edge', 'unregistered', 'detached']) {
    const f = fixture();
    const { cell, child, unregister } = f.cell({ layout: 'grid', slot: 3 }, { left: 400, right: 450, top: 24, bottom: 80 });
    const point = { clientX: 420, clientY: 50, target: child };
    if (scenario === 'wrong-element') point.target = f.preview;
    if (scenario === 'outside-cell') point.clientX = 399;
    if (scenario === 'right-edge') point.clientX = 450;
    if (scenario === 'bottom-edge') point.clientY = 80;
    if (scenario === 'unregistered') unregister();
    if (scenario === 'detached') f.zone.children.splice(f.zone.children.indexOf(cell), 1);
    f.begin();
    f.over(point);
    assert.equal(f.drag.getSnapshot().target, undefined, scenario);
    assert.equal(f.dataTransfer.dropEffect, 'none', scenario);
    f.drop(point);
    assert.deepEqual(f.added, [], scenario);
    f.drag.dispose();
  }
});

test('leaving a mini-cell for a picker gap clears only selection, entering body closes picker', () => {
  const f = fixture();
  const { child } = f.cell({ layout: 'grid', slot: 3 }, { left: 400, right: 450, top: 24, bottom: 80 });
  f.begin();
  f.over({ target: child, clientX: 420, clientY: 50 });
  f.over({ clientX: 500, clientY: 100 });
  assert.equal(f.drag.getSnapshot().picker, true);
  assert.equal(f.drag.getSnapshot().target, undefined);
  f.over({ clientX: 1000, clientY: 300 });
  assert.equal(f.drag.getSnapshot().picker, undefined);
  assert.deepEqual(f.drag.getSnapshot().target, { layout: 'columns', slot: 1 });
  f.drag.dispose();
});

test('drop recomputes placement from release coordinates rather than retaining stale preview', () => {
  const f = fixture();
  f.begin();
  f.over({ clientX: 500, clientY: 300 });
  f.drop({ clientX: 1000, clientY: 300 });
  assert.deepEqual(f.placements, [{ layout: 'columns', slot: 1 }]);
  f.drag.dispose();

  const gap = fixture();
  const { child } = gap.cell({ layout: 'grid', slot: 2 }, { left: 400, right: 450, top: 24, bottom: 80 });
  gap.begin();
  gap.over({ target: child, clientX: 420, clientY: 50 });
  gap.drop({ clientX: 500, clientY: 70 });
  assert.deepEqual(gap.added, [], 'Release into a gap must not use the previously highlighted mini-cell.');
  gap.drag.dispose();
});

test('release without dragover computes directional or registered mini-cell placement', () => {
  const f = fixture();
  f.begin();
  f.drop({ clientX: 1000, clientY: 300 });
  assert.deepEqual(f.placements, [{ layout: 'columns', slot: 1 }]);
  f.drag.dispose();

  const picker = fixture();
  const target = { layout: 'left-stack', slot: 2 };
  const { child } = picker.cell(target, { left: 400, right: 450, top: 24, bottom: 80 });
  picker.begin();
  picker.drop({ target: child, clientX: 420, clientY: 50 });
  assert.deepEqual(picker.placements, [target]);
  picker.drag.dispose();
});

test('resize and shifted chat area use current geometry on drop', () => {
  const f = fixture();
  f.begin();
  f.over({ clientX: 700, clientY: 300 });
  assert.equal(f.drag.getSnapshot().target.slot, 0);
  f.zone.setRect({ left: 280, right: 1000, top: 50, bottom: 700 });
  f.drop({ clientX: 700, clientY: 300 });
  assert.deepEqual(f.placements, [{ layout: 'columns', slot: 1 }]);
  f.drag.dispose();

  const shifted = fixture();
  shifted.zone.setRect({ top: 100, bottom: 700 });
  shifted.begin();
  shifted.over({ clientY: 223 });
  assert.equal(shifted.drag.getSnapshot().picker, true, 'Top activation is relative to the chat area.');
  shifted.over({ clientY: 224 });
  assert.equal(shifted.drag.getSnapshot().target.slot, 0);
  shifted.zone.setRect({ right: 400 });
  shifted.drop({ clientX: 500, clientY: 300 });
  assert.deepEqual(shifted.added, [], 'A now-outside release cannot use a stale accepted area.');
  shifted.drag.dispose();
});

test('outside zone geometry clears preview even when the event target is still owned', () => {
  for (const point of [
    { clientX: 279 }, { clientX: 1280 }, { clientY: -1 }, { clientY: 800 },
    { clientX: Number.NaN }, { clientY: Number.POSITIVE_INFINITY }, { target: 'outside' },
  ]) {
    const f = fixture();
    f.begin();
    f.over();
    if (point.target === 'outside') point.target = f.outside;
    f.over(point);
    assert.equal(f.drag.getSnapshot().id, 'history');
    assert.equal(f.drag.getSnapshot().target, undefined);
    assert.equal(f.drag.getSnapshot().picker, undefined);
    assert.equal(f.dataTransfer.dropEffect, 'none');
    f.drop(point);
    assert.deepEqual(f.added, []);
    f.drag.dispose();
  }
});

test('missing transfer or permission/session changes cancel active previews safely', () => {
  for (const [change, values] of [
    [f => f.setAllowed(false), {}],
    [f => f.available.clear(), {}],
    [() => {}, { dataTransfer: null }],
  ]) {
    const f = fixture();
    f.begin();
    f.over();
    change(f);
    f.over(values);
    assert.deepEqual(f.drag.getSnapshot(), {});
    f.drop();
    assert.deepEqual(f.added, []);
    f.drag.dispose();
  }
  const start = fixture();
  start.down();
  assert.equal(start.start({ dataTransfer: null }).propagationStopped, false);
  assert.deepEqual(start.drag.getSnapshot(), {});
  start.drag.dispose();
  const drop = fixture();
  drop.begin();
  drop.over();
  drop.drop({ dataTransfer: null });
  assert.deepEqual(drop.added, []);
  assert.deepEqual(drop.drag.getSnapshot(), {});
  drop.drag.dispose();
});

test('dragleave between descendants does not flicker', () => {
  const f = fixture();
  f.begin();
  f.over();
  const before = f.drag.getSnapshot();
  f.events.emit('dragleave', { target: f.preview, relatedTarget: f.zone, clientX: 0, clientY: 0 });
  assert.equal(f.drag.getSnapshot(), before);
  f.events.emit('dragleave', { target: f.preview, relatedTarget: null, clientX: 500, clientY: 300 });
  assert.equal(f.drag.getSnapshot(), before);
  f.drag.dispose();
});

test('leaving for window chrome preserves the gesture and returning resumes directional placement', () => {
  for (const point of [
    { clientX: 500, clientY: 0 }, { clientX: 500, clientY: -20 },
    { clientX: 0, clientY: 300 }, { clientX: 1280, clientY: 300 },
    { clientX: 500, clientY: 800 }, { clientX: 0, clientY: 0 },
  ]) {
    const f = fixture();
    f.begin();
    f.over({ clientX: 500, clientY: 300 });
    const left = f.drag.getSnapshot().left;
    f.events.emit('dragleave', { relatedTarget: null, ...point });
    assert.deepEqual(f.drag.getSnapshot(), { id: 'history', left });
    assert.deepEqual(f.added, [], 'Leaving the renderer cannot commit a placement.');
    f.over({ clientX: 1000, clientY: 300 });
    assert.deepEqual(f.drag.getSnapshot().target, { layout: 'columns', slot: 1 });
    f.drop({ clientX: 1000, clientY: 300 });
    assert.deepEqual(f.placements, [{ layout: 'columns', slot: 1 }]);
    f.drag.dispose();
  }
});

test('a drag can cross the top edge repeatedly and return to a layout cell without restarting', () => {
  const f = fixture();
  const target = { layout: 'grid', slot: 3 };
  const { child } = f.cell(target, { left: 400, right: 450, top: 24, bottom: 80 });
  f.begin();
  for (let pass = 0; pass < 3; pass += 1) {
    f.over({ target: child, clientX: 420, clientY: 50 });
    assert.deepEqual(f.drag.getSnapshot().target, target);
    f.events.emit('dragleave', { relatedTarget: null, clientX: 420, clientY: 0 });
    assert.equal(f.drag.getSnapshot().target, undefined);
    assert.equal(f.drag.getSnapshot().picker, undefined);
    assert.equal(f.drag.getSnapshot().id, 'history');
  }
  f.over({ clientX: 500, clientY: 10 });
  assert.equal(f.drag.getSnapshot().picker, true);
  f.over({ target: child, clientX: 420, clientY: 50 });
  f.drop({ target: child, clientX: 420, clientY: 50 });
  assert.deepEqual(f.placements, [target]);
  f.drag.dispose();
});

test('ending or cancelling outside the renderer never revives the old drag on return', () => {
  for (const [type, values] of [
    ['dragend', {}], ['keydown', { key: 'Escape' }], ['blur', {}],
    ['pointerdown', { target: null }],
  ]) {
    const f = fixture();
    f.begin();
    f.over();
    f.events.emit('dragleave', { clientX: 500, clientY: 0 });
    f.events.emit(type, values);
    assert.deepEqual(f.drag.getSnapshot(), {});
    f.over();
    f.drop();
    assert.deepEqual(f.added, [], type);
    assert.deepEqual(f.drag.getSnapshot(), {});
    f.drag.dispose();
  }
});

test('release outside after leaving cannot commit the previously highlighted region', () => {
  const f = fixture();
  f.begin();
  f.over();
  f.events.emit('dragleave', { clientX: 500, clientY: 0 });
  f.drop({ target: f.outside, clientX: 500, clientY: -20 });
  assert.deepEqual(f.added, []);
  assert.deepEqual(f.drag.getSnapshot(), {});
  f.drag.dispose();
});

test('unregistered cell and disposed target registrations cannot restore a stale picker selection', () => {
  const f = fixture();
  const { child, unregister } = f.cell({ layout: 'grid', slot: 0 }, { left: 400, right: 450, top: 24, bottom: 80 });
  f.begin();
  f.over({ target: child, clientX: 420, clientY: 50 });
  unregister();
  f.drop({ target: child, clientX: 420, clientY: 50 });
  assert.deepEqual(f.added, []);
  f.drag.dispose();
  const cleanup = f.drag.registerTarget(child, { layout: 'columns', slot: 0 });
  cleanup();
  assert.equal(f.events.listenerCount, 0);
});
