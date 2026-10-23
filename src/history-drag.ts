import { getSnapLayout, isSnapTarget, type SnapLayoutId, type SnapTarget } from './snap-layout';

const HISTORY_MIME = 'application/x-harness-chatsplit-session';
const PICKER_HEIGHT = 124;

export interface HistoryDragSnapshot {
  readonly id?: string;
  readonly left?: number;
  readonly target?: SnapTarget;
  readonly picker?: boolean;
  readonly area?: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
}

interface HistoryDragDependencies {
  events: Window;
  available(id: string): boolean;
  allowed(): boolean;
  layout(): SnapLayoutId | undefined;
  add(id: string, target?: SnapTarget): void;
}

/** Own only rightward drags from rows identified by our public row-action slot. */
export class HistoryDrag {
  private readonly anchors = new Map<HTMLElement, string>();
  private readonly targets = new Map<HTMLElement, SnapTarget>();
  private readonly listeners = new Set<() => void>();
  private snapshot: HistoryDragSnapshot = {};
  private origin?: { x: number; y: number; target: EventTarget | null; latest?: { x: number; y: number } };
  private zone: HTMLElement | null = null;
  private layoutZone: HTMLElement | null = null;
  private disposed = false;

  constructor(private readonly dependencies: HistoryDragDependencies) {
    const { events } = dependencies;
    events.addEventListener('pointerdown', this.pointerDown, true);
    events.addEventListener('pointermove', this.pointerMove, true);
    events.addEventListener('pointerup', this.pointerUp, true);
    events.addEventListener('pointercancel', this.pointerUp, true);
    events.addEventListener('dragstart', this.start, true);
    events.addEventListener('dragover', this.over, true);
    events.addEventListener('dragleave', this.leave, true);
    events.addEventListener('drop', this.drop, true);
    events.addEventListener('dragend', this.cancel, true);
    events.addEventListener('blur', this.cancel);
    events.addEventListener('keydown', this.keyDown, true);
  }

  readonly getSnapshot = (): HistoryDragSnapshot => this.snapshot;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly anchor = (element: HTMLElement, id: string): (() => void) => {
    if (this.disposed) return () => {};
    this.anchors.set(element, id);
    return () => { this.anchors.delete(element); };
  };
  readonly setZone = (element: HTMLElement | null): void => { this.zone = element; };
  readonly setLayoutZone = (element: HTMLElement | null): void => { this.layoutZone = element; };
  readonly registerTarget = (element: HTMLElement, target: SnapTarget): (() => void) => {
    if (this.disposed || !isSnapTarget(target)) return () => {};
    this.targets.set(element, target);
    return () => { if (this.targets.get(element) === target) this.targets.delete(element); };
  };

  readonly cancel = (): void => {
    this.origin = undefined;
    if (this.snapshot.id !== undefined) this.publish({});
  };

