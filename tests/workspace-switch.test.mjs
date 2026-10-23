import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/workspace-switch.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { isWorkspaceChoice, supersedesWorkspaceChoice } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`,
);

// Small DOM fixture: selectors use standard tag/attribute semantics. In
// particular, the menu is under body, not under the pane that owns it in React.
function element(tag, attributes = {}, children = []) {
  const node = {
    tag, attributes, children, parentElement: null,
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    matches(selector) {
      return selector.split(',').some(branch => {
        const candidate = branch.trim();
        const name = candidate.match(/^[a-z]+/i)?.[0];
        return (!name || name === this.tag) && [...candidate.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)]
          .every(([, key, value]) => this.hasAttribute(key) && (value === undefined || this.attributes[key] === value));
      });
    },
    closest(selector) {
      for (let current = this; current !== null; current = current.parentElement) {
        if (current.matches(selector)) return current;
      }
      return null;
    },
    querySelectorAll(selector) {
      return this.children.flatMap(child => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
      ]);
    },
    get previousElementSibling() {
      const siblings = this.parentElement?.children ?? [];
      return siblings[siblings.indexOf(this) - 1] ?? null;
    },
  };
  for (const child of children) child.parentElement = node;
  return node;
}

function fixture() {
  const anchor = element('button', { 'aria-haspopup': 'menu', 'aria-expanded': 'true' });
  const slot = element('div', { 'data-slot': 'conversation.hero.workspace' });
  const pane = element('section', { 'data-snap-session': 'source' }, [element('div', {}, [anchor, slot])]);
  const label = element('span');
  const item = element('button', { role: 'menuitem' }, [label]);
  const menu = element('div', { role: 'menu' }, [item]);
  const sidebarItem = element('button');
  const dialogControl = element('button');
  const body = element('body', {}, [pane, menu, element('aside', {}, [sidebarItem]), element('div', { role: 'dialog' }, [dialogControl])]);
  return { body, pane, anchor, slot, item, label, sidebarItem, dialogControl };
}

test('identifies a workspace choice rendered outside its pane by a portal', () => {
  const f = fixture();
  assert.equal(f.item.closest('[data-snap-session]'), null);
  assert.equal(isWorkspaceChoice(f.pane, f.item), true);
});

test('recognizes nested labels and icons in a workspace menu item', () => {
  const f = fixture();
  assert.equal(isWorkspaceChoice(f.pane, f.label), true);
});

test('does not arm when opening the workspace chip itself', () => {
  const f = fixture();
  assert.equal(isWorkspaceChoice(f.pane, f.anchor), false);
});

test('ignores disabled workspace choices', () => {
  const f = fixture();
  f.item.attributes.disabled = '';
  assert.equal(isWorkspaceChoice(f.pane, f.label), false);
  delete f.item.attributes.disabled;
  f.item.attributes['aria-disabled'] = 'true';
  assert.equal(isWorkspaceChoice(f.pane, f.label), false);
  f.item.attributes['aria-disabled'] = 'false';
  assert.equal(isWorkspaceChoice(f.pane, f.label), true);
});

test('a model or preset menu with the workspace picker closed is not a workspace choice', () => {
  const f = fixture();
  f.anchor.attributes['aria-expanded'] = 'false';
  assert.equal(isWorkspaceChoice(f.pane, f.item), false);
});

test('an unrelated open menu cannot replace the workspace slot contract', () => {
  const f = fixture();
  f.slot.attributes['data-slot'] = 'conversation.hero.agentPreset';
  assert.equal(isWorkspaceChoice(f.pane, f.item), false);
});

test('does not infer a workspace selection from a missing or non-menu anchor', () => {
  const f = fixture();
  delete f.anchor.attributes['aria-haspopup'];
  assert.equal(isWorkspaceChoice(f.pane, f.item), false);
  f.slot.parentElement.children = [f.slot];
  assert.equal(isWorkspaceChoice(f.pane, f.item), false);
});

test('an open picker in another pane does not arm the clicked pane', () => {
  const f = fixture();
  const otherPane = element('section', { 'data-snap-session': 'other' });
  assert.equal(isWorkspaceChoice(otherPane, f.item), false);
});

test('non-element and null click targets are harmless', () => {
  const f = fixture();
  for (const target of [null, {}, { nodeType: 3 }]) {
    assert.equal(isWorkspaceChoice(f.pane, target), false);
    assert.equal(supersedesWorkspaceChoice(target), false);
  }
});

test('a later sidebar navigation cancels any abandoned workspace intent', () => {
  const f = fixture();
  assert.equal(supersedesWorkspaceChoice(f.sidebarItem), true);
  assert.equal(supersedesWorkspaceChoice(f.body), true);
});

test('pane controls and workspace directory dialogs preserve an in-flight choice', () => {
  const f = fixture();
  assert.equal(supersedesWorkspaceChoice(f.anchor), false);
  assert.equal(supersedesWorkspaceChoice(f.dialogControl), false);
});

test('window capture clears the old portal intent before pane capture arms the current choice', () => {
  const f = fixture();
  let intent = 'previous';
  if (supersedesWorkspaceChoice(f.item)) intent = undefined;
  assert.equal(intent, undefined);
  if (isWorkspaceChoice(f.pane, f.item)) intent = 'source';
  assert.equal(intent, 'source');
});
