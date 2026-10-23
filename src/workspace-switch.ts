/**
 * Harness 0.2.1 exposes the picker through an addressable slot, but its
 * selection callback still navigates the global main view. Observe the native
 * click before that callback runs; keep all draft and attachment handling native.
 * React capture also reaches a pane when its menu is portalled to document.body.
 */
export function isWorkspaceChoice(pane: Element, target: EventTarget | null): boolean {
  const element = target as Element | null;
  if (typeof element?.closest !== 'function') return false;
  const item = element.closest('button[role="menuitem"]');
  if (item === null || item.hasAttribute('disabled') || item.getAttribute('aria-disabled') === 'true') return false;
  return [...pane.querySelectorAll('[data-slot="conversation.hero.workspace"]')].some(slot => {
    const anchor = slot.previousElementSibling;
    return anchor?.matches('button[aria-haspopup="menu"][aria-expanded="true"]') === true;
  });
}

/** A new action outside the pane supersedes a failed or abandoned workspace pick. */
export function supersedesWorkspaceChoice(target: EventTarget | null): boolean {
  const element = target as Element | null;
  if (typeof element?.closest !== 'function') return false;
  return element.closest('[data-snap-session], [role="dialog"]') === null;
}
