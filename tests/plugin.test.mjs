import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const bundle = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const translate = key => key;

function loadBundle() {
  let loaded;
  const required = [];
  const eventListeners = new Map();
  const events = {
    addEventListener(type, listener) {
      const list = eventListeners.get(type) ?? new Set();
      list.add(listener); eventListeners.set(type, list);
    },
    removeEventListener(type, listener) { eventListeners.get(type)?.delete(listener); },
    emit(type, values) {
      const event = { preventDefault() {}, stopPropagation() {}, ...values };
      for (const listener of eventListeners.get(type) ?? []) listener(event);
    },
  };
  vm.runInNewContext(bundle, {
    window: { __ModuleLoader__: { load(value) { loaded = value; } }, setTimeout, clearTimeout,
      ...events },
    console,
  }, { filename: 'client.js' });
  assert.ok(loaded, 'The official loader entry must be registered.');
  const activate = () => loaded.factory(name => {
    required.push(name);
    assert.equal(name, 'react', 'Host implementation modules must not be runtime imports.');
    return React;
  });
  return { loaded, required, activate, events };
}

function catalog() {
  const ids = ['alpha', 'history'];
  const byId = Object.fromEntries(ids.map(id => [id, {
    id, displayTitle: `Conversation ${id}`, origin: 'root', blank: false,
    retainedBy: id === 'alpha' ? { mainView: 1 } : {},
  }]));
  return { ids, byId, phase: 'ready' };
}

function setup() {
  let state = catalog();
  const runtime = loadBundle();
  const plugin = runtime.activate();
  const registrations = new Map();
  const declared = new Set(['main', 'shell.overlay', 'sidebar.workspaces.session.row.action']);
  const watchers = new Map();
  const references = [];
  const dictionaries = new Map();
  const effects = [];
  const catalogListeners = new Set();
  const navigations = [];
  const forbiddenRequests = [];
  const readiness = new Map();
  const once = callback => {
    let live = true;
    return () => { if (live) { live = false; callback?.(); } };
  };
  const emit = () => { for (const listener of [...catalogListeners]) listener(); };
  const select = id => {
    state = { ...state, byId: Object.fromEntries(Object.entries(state.byId).map(([key, row]) => [key, {
      ...row, retainedBy: key === id ? { mainView: 1 } : {},
    }])) };
    emit();
  };
  const activateWatchers = name => {
    for (const watcher of watchers.get(name) ?? []) {
      if (watcher.dispose === undefined) watcher.dispose = once(watcher.install());
    }
  };
  const ctx = {
    effect(callback) {
      const dispose = once(callback());
      effects.push(dispose);
      return dispose;
    },
    locale: {
      register(namespace, values) {
        dictionaries.set(namespace, values);
        return () => dictionaries.delete(namespace);
      },
      bind: () => translate,
    },
    slots: {
      inject(name, install) {
        const watcher = { install, dispose: undefined };
        const list = watchers.get(name) ?? [];
        list.push(watcher);
        watchers.set(name, list);
        if (declared.has(name)) activateWatchers(name);
        const dispose = once(() => {
          watcher.dispose?.();
          watchers.set(name, list.filter(value => value !== watcher));
        });
        effects.push(dispose);
        return dispose;
      },
      register(options, component) {
        assert.ok(declared.has(options.name), `Slot ${options.name} must have a live declaring owner.`);
        const key = `${options.name}:${options.key ?? options.id ?? ''}`;
        assert.ok(!registrations.has(key), `Duplicate test registration ${key}`);
        registrations.set(key, { options, component });
        for (const child of Object.keys(options.children ?? {})) {
          assert.ok(!declared.has(child), `Child slot ${child} must have one owner.`);
          declared.add(child);
          activateWatchers(child);
        }
        return once(() => {
          for (const child of Object.keys(options.children ?? {})) {
            for (const watcher of watchers.get(child) ?? []) {
              watcher.dispose?.();
              watcher.dispose = undefined;
            }
            declared.delete(child);
          }
          registrations.delete(key);
        });
      },
    },
    sessions: {
      list: {
        getSnapshot: () => state,
        subscribe(listener) { catalogListeners.add(listener); return () => catalogListeners.delete(listener); },
      },
      retain(id, options) {
        const ref = { sessionId: id, ready: readiness.get(id) ?? Promise.resolve(), released: 0, release() { ref.released += 1; } };
        references.push({ id, options, ref });
        return ref;
      },
      create(...args) { forbiddenRequests.push(['create', ...args]); throw new Error('Only native New may create sessions.'); },
      send(...args) { forbiddenRequests.push(['send', ...args]); throw new Error('The split plugin must not send prompts.'); },
    },
    uiWorkspace: { openSession(id) { navigations.push(id); select(id); } },
    layout: {
      panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe: () => () => {} },
      selectPanel() {},
    },
  };
  plugin.apply(ctx);
  const overlay = [...registrations.values()].find(entry => entry.options.name === 'shell.overlay');
  assert.ok(overlay);
  const actions = overlay.options.inject();
  return {
    ...runtime, plugin, registrations, references, dictionaries, overlay, actions,
    controller: actions.controller, catalogListeners, navigations, forbiddenRequests,
    readiness,
    get state() { return state; },
    get main() { return registrations.get('main:conversation'); },
    get chat() { return [...registrations.values()].find(entry => entry.options.name === Object.keys(this.main?.options.children ?? {})[0]); },
    add(id, { blank = true, main = false, origin = 'root' } = {}) {
      assert.ok(!state.byId[id]);
      state = { ...state, ids: [...state.ids, id], byId: {
        ...state.byId, [id]: { id, displayTitle: `Conversation ${id}`, origin, blank, retainedBy: {} },
      } };
      emit();
      if (main) select(id);
    },
    select,
    workspaceSelect(id, beforeOpen = () => {}) {
      state = { ...state, byId: { ...state.byId, [id]: {
        ...state.byId[id], retainedBy: { mainView: (state.byId[id].retainedBy.mainView ?? 0) + 1 },
      } } };
      emit();
      beforeOpen();
      select(id);
    },
    dispose: once(() => { for (const effect of effects.reverse()) effect(); }),
  };
}

