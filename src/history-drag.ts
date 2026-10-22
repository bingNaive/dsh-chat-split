const HISTORY_MIME = 'application/x-harness-chatsplit-session';

export interface HistoryDragSnapshot {
  readonly id?: string;
  readonly left?: number;
}

interface HistoryDragDependencies {
  events: Window;
  available(id: string): boolean;
  allowed(): boolean;
  add(id: string): void;
}

/** Own only rightward drags from rows identified by our public row-action slot. */
export class HistoryDrag {
  private readonly anchors = new Map<HTMLElement, string>();
  private readonly listeners = new Set<() => void>();
  private snapshot: HistoryDragSnapshot = {};
  private origin?: { x: number; y: number; target: EventTarget | null; latest?: { x: number; y: number } };
  private zone: HTMLElement | null = null;
  private disposed = false;

  constructor(private readonly dependencies: HistoryDragDependencies) {
    const { events } = dependencies;
    events.addEventListener('pointerdown', this.pointerDown, true);
    events.addEventListener('pointermove', this.pointerMove, true);
    events.addEventListener('pointerup', this.pointerUp, true);
    events.addEventListener('pointercancel', this.pointerUp, true);
    events.addEventListener('dragstart', this.start, true);
    events.addEventListener('dragover', this.over, true);
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
    events.removeEventListener('drop', this.drop, true);
    events.removeEventListener('dragend', this.cancel, true);
    events.removeEventListener('blur', this.cancel);
    events.removeEventListener('keydown', this.keyDown, true);
    this.cancel();
    this.anchors.clear();
    this.listeners.clear();
    this.zone = null;
  };

  private readonly pointerDown = (event: PointerEvent): void => {
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
  private inZone(event: DragEvent): boolean {
    return this.zone !== null && event.target !== null && this.zone.contains(event.target as Node);
  }
  private readonly over = (event: DragEvent): void => {
    if (this.snapshot.id === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = this.inZone(event) ? 'copy' : 'none';
  };
  private readonly drop = (event: DragEvent): void => {
    const id = this.snapshot.id;
    if (id === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const accepted = this.inZone(event) && event.dataTransfer?.getData(HISTORY_MIME) === id
      && this.dependencies.allowed() && this.dependencies.available(id);
    this.cancel();
    if (accepted) this.dependencies.add(id);
  };
  private publish(snapshot: HistoryDragSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
