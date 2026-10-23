import { getSnapLayout, isSnapTarget, type SnapPlacement, type SnapTarget } from './snap-layout';

export interface SplitReference {
  readonly ready: Promise<unknown>;
  release(): void;
}

export interface CatalogSession {
  readonly id: string;
  /** Whether this row is eligible as a new empty conversation. */
  readonly blank: boolean;
  readonly mainView: boolean;
  /** Native selection briefly holds two references, even when reopening its current draft. */
  readonly mainViewCount?: number;
}

export interface SplitCatalog {
  readonly ready: boolean;
  readonly sessions: readonly CatalogSession[];
}

export interface SplitDependencies {
  catalog(): SplitCatalog;
  subscribeCatalog(listener: () => void): () => void;
  retain(id: string): SplitReference;
  open(id: string): void;
  activate(): () => void;
}

export interface SplitSnapshot {
  /** An empty array means the native single-conversation view is active. */
  readonly ids: readonly string[];
  /** Spatial slots are independent of ids, which retain conversation recency order. */
  readonly placement?: SnapPlacement;
  readonly error?: string;
  readonly notice?: 'limit';
}

function message(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

function mainViewCount(row: CatalogSession): number {
  return row.mainViewCount ?? (row.mainView ? 1 : 0);
}

interface WorkspaceChange {
  readonly sourceId: string;
  readonly counts: ReadonlyMap<string, number>;
  readonly previousReferences: ReadonlySet<string>;
  readonly initialCurrent: string | undefined;
  target?: string;
  reference?: SplitReference;
  ready?: boolean;
}

/** Observe native session creation and own conversation lifetimes across view changes. */
export class SplitController {
  private snapshot: SplitSnapshot = { ids: [] };
  private readonly listeners = new Set<() => void>();
  private readonly references = new Map<string, SplitReference>();
  private readonly seen = new Set<string>();
  private readonly candidates = new Set<string>();
  private readyBaseline = false;
  private current: string | undefined;
  private nativeTarget: string | undefined;
  private deactivate: (() => void) | undefined;
  private unsubscribeCatalog: (() => void) | undefined;
  private busy = false;
  private resync = false;
  private disposed = false;
  private pendingPlacement: { readonly previousReferences: ReadonlySet<string> } | undefined;
  private workspaceChange: WorkspaceChange | undefined;
  private cancelledWorkspaceTarget: { readonly id: string; retainedAgain: boolean } | undefined;

  constructor(private readonly dependencies: SplitDependencies) {
    this.syncCatalog();
    this.unsubscribeCatalog = dependencies.subscribeCatalog(this.syncCatalog);
    this.syncCatalog();
  }

  readonly getSnapshot = (): SplitSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly ref = (id: string): SplitReference | undefined => this.references.get(id);

  readonly syncCatalog = (): void => {
    if (this.disposed) return;
    if (this.busy) { this.resync = true; return; }
    this.busy = true;
    try {
      do {
        this.resync = false;
        try { this.readCatalog(this.dependencies.catalog()); }
        catch (failure) { this.clearWorkspaceChange(); this.fail(message(failure)); }
      } while (this.resync && !this.disposed);
    } finally { this.busy = false; }
  };

  /** Scope the next native workspace selection to the pane that opened its picker. */
  readonly beginWorkspaceChange = (sourceId: string): void => {
    if (this.disposed || this.busy || this.nativeTarget !== undefined) return;
    this.run(() => {
      this.cancelledWorkspaceTarget = undefined;
      this.clearWorkspaceChange();
      if (!this.snapshot.ids.includes(sourceId)) return;
      // A preceding drag must not commit while native beforeOpen migrates the draft.
      this.cancelPlacement();
      const catalog = this.dependencies.catalog();
      this.workspaceChange = {
        sourceId,
        counts: new Map(catalog.sessions.map(row => [row.id, mainViewCount(row)])),
        previousReferences: new Set(this.references.keys()),
        initialCurrent: this.current,
      };
    });
  };

  readonly cancelWorkspaceChange = (): void => {
    if (this.disposed || this.busy) return;
    this.run(() => {
      const pending = this.workspaceChange;
      if (pending?.target !== undefined && pending.target === this.current && !this.snapshot.ids.includes(pending.target)) {
        // Native selection already moved, but this pane is still waiting for its
        // reference. A later explicit re-open must be treated as navigation even
        // though native selection keeps the same id. Our own release notification
        // is not that re-open: wait for its next native retain/release pair.
        this.cancelledWorkspaceTarget = { id: pending.target, retainedAgain: false };
      }
      this.clearWorkspaceChange();
    });
  };

  /** Add an explicitly dropped conversation without changing native selection. */
  readonly addHistory = (id: string, target?: SnapTarget): void => {
    if (this.disposed || this.busy || this.nativeTarget !== undefined) return;
    if (target !== undefined && (!target || !isSnapTarget(target))) return;
    this.run(() => {
      this.cancelledWorkspaceTarget = undefined;
      this.clearWorkspaceChange();
      if (target === undefined && this.snapshot.ids.includes(id)) return;
      const catalog = this.dependencies.catalog();
      if (!catalog.ready) return;
      const known = new Set(catalog.sessions.map(row => row.id));
      if (!known.has(id)) {
        this.fail('This conversation is no longer available.');
        return;
      }
      const existing = this.snapshot.ids.length > 0 ? this.snapshot.ids
        : this.current !== undefined && known.has(this.current) ? [this.current] : [];
      if (existing.length === 0) return;
      if (target !== undefined) {
        const placement = this.snapshot.placement;
        let slots: (string | null)[];
        let next: string[];
        if (placement?.layout === target.layout) {
          slots = [...placement.slots];
          const source = slots.indexOf(id);
          const displaced = slots[target.slot]!;
          if (source !== -1) {
            // Moving a visible pane swaps it with the destination, including an empty slot.
            slots[source] = displaced;
          } else if (displaced !== null) {
            const empty = slots.indexOf(null);
            if (empty !== -1) slots[empty] = displaced;
          }
          slots[target.slot] = id;
          next = existing.filter(value => slots.includes(value));
          if (!next.includes(id)) next.push(id);
        } else {
          const capacity = getSnapLayout(target.layout).cells.length;
          const others = existing.filter(value => value !== id).slice(-(capacity - 1));
          if (others.length === 0) return;
          next = existing.includes(id)
            ? existing.filter(value => value === id || others.includes(value)) : [...others, id];
          slots = Array(capacity).fill(null);
          slots[target.slot] = id;
          let index = 0;
          for (let slot = 0; slot < slots.length && index < others.length; slot += 1) {
            if (slot !== target.slot) slots[slot] = others[index++]!;
          }
        }
        const limited = existing.some(value => !next.includes(value));
        this.stagePlacement({ ids: next, placement: { layout: target.layout, slots }, ...(limited ? { notice: 'limit' as const } : {}) });
        this.candidates.delete(id);
        return;
      }
      if (existing.includes(id)) return;
      this.cancelPlacement();
      const limited = existing.length >= 4;
      const next = [...(limited ? existing.slice(-3) : existing), id];
      const previousReferences = new Set(this.references.keys());
      if (!this.acquire(next)) return;
      try { this.deactivate ??= this.dependencies.activate(); }
      catch (failure) {
        this.releaseExcept(previousReferences);
        this.fail(message(failure));
        return;
      }
      this.candidates.delete(id);
      this.publish(limited ? { ids: next, notice: 'limit' } : { ids: next });
      this.releaseExcept(new Set(next));
    });
  };

  readonly close = (id: string): void => {
    if (this.disposed || this.busy || !this.snapshot.ids.includes(id)) return;
    this.run(() => {
      this.cancelledWorkspaceTarget = undefined;
      this.clearWorkspaceChange();
      this.cancelPlacement();
      const remaining = this.snapshot.ids.filter(value => value !== id);
      if (remaining.length < 2) {
        this.returnNative(remaining[0], true);
        return;
      }
      const placement = this.snapshot.placement;
      this.publish({ ids: remaining, ...(placement ? {
        placement: { layout: placement.layout, slots: placement.slots.map(value => value === id ? null : value) },
      } : {}) });
      this.releaseExcept(new Set(remaining));
      if (this.current === id) {
        try { this.dependencies.open(remaining[remaining.length - 1]!); }
        catch (failure) { this.fail(message(failure)); }
      }
    });
  };

  readonly exit = (id?: string): void => {
    if (this.disposed || this.busy) return;
    this.run(() => {
      this.cancelledWorkspaceTarget = undefined;
      this.clearWorkspaceChange();
      const target = id ?? (this.current !== undefined && this.snapshot.ids.includes(this.current)
        ? this.current : this.snapshot.ids[0] ?? this.current);
      if (target !== undefined && !this.dependencies.catalog().sessions.some(row => row.id === target)) {
        this.fail('This conversation is no longer available.');
        return;
      }
      this.cancelPlacement();
      this.returnNative(target, true);
    });
  };

  readonly dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelledWorkspaceTarget = undefined;
    this.clearWorkspaceChange();
    this.cancelPlacement();
    const unsubscribe = this.unsubscribeCatalog;
    this.unsubscribeCatalog = undefined;
    try { unsubscribe?.(); }
    catch (failure) { this.fail(message(failure)); }
    this.restore();
    this.releaseExcept(new Set());
    this.candidates.clear();
    this.nativeTarget = undefined;
    this.snapshot = { ids: [] };
    this.listeners.clear();
  };

  private readCatalog(catalog: SplitCatalog): void {
    const rows = new Map(catalog.sessions.map(row => [row.id, row]));
    if (catalog.ready) {
      if (!this.readyBaseline) {
        this.readyBaseline = true;
        this.candidates.clear();
      } else {
        for (const row of catalog.sessions) {
          if (!this.seen.has(row.id) && row.blank) this.candidates.add(row.id);
        }
      }
      for (const row of catalog.sessions) this.seen.add(row.id);
      for (const candidate of this.candidates) {
        if (rows.get(candidate)?.blank !== true) this.candidates.delete(candidate);
      }
    }
    const main = catalog.sessions.filter(row => mainViewCount(row) > 0);
    if (this.workspaceChange !== undefined && this.readWorkspaceChange(catalog, main)) return;
    const cancelled = this.cancelledWorkspaceTarget;
    if (cancelled !== undefined) {
      if (main.some(row => row.id === cancelled.id && mainViewCount(row) > 1)) cancelled.retainedAgain = true;
      if (main.length === 1 && mainViewCount(main[0]!) === 1) {
        if (main[0]!.id !== cancelled.id) this.cancelledWorkspaceTarget = undefined;
        else if (cancelled.retainedAgain) {
          this.cancelledWorkspaceTarget = undefined;
          this.current = undefined;
        }
      }
    }
    // Native selection retains the incoming reference before releasing the old one.
    const selected = main.some(row => row.id === this.current)
      ? this.current : main.length === 1 ? main[0]!.id : undefined;
    if (selected === undefined) return;

    if (this.nativeTarget !== undefined) {
      if (selected === this.nativeTarget) {
        this.current = selected;
        this.nativeTarget = undefined;
        this.candidates.clear();
        if (this.acquire([selected])) this.releaseExcept(new Set([selected]));
        return;
      }
      if (selected === this.current) return;
      this.nativeTarget = undefined;
      this.candidates.clear();
    }

    if (selected === this.current) {
      if (this.pendingPlacement === undefined && this.snapshot.ids.length === 0 && this.acquire([selected])) {
        this.releaseExcept(new Set([selected]));
      }
      return;
    }

    this.cancelPlacement();
    const previous = this.current;
    this.current = selected;
    const newBlank = catalog.ready && this.candidates.delete(selected);
    if (!newBlank) this.candidates.clear();
    if (newBlank && previous !== undefined && rows.has(previous)) {
      if (this.snapshot.ids.includes(selected)) return;
      const existing = this.snapshot.ids.length > 0 ? this.snapshot.ids : [previous];
      const placement = this.snapshot.placement;
      const empty = placement?.slots.indexOf(null) ?? -1;
      if (placement !== undefined && empty !== -1) {
        const slots = [...placement.slots];
        slots[empty] = selected;
        const next = [...existing, selected];
        const previousReferences = new Set(this.references.keys());
        // Native New has already created and selected this draft. Display its
        // loading pane immediately so subsequent New actions append to it.
        if (!this.acquire(next)) return;
        try { this.deactivate ??= this.dependencies.activate(); }
        catch (failure) {
          this.releaseExcept(previousReferences);
          this.fail(message(failure));
          return;
        }
        this.publish({ ids: next, placement: { layout: placement.layout, slots } });
        this.releaseExcept(new Set(next));
        return;
      }
      const limited = existing.length >= 4;
      const next = [...(limited ? existing.slice(-3) : existing), selected];
      if (this.acquire(next)) {
        try {
          this.deactivate ??= this.dependencies.activate();
          this.publish(limited ? { ids: next, notice: 'limit' } : { ids: next });
          this.releaseExcept(new Set(next));
          return;
        } catch (failure) { this.fail(message(failure)); }
      }
      const error = this.snapshot.error;
      this.restore();
      this.publish(error === undefined ? { ids: [] } : { ids: [], error });
      if (this.references.has(selected)) this.releaseExcept(new Set([selected]));
      return;
    }

    if (this.snapshot.ids.includes(selected)) return;
    const retained = this.acquire([selected]);
    const error = retained ? undefined : this.snapshot.error;
    this.restore();
    this.publish(error === undefined ? { ids: [] } : { ids: [], error });
    if (retained) this.releaseExcept(new Set([selected]));
  }

  private readWorkspaceChange(catalog: SplitCatalog, main: readonly CatalogSession[]): boolean {
    const pending = this.workspaceChange!;
    if (!catalog.ready) return true;
    if (!this.snapshot.ids.includes(pending.sourceId)) {
      this.clearWorkspaceChange();
      return false;
    }
    // Retain happens before native beforeOpen, selection.set and old-reference release.
    // Its count increase also identifies a destination that is already current.
    const incoming = main.find(row => mainViewCount(row) > (pending.counts.get(row.id) ?? 0));
    pending.target ??= incoming?.id;
    if (pending.target !== undefined && !catalog.sessions.some(row => row.id === pending.target)) {
      this.clearWorkspaceChange();
      this.candidates.clear();
      if (main.length === 1 && mainViewCount(main[0]!) === 1) this.current = main[0]!.id;
      this.fail('This conversation is no longer available.');
      return true;
    }
    if (main.length !== 1 || mainViewCount(main[0]!) !== 1) return true;
    const selected = main[0]!.id;
    if (pending.target === undefined && selected !== pending.initialCurrent) pending.target = selected;
    if (pending.target === undefined) return true;
    if (selected !== pending.target) {
      // Its temporary native reference was released: navigation either rolled
      // back or was superseded. Do not let the old picker consume a later New.
      this.clearWorkspaceChange();
      this.candidates.clear();
      return false;
    }
    this.current = selected;
    this.candidates.clear();
    if (selected === pending.sourceId) {
      this.clearWorkspaceChange();
      return true;
    }
    if (pending.reference === undefined) {
      if (!this.acquire([selected])) {
        this.clearWorkspaceChange();
        return true;
      }
      pending.reference = this.references.get(selected)!;
      void pending.reference.ready.then(() => {
        if (this.disposed || this.workspaceChange !== pending) return;
        pending.ready = true;
        this.syncCatalog();
      }, (failure: unknown) => {
        if (this.disposed || this.workspaceChange !== pending) return;
        this.run(() => { this.clearWorkspaceChange(); this.fail(message(failure)); });
      });
    }
    if (!pending.ready) return true;
    const visible = this.snapshot.ids.includes(selected);
    const replace = (id: string | null): string | null => id === pending.sourceId ? selected
      : visible && id === selected ? pending.sourceId : id;
    const placement = this.snapshot.placement;
    const ids = visible && placement ? this.snapshot.ids : this.snapshot.ids.map(id => replace(id)!);
    this.workspaceChange = undefined;
    this.publish({ ids, ...(placement ? {
      placement: { layout: placement.layout, slots: placement.slots.map(replace) },
    } : {}) });
    this.releaseExcept(new Set(ids));
    return true;
  }

  private clearWorkspaceChange(): void {
    const pending = this.workspaceChange;
    if (pending === undefined) return;
    this.workspaceChange = undefined;
    this.releaseExcept(pending.previousReferences);
  }

  private returnNative(target: string | undefined, navigate: boolean): void {
    if (target !== undefined && !this.acquire([target])) return;
    this.candidates.clear();
    this.nativeTarget = target;
    this.publish({ ids: [] });
    this.restore();
    this.releaseExcept(new Set([this.current, target].filter((id): id is string => id !== undefined)));
    if (navigate && target !== undefined) {
      try { this.dependencies.open(target); }
      catch (failure) { this.fail(message(failure)); }
    }
    this.resync = true;
  }

  /** Commit explicit layouts only after every conversation is usable. */
  private stagePlacement(next: SplitSnapshot): void {
    this.cancelPlacement();
    const pending = { previousReferences: new Set(this.references.keys()) };
    this.pendingPlacement = pending;
    if (!this.acquire(next.ids)) {
      this.cancelPlacement();
      return;
    }
    const ready = next.ids.map(id => this.references.get(id)!.ready);
    void Promise.all(ready).then(() => {
      if (this.disposed || this.pendingPlacement !== pending) return;
      this.run(() => {
        try {
          const catalog = this.dependencies.catalog();
          if (!catalog.ready || next.ids.some(id => !catalog.sessions.some(row => row.id === id))) {
            throw new Error('This conversation is no longer available.');
          }
          this.deactivate ??= this.dependencies.activate();
        }
        catch (failure) {
          this.cancelPlacement();
          this.fail(message(failure));
          return;
        }
        this.pendingPlacement = undefined;
        this.publish(next);
        this.releaseExcept(new Set(next.ids));
      });
    }, (failure: unknown) => {
      if (this.disposed || this.pendingPlacement !== pending) return;
      this.run(() => {
        this.cancelPlacement();
        this.fail(message(failure));
      });
    });
  }

  private cancelPlacement(): void {
    const pending = this.pendingPlacement;
    if (pending === undefined) return;
    this.pendingPlacement = undefined;
    this.releaseExcept(pending.previousReferences);
  }

  private acquire(ids: readonly string[]): boolean {
    const acquired: string[] = [];
    try {
      for (const id of ids) {
        if (this.references.has(id)) continue;
        const reference = this.dependencies.retain(id);
        this.references.set(id, reference);
        acquired.push(id);
        void reference.ready.catch((failure: unknown) => {
          if (!this.disposed && this.references.get(id) === reference) this.fail(message(failure));
        });
      }
      return true;
    } catch (failure) {
      for (const id of acquired) this.release(id);
      this.fail(message(failure));
      return false;
    }
  }

  private run(operation: () => void): void {
    this.busy = true;
    try { operation(); }
    catch (failure) { this.fail(message(failure)); }
    finally {
      this.busy = false;
      if (this.resync) this.syncCatalog();
    }
  }

  private restore(): void {
    const dispose = this.deactivate;
    this.deactivate = undefined;
    try { dispose?.(); }
    catch (failure) { this.fail(message(failure)); }
  }

  private releaseExcept(retained: ReadonlySet<string>): void {
    for (const id of this.references.keys()) if (!retained.has(id)) this.release(id);
  }

  private release(id: string): void {
    const reference = this.references.get(id);
    this.references.delete(id);
    try { reference?.release(); }
    catch (failure) { this.fail(message(failure)); }
  }

  private fail(error: string): void {
    if (this.snapshot.error !== error) this.publish({ ...this.snapshot, error });
  }

  private publish(snapshot: SplitSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of [...this.listeners]) listener();
  }
}