function splitFromNativeNew(harness) {
  harness.add('native-new');
  harness.select('native-new');
  assert.ok(harness.main, 'A newly created blank session becoming the native main view should start a split.');
}

function embeddedProps(harness, renderFactorySlot) {
  return {
    sessionId: 'alpha', t: translate,
    useSession: selector => selector({ blank: false, awaitingFirstTurn: false, running: true, openState: 'open' }),
    useConversation: selector => selector({ activeTargets: new Set() }),
    useSessions: selector => selector(harness.state),
    renderFactorySlot,
  };
}

function chooseWorkspace(harness, renderer, source) {
  // The native menu is portalled outside the pane, but its React capture event
  // still reaches the originating SessionPane after the window capture listener.
  const item = { hasAttribute: () => false, getAttribute: () => null };
  const target = { closest: selector => selector === 'button[role="menuitem"]' ? item : null };
  const currentTarget = { querySelectorAll: () => [{ previousElementSibling: { matches: () => true } }] };
  harness.events.emit('click', { target });
  renderer.root.findByProps({ 'data-snap-session': source }).props.onClickCapture({ currentTarget, target });
}

async function renderSplit(harness) {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(harness.main.component, {
      ...harness.actions, t: translate, useSessions: selector => selector(harness.state),
      SessionProvider: ({ session, children }) => React.createElement('div', { 'data-reference': session.sessionId }, children),
      renderSlot: () => null,
    }));
  });
  return renderer;
}