  readonly dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    const { events } = this.dependencies;
    events.removeEventListener('pointerdown', this.pointerDown, true);
    events.removeEventListener('pointermove', this.pointerMove, true);
    events.removeEventListener('pointerup', this.pointerUp, true);
    events.removeEventListener('pointercancel', this.pointerUp, true);
    events.removeEventListener('dragstart', this.start, true);
    events.removeEventListener('dragover', this.over, true);
    events.removeEventListener('dragleave', this.leave, true);
    events.removeEventListener('drop', this.drop, true);
    events.removeEventListener('dragend', this.cancel, true);
    events.removeEventListener('blur', this.cancel);
    events.removeEventListener('keydown', this.keyDown, true);
    this.cancel();
    this.anchors.clear();
    this.targets.clear();
    this.listeners.clear();
    this.zone = null;
    this.layoutZone = null;
  };

  private readonly pointerDown = (event: PointerEvent): void => {
    // A fresh press cannot resume a gesture whose native dragend was lost.
    this.cancel();
    this.origin = event.button === 0 ? { x: event.clientX, y: event.clientY, target: event.target } : undefined;
  };
  private readonly pointerUp = (): void => { this.origin = undefined; };
  private readonly pointerMove = (event: PointerEvent): void => {
    if (this.origin && (event.buttons & 1) !== 0) this.origin.latest = { x: event.clientX, y: event.clientY };
  };
  private readonly keyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.cancel();
  };
  private readonly start = (event: DragEvent): void => {
    const origin = this.origin;
    this.cancel();
    if (!origin || !event.dataTransfer || !this.dependencies.allowed()) return;
    // Chromium may report the original press coordinates on dragstart.
    const point = origin.latest ?? { x: event.clientX, y: event.clientY };
    const dx = point.x - origin.x;
    if (dx < 3 || dx < Math.abs(point.y - origin.y)) return;
    const source = event.target as HTMLElement | null;
    if (typeof source?.contains !== 'function' || typeof source.getBoundingClientRect !== 'function') return;
    if (origin.target === null || !source.contains(origin.target as Node)) return;
    const matches = [...this.anchors].filter(([element]) => source.contains(element));
    if (matches.length !== 1) return;
    const id = matches[0]![1];
    if (!this.dependencies.available(id)) return;
    // Capture precedes the row's native reorder handler. It must never start
    // a reorder whose dragend could commit an earlier sidebar hover target.
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(HISTORY_MIME, id);
    this.publish({ id, left: source.getBoundingClientRect().right + 12 });
  };
  private hit(event: DragEvent): Pick<HistoryDragSnapshot, 'picker' | 'target' | 'area'> {
    const zone = this.zone;
    if (!zone || !event.target || !zone.contains(event.target as Node)) return {};
    const rect = zone.getBoundingClientRect();
    const { clientX: x, clientY: y } = event;
    if (!Number.isFinite(x) || !Number.isFinite(y) || rect.width <= 0 || rect.height <= 0
      || x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return {};
    // Measure our rendered grid, including its offset below desktop chrome.
    // The same bounds drive both the hit test and the highlighted area.
    const grid = this.layoutZone?.getBoundingClientRect();
    const bounds = grid && grid.width > 0 && grid.height > 0 ? grid : rect;
    const area = bounds === rect ? undefined : {
      left: bounds.left - rect.left, top: bounds.top - rect.top, width: bounds.width, height: bounds.height,
    };
    // A cell owns both the event target and its geometry. Never inspect host DOM.
    for (const [element, target] of this.targets) {
      if (!zone.contains(element) || !element.contains(event.target as Node)) continue;
      const cell = element.getBoundingClientRect();
      if (x >= cell.left && x < cell.right && y >= cell.top && y < cell.bottom) {
        return { picker: true, target, area };
      }
    }
    // The picker includes its whitespace and caption: gaps are never drop targets.
    if (y < rect.top + PICKER_HEIGHT) return { picker: true };
    const layout = getSnapLayout(this.dependencies.layout() ?? 'columns');
    const relativeX = (x - bounds.left) / bounds.width;
    const relativeY = (y - bounds.top) / bounds.height;
    const slot = layout.cells.findIndex(cell => relativeX >= cell.x && relativeX < cell.x + cell.width
      && relativeY >= cell.y && relativeY < cell.y + cell.height);
    return slot < 0 ? {} : { target: { layout: layout.id, slot }, area };
  }
  private valid(id: string): boolean {
    return this.dependencies.allowed() && this.dependencies.available(id);
  }
  private readonly over = (event: DragEvent): void => {
    const { id, left } = this.snapshot;
    if (id === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.dataTransfer || !this.valid(id)) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      this.cancel();
      return;
    }
    const hit = this.hit(event);
    event.dataTransfer.dropEffect = hit.target ? 'copy' : 'none';
    this.publish({ id, left, ...hit });
  };
  private readonly leave = (event: DragEvent): void => {
    if (this.snapshot.id === undefined || event.relatedTarget !== null) return;
    const { innerWidth, innerHeight } = this.dependencies.events;
    if (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= innerWidth || event.clientY >= innerHeight) {
      // Entering native window chrome can look like leaving the viewport.
      // Clear the old destination, but keep this gesture until drop/dragend so
      // returning to the chat does not require pressing and dragging again.
      const { id, left } = this.snapshot;
      this.publish({ id, left });
    }
  };
  private readonly drop = (event: DragEvent): void => {
    const id = this.snapshot.id;
    if (id === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    // Resolve again at release: the pointer or window geometry may have changed
    // since the most recent dragover, or no dragover may have fired at all.
    const target = this.hit(event).target;
    const accepted = target && event.dataTransfer?.getData(HISTORY_MIME) === id && this.valid(id);
    this.cancel();
    if (accepted) this.dependencies.add(id, target);
  };
  private publish(snapshot: HistoryDragSnapshot): void {
    const previous = this.snapshot;
    if (previous.id === snapshot.id && previous.left === snapshot.left && previous.picker === snapshot.picker
      && previous.target?.layout === snapshot.target?.layout && previous.target?.slot === snapshot.target?.slot
      && previous.area?.left === snapshot.area?.left && previous.area?.top === snapshot.area?.top
      && previous.area?.width === snapshot.area?.width && previous.area?.height === snapshot.area?.height) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
