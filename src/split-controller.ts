export interface SplitReference {
  readonly ready: Promise<unknown>;
  release(): void;
}

export interface CatalogSession {
  readonly id: string;
  /** Whether this row is eligible as a new empty conversation. */
  readonly blank: boolean;
  readonly mainView: boolean;
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
  readonly error?: string;
  readonly notice?: 'limit';
}

function message(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
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
        catch (failure) { this.fail(message(failure)); }
      } while (this.resync && !this.disposed);
    } finally { this.busy = false; }
  };

  /** Add an explicitly dropped conversation without changing native selection. */
  readonly addHistory = (id: string): void => {
    if (this.disposed || this.busy || this.nativeTarget !== undefined || this.snapshot.ids.includes(id)) return;
    this.run(() => {
      const catalog = this.dependencies.catalog();
      if (!catalog.ready) return;
      const known = new Set(catalog.sessions.map(row => row.id));
      if (!known.has(id)) {
        this.fail('This conversation is no longer available.');
        return;
      }
      const existing = this.snapshot.ids.length > 0 ? this.snapshot.ids
        : this.current !== undefined && known.has(this.current) ? [this.current] : [];
      if (existing.length === 0 || existing.includes(id)) return;
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
      const remaining = this.snapshot.ids.filter(value => value !== id);
      if (remaining.length < 2) {
        this.returnNative(remaining[0], true);
        return;
      }
      this.publish({ ids: remaining });
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
      const target = id ?? (this.current !== undefined && this.snapshot.ids.includes(this.current)
        ? this.current : this.snapshot.ids[0] ?? this.current);
      if (target !== undefined && !this.dependencies.catalog().sessions.some(row => row.id === target)) {
        this.fail('This conversation is no longer available.');
        return;
      }
      this.returnNative(target, true);
    });
  };

  readonly dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
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
    const main = catalog.sessions.filter(row => row.mainView);
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
      if (this.snapshot.ids.length === 0 && this.acquire([selected])) {
        this.releaseExcept(new Set([selected]));
      }
      return;
    }

    const previous = this.current;
    this.current = selected;
    const newBlank = catalog.ready && this.candidates.delete(selected);
    if (!newBlank) this.candidates.clear();
    if (newBlank && previous !== undefined && rows.has(previous)) {
      if (this.snapshot.ids.includes(selected)) return;
      const existing = this.snapshot.ids.length > 0 ? this.snapshot.ids : [previous];
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