for (const reused of [false, true]) {
  test(`native workspace picker replaces only its pane and keeps a four-cell layout (${reused ? 'reused' : 'new'} blank)`, async () => {
    const harness = setup();
    let renderer;
    try {
      if (reused) harness.add('project-blank');
      await act(async () => { harness.controller.addHistory('history', { layout: 'grid', slot: 3 }); });
      harness.add('source-blank', { main: true });
      harness.select('alpha'); // The picker belongs to a pane other than native main.
      renderer = await renderSplit(harness);
      const sourceRef = harness.controller.ref('source-blank');
      const alphaRef = harness.controller.ref('alpha');
      const historyRef = harness.controller.ref('history');
      await act(async () => {
        chooseWorkspace(harness, renderer, 'source-blank');
        harness.events.emit('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
        if (!reused) harness.add('project-blank');
        harness.workspaceSelect('project-blank', () => {
          assert.equal(sourceRef.released, 0, 'The source draft must remain retained until native beforeOpen transfers it.');
          assert.ok(harness.main, 'The split must stay mounted during native navigation.');
        });
      });
      assert.deepEqual([...harness.controller.getSnapshot().placement.slots], ['alpha', 'project-blank', null, 'history']);
      assert.equal(harness.controller.getSnapshot().placement.layout, 'grid');
      assert.equal(renderer.root.findAllByProps({ className: 'dsh-snap-empty' }).length, 1);
      assert.equal(sourceRef.released, 1);
      assert.equal(harness.controller.ref('alpha'), alphaRef);
      assert.equal(harness.controller.ref('history'), historyRef);
      assert.deepEqual(harness.navigations, []);
      assert.equal(harness.forbiddenRequests.length, 0);
    } finally {
      await act(async () => { renderer?.unmount(); });
      harness.dispose();
    }
    assert.ok(harness.references.every(value => value.ref.released === 1));
  });
}

test('workspace choice targeting the already-current visible blank uses native retain counts and swaps cells', async () => {
  const harness = setup();
  let renderer;
  try {
    await act(async () => { harness.controller.addHistory('history', { layout: 'grid', slot: 3 }); });
    harness.add('source-blank', { main: true });
    harness.add('target-blank', { main: true });
    renderer = await renderSplit(harness);
    const originalRefs = harness.references.filter(value => value.ref.released === 0);
    await act(async () => {
      chooseWorkspace(harness, renderer, 'source-blank');
      harness.workspaceSelect('target-blank'); // mainView for this ID changes 1 -> 2 -> 1.
    });
    assert.deepEqual([...harness.controller.getSnapshot().placement.slots], ['alpha', 'target-blank', 'source-blank', 'history']);
    assert.ok(originalRefs.every(value => value.ref.released === 0));
    assert.equal(harness.references.length, originalRefs.length);
  } finally {
    await act(async () => { renderer?.unmount(); });
    harness.dispose();
  }
});

for (const dismiss of ['sidebar click', 'Escape', 'New shortcut']) {
  test(`abandoned workspace choice is cleared by ${dismiss} so ordinary history navigation still works`, async () => {
    const harness = setup();
    let renderer;
    try {
      splitFromNativeNew(harness);
      renderer = await renderSplit(harness);
      chooseWorkspace(harness, renderer, 'native-new');
      if (dismiss === 'Escape') harness.events.emit('keydown', { key: 'Escape' });
      else if (dismiss === 'New shortcut') harness.events.emit('keydown', { key: 'n', code: 'KeyN', ctrlKey: true });
      else harness.events.emit('click', { target: { closest: () => null } });
      await act(async () => { harness.select('history'); });
      assert.equal(harness.main, undefined);
      assert.deepEqual([...harness.controller.getSnapshot().ids], []);
      assert.equal(harness.controller.ref('history').released, 0);
    } finally {
      await act(async () => { renderer?.unmount(); });
      harness.dispose();
    }
  });
}

test('clicking the same destination in the sidebar while a workspace pane is loading opens it normally', async () => {
  const harness = setup();
  let renderer;
  let ready;
  try {
    splitFromNativeNew(harness);
    renderer = await renderSplit(harness);
    harness.add('slow-project');
    harness.readiness.set('slow-project', new Promise(resolve => { ready = resolve; }));
    await act(async () => {
      chooseWorkspace(harness, renderer, 'native-new');
      harness.workspaceSelect('slow-project');
    });
    assert.deepEqual([...harness.controller.getSnapshot().ids], ['alpha', 'native-new']);
    await act(async () => {
      harness.events.emit('click', { target: { closest: () => null } });
      harness.workspaceSelect('slow-project');
    });
    assert.equal(harness.main, undefined);
    assert.equal(harness.controller.ref('slow-project').released, 0);
    await act(async () => { ready(); });
    assert.deepEqual([...harness.controller.getSnapshot().ids], []);
  } finally {
    ready?.();
    await act(async () => { renderer?.unmount(); });
    harness.dispose();
  }
});

test('browser artifact remains lazy and imports only host-shared React', () => {
  const loader = loadBundle();
  assert.equal(loader.loaded.id, manifest.name);
  assert.deepEqual(loader.required, []);
  const plugin = loader.activate();
  assert.equal(typeof plugin.apply, 'function');
  assert.deepEqual(loader.required, ['react']);
  assert.deepEqual([...plugin.inject], ['slots', 'sessions', 'uiWorkspace', 'locale', 'layout']);
  assert.equal(manifest.exports['./client'], './client.js');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.equal(manifest.engines.dsh, '0.2.1-rc.2');
});

test('installation preserves native chat with an invisible history anchor and no sidebar panel', () => {
  const harness = setup();
  try {
    assert.equal(harness.registrations.size, 2);
    assert.equal(harness.main, undefined);
    assert.ok([...harness.registrations.values()].some(value => value.options.name === 'sidebar.workspaces.session.row.action'));
    assert.equal(harness.navigations.length, 0);
    assert.equal(harness.forbiddenRequests.length, 0);
    assert.equal(harness.dictionaries.size, 1);
    assert.ok(harness.references.every(value => value.id === 'alpha' && value.options.source !== 'mainView'));
  } finally { harness.dispose(); }
  assert.equal(harness.registrations.size, 0);
  assert.equal(harness.catalogListeners.size, 0);
  assert.equal(harness.dictionaries.size, 0);
  assert.ok(harness.references.every(value => value.ref.released === 1));
});

test('native New catalog and main-view events activate the conversation override without creating or sending', () => {
  const harness = setup();
  try {
    harness.add('native-new');
    assert.equal(harness.main, undefined, 'Catalog discovery alone must not split or navigate.');
    harness.select('native-new');
    assert.ok(harness.main);
    assert.equal(harness.main.options.key, 'conversation');
    assert.ok(harness.main.options.priority < 0);
    const children = Object.entries(harness.main.options.children);
    assert.equal(children.length, 1);
    assert.notEqual(children[0][0], 'main.conversation');
    assert.notEqual(children[0][0], 'conversation.header');
    assert.equal(children[0][1].scope, 'session');
    assert.ok(harness.chat);
    assert.deepEqual([...harness.controller.getSnapshot().ids], ['alpha', 'native-new']);
    assert.deepEqual(harness.references.filter(value => value.ref.released === 0).map(value => value.id), ['alpha', 'native-new']);
    assert.equal(harness.navigations.length, 0, 'Native navigation already selected the new conversation.');
    assert.equal(harness.forbiddenRequests.length, 0);
  } finally { harness.dispose(); }
  assert.equal(harness.registrations.size, 0);
  assert.ok(harness.references.every(value => value.ref.released === 1));
});

test('history and subagent catalog rows do not look like a native New conversation', () => {
  const harness = setup();
  try {
    harness.select('history');
    assert.equal(harness.main, undefined);
    assert.deepEqual([...harness.controller.getSnapshot().ids], []);
    harness.add('synced-history', { blank: false, main: true });
    assert.equal(harness.main, undefined);
    assert.deepEqual([...harness.controller.getSnapshot().ids], []);
    harness.add('delegated-child', { origin: 'subagent', main: true });
    assert.equal(harness.main, undefined, 'The client must exclude blank subagents from native New detection.');
    assert.equal(harness.navigations.length, 0);
    assert.equal(harness.forbiddenRequests.length, 0);
  } finally { harness.dispose(); }
});

test('split panes bind independent native SessionProviders and closing restores native navigation', async () => {
  const harness = setup();
  splitFromNativeNew(harness);
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(harness.main.component, {
        ...harness.main.options.inject(), t: translate,
        useSessions: selector => selector(harness.state),
        SessionProvider: ({ session, children }) => React.createElement('div', { 'data-reference': session.sessionId }, children),
        renderSlot: name => React.createElement('div', { 'data-rendered-slot': name }),
      }));
    });
    assert.deepEqual(renderer.root.findAll(node => node.props['data-reference']).map(node => node.props['data-reference']), ['alpha', 'native-new']);
    await act(async () => { renderer.root.findByProps({ 'aria-label': 'close: Conversation native-new' }).props.onClick(); });
    assert.equal(harness.main, undefined);
    assert.deepEqual(harness.navigations, ['alpha']);
    assert.ok(harness.references.filter(value => value.id === 'native-new').every(value => value.ref.released === 1));
    assert.equal(harness.forbiddenRequests.length, 0);
  } finally {
    await act(async () => { renderer?.unmount(); });
    harness.dispose();
  }
  assert.ok(harness.references.every(value => value.ref.released === 1));
});

test('embedded chat delegates to the official content factory and omits removed sessions', async () => {
  const harness = setup();
  splitFromNativeNew(harness);
  const calls = [];
  const props = embeddedProps(harness, (name, input, options) => {
    calls.push({ name, input, options });
    return React.createElement('div', { 'data-factory': name });
  });
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(harness.chat.component, props)); });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'conversation.content');
    assert.equal(calls[0].input.variant, 'embedded');
    assert.equal(calls[0].input.phase, 'active');
    let view;
    calls[0].options.slots.views({ renderSlot(name, input) { view = { name, input }; return null; } });
    assert.equal(view.name, 'conversation.session');
    assert.equal(view.input.view, 'chat');
    await act(async () => { renderer.update(React.createElement(harness.chat.component, {
      ...props, useSession: selector => selector({ removed: true }),
    })); });
    assert.equal(calls.length, 1);
    assert.equal(renderer.root.findAllByProps({ role: 'status' }).length, 1);
  } finally {
    await act(async () => { renderer?.unmount(); });
    harness.dispose();
  }
});

test('global overlay adds no replacement New button or draggable UI', async () => {
  const harness = setup();
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(harness.overlay.component, { ...harness.actions, t: translate }));
    });
    assert.equal(renderer.root.findAllByType('button').length, 0);
    assert.equal(renderer.root.findAll(node => node.props.draggable === true).length, 0);
    assert.equal(harness.main, undefined);
    assert.equal(harness.forbiddenRequests.length, 0);
  } finally {
    await act(async () => { renderer?.unmount(); });
    harness.dispose();
  }
});

test('selected snap layout places conversations into the requested cells and keeps empty cells available', async () => {
  const harness = setup();
  let renderer;
  try {
    await act(async () => { harness.controller.addHistory('history', { layout: 'grid', slot: 3 }); });
    assert.ok(harness.main);
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(harness.main.component, {
        ...harness.actions, t: translate, useSessions: selector => selector(harness.state),
        SessionProvider: ({ session, children }) => React.createElement('div', { 'data-reference': session.sessionId }, children),
        renderSlot: () => null,
      }));
    });
    assert.equal(renderer.root.findByProps({ className: 'dsh-snap-grid' }).props['data-snap-layout'], 'grid');
    const history = renderer.root.findByProps({ 'data-snap-session': 'history' });
    assert.deepEqual({ ...history.props.style }, { gridColumn: '7 / span 6', gridRow: '2 / span 1' });
    assert.equal(renderer.root.findAllByProps({ className: 'dsh-snap-empty' }).length, 2);
    await act(async () => { harness.add('native-new', { main: true }); });
    assert.equal(renderer.root.findAllByProps({ className: 'dsh-snap-empty' }).length, 1);
    assert.equal(renderer.root.findByProps({ 'data-snap-session': 'history' }).props.style.gridColumn, '7 / span 6');
    assert.equal(harness.forbiddenRequests.length, 0);
  } finally {
    await act(async () => { renderer?.unmount(); });
    harness.dispose();
  }
});

test('drag overlay highlights one target and only exposes layout choices during a top drag', async () => {
  const harness = setup();
  let snapshot = { id: 'history', left: 280, target: { layout: 'columns', slot: 0 }, picker: false };
  const listeners = new Set();
  const targets = new Map();
  let zone;
  const historyDrag = {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setZone(element) { zone = element; },
    registerTarget(element, target) { targets.set(element, target); return () => targets.delete(element); },
  };
  const update = value => { snapshot = value; for (const listener of listeners) listener(); };
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(harness.overlay.component, {
        controller: harness.controller, historyDrag, t: translate,
      }), { createNodeMock: () => ({}) });
    });
    assert.ok(zone);
    assert.equal(renderer.root.findByProps({ className: 'dsh-snap-highlight' }).props.style.left, '0%');
    assert.equal(targets.size, 0);
    await act(async () => { update({ ...snapshot, target: { layout: 'columns', slot: 1 } }); });
    assert.equal(renderer.root.findByProps({ className: 'dsh-snap-highlight' }).props.style.left, '50%');
    await act(async () => { update({ ...snapshot, picker: true, target: { layout: 'grid', slot: 2 } }); });
    assert.equal(targets.size, 16);
    assert.equal(renderer.root.findAllByProps({ 'data-snap-active': true }).length, 1);
    assert.equal(renderer.root.findByProps({ className: 'dsh-snap-highlight' }).props.style.top, '50%');
    await act(async () => { update({ ...snapshot, target: undefined }); });
    assert.equal(renderer.root.findAllByProps({ className: 'dsh-snap-highlight' }).length, 0);
    await act(async () => { update({ ...snapshot, picker: false, target: { layout: 'grid', slot: 1 },
      area: { left: 20, top: 40, width: 800, height: 600 } }); });
    assert.deepEqual({ ...renderer.root.findByProps({ className: 'dsh-snap-preview-surface' }).props.style },
      { left: 20, top: 40, width: 800, height: 600, right: 'auto', bottom: 'auto' });
    assert.equal(renderer.root.findByProps({ className: 'dsh-snap-highlight' }).props.style.height, '50%');
    await act(async () => { update({}); });
    assert.equal(targets.size, 0);
    assert.equal(zone, null);
    assert.equal(renderer.root.findAllByProps({ className: 'dsh-snap-picker' }).length, 0);
  } finally {
    await act(async () => { renderer?.unmount(); });
    harness.dispose();
  }
});

test('history drag uses the selected layout through the plugin and fills its empty cell without moving existing panes', async () => {
  const harness = setup();
  try {
    await act(async () => { harness.controller.addHistory('history', { layout: 'grid', slot: 3 }); });
    harness.add('second-history', { blank: false });
    const drag = harness.actions.historyDrag;
    const marker = {};
    const row = { contains: value => value === marker || value === row,
      getBoundingClientRect: () => ({ right: 268 }) };
    const zone = { contains: value => value === zone,
      getBoundingClientRect: () => ({ left: 280, top: 0, right: 1280, bottom: 800, width: 1000, height: 800 }) };
    drag.anchor(marker, 'second-history');
    drag.setZone(zone);
    const values = new Map();
    const dataTransfer = { setData: (type, value) => values.set(type, value), getData: type => values.get(type) ?? '' };
    harness.events.emit('pointerdown', { button: 0, target: marker, clientX: 60, clientY: 300 });
    harness.events.emit('dragstart', { target: row, clientX: 80, clientY: 300, dataTransfer });
    harness.events.emit('dragover', { target: zone, clientX: 500, clientY: 600, dataTransfer });
    assert.equal(drag.getSnapshot().target.layout, 'grid');
    assert.equal(drag.getSnapshot().target.slot, 2);
    await act(async () => {
      harness.events.emit('drop', { target: zone, clientX: 500, clientY: 600, dataTransfer });
    });
    assert.equal(harness.controller.getSnapshot().placement.layout, 'grid');
    assert.deepEqual([...harness.controller.getSnapshot().placement.slots], ['alpha', null, 'second-history', 'history']);
    assert.equal(harness.forbiddenRequests.length, 0);
  } finally { harness.dispose(); }
});
