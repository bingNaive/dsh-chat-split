// Built from src/client.tsx. React is supplied by Harness.
window.__ModuleLoader__.load({
  id: "@local/deepseek-multi-agent-dashboard",
  factory(require) {
    const module = { exports: {} };
    const exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react = __toESM(require("react"), 1);

// src/snap-layout.ts
var SNAP_LAYOUTS = [
  { id: "columns", cells: [{ x: 0, y: 0, width: 0.5, height: 1 }, { x: 0.5, y: 0, width: 0.5, height: 1 }] },
  { id: "wide-left", cells: [{ x: 0, y: 0, width: 2 / 3, height: 1 }, { x: 2 / 3, y: 0, width: 1 / 3, height: 1 }] },
  { id: "wide-right", cells: [{ x: 0, y: 0, width: 1 / 3, height: 1 }, { x: 1 / 3, y: 0, width: 2 / 3, height: 1 }] },
  { id: "three-columns", cells: [{ x: 0, y: 0, width: 1 / 3, height: 1 }, { x: 1 / 3, y: 0, width: 1 / 3, height: 1 }, { x: 2 / 3, y: 0, width: 1 / 3, height: 1 }] },
  { id: "left-stack", cells: [{ x: 0, y: 0, width: 0.5, height: 1 }, { x: 0.5, y: 0, width: 0.5, height: 0.5 }, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }] },
  { id: "grid", cells: [{ x: 0, y: 0, width: 0.5, height: 0.5 }, { x: 0.5, y: 0, width: 0.5, height: 0.5 }, { x: 0, y: 0.5, width: 0.5, height: 0.5 }, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }] }
];
function getSnapLayout(id) {
  return SNAP_LAYOUTS.find((layout) => layout.id === id);
}
function isSnapTarget(value) {
  const layout = SNAP_LAYOUTS.find((layout2) => layout2.id === value.layout);
  return layout !== void 0 && Number.isInteger(value.slot) && value.slot >= 0 && value.slot < layout.cells.length;
}

// src/split-controller.ts
function message(failure) {
  return failure instanceof Error ? failure.message : String(failure);
}
var SplitController = class {
  constructor(dependencies) {
    this.dependencies = dependencies;
    this.syncCatalog();
    this.unsubscribeCatalog = dependencies.subscribeCatalog(this.syncCatalog);
    this.syncCatalog();
  }
  snapshot = { ids: [] };
  listeners = /* @__PURE__ */ new Set();
  references = /* @__PURE__ */ new Map();
  seen = /* @__PURE__ */ new Set();
  candidates = /* @__PURE__ */ new Set();
  readyBaseline = false;
  current;
  nativeTarget;
  deactivate;
  unsubscribeCatalog;
  busy = false;
  resync = false;
  disposed = false;
  pendingPlacement;
  getSnapshot = () => this.snapshot;
  subscribe = (listener) => {
    if (this.disposed) return () => {
    };
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  ref = (id) => this.references.get(id);
  syncCatalog = () => {
    if (this.disposed) return;
    if (this.busy) {
      this.resync = true;
      return;
    }
    this.busy = true;
    try {
      do {
        this.resync = false;
        try {
          this.readCatalog(this.dependencies.catalog());
        } catch (failure) {
          this.fail(message(failure));
        }
      } while (this.resync && !this.disposed);
    } finally {
      this.busy = false;
    }
  };
  /** Add an explicitly dropped conversation without changing native selection. */
  addHistory = (id, target) => {
    if (this.disposed || this.busy || this.nativeTarget !== void 0) return;
    if (target !== void 0 && (!target || !isSnapTarget(target))) return;
    if (target === void 0 && this.snapshot.ids.includes(id)) return;
    this.run(() => {
      const catalog = this.dependencies.catalog();
      if (!catalog.ready) return;
      const known = new Set(catalog.sessions.map((row) => row.id));
      if (!known.has(id)) {
        this.fail("This conversation is no longer available.");
        return;
      }
      const existing = this.snapshot.ids.length > 0 ? this.snapshot.ids : this.current !== void 0 && known.has(this.current) ? [this.current] : [];
      if (existing.length === 0) return;
      if (target !== void 0) {
        const placement = this.snapshot.placement;
        let slots;
        let next2;
        if (placement?.layout === target.layout) {
          slots = [...placement.slots];
          const source = slots.indexOf(id);
          const displaced = slots[target.slot];
          if (source !== -1) {
            slots[source] = displaced;
          } else if (displaced !== null) {
            const empty = slots.indexOf(null);
            if (empty !== -1) slots[empty] = displaced;
          }
          slots[target.slot] = id;
          next2 = existing.filter((value) => slots.includes(value));
          if (!next2.includes(id)) next2.push(id);
        } else {
          const capacity = getSnapLayout(target.layout).cells.length;
          const others = existing.filter((value) => value !== id).slice(-(capacity - 1));
          if (others.length === 0) return;
          next2 = existing.includes(id) ? existing.filter((value) => value === id || others.includes(value)) : [...others, id];
          slots = Array(capacity).fill(null);
          slots[target.slot] = id;
          let index = 0;
          for (let slot = 0; slot < slots.length && index < others.length; slot += 1) {
            if (slot !== target.slot) slots[slot] = others[index++];
          }
        }
        const limited2 = existing.some((value) => !next2.includes(value));
        this.stagePlacement({ ids: next2, placement: { layout: target.layout, slots }, ...limited2 ? { notice: "limit" } : {} });
        this.candidates.delete(id);
        return;
      }
      if (existing.includes(id)) return;
      this.cancelPlacement();
      const limited = existing.length >= 4;
      const next = [...limited ? existing.slice(-3) : existing, id];
      const previousReferences = new Set(this.references.keys());
      if (!this.acquire(next)) return;
      try {
        this.deactivate ??= this.dependencies.activate();
      } catch (failure) {
        this.releaseExcept(previousReferences);
        this.fail(message(failure));
        return;
      }
      this.candidates.delete(id);
      this.publish(limited ? { ids: next, notice: "limit" } : { ids: next });
      this.releaseExcept(new Set(next));
    });
  };
  close = (id) => {
    if (this.disposed || this.busy || !this.snapshot.ids.includes(id)) return;
    this.run(() => {
      this.cancelPlacement();
      const remaining = this.snapshot.ids.filter((value) => value !== id);
      if (remaining.length < 2) {
        this.returnNative(remaining[0], true);
        return;
      }
      const placement = this.snapshot.placement;
      this.publish({ ids: remaining, ...placement ? {
        placement: { layout: placement.layout, slots: placement.slots.map((value) => value === id ? null : value) }
      } : {} });
      this.releaseExcept(new Set(remaining));
      if (this.current === id) {
        try {
          this.dependencies.open(remaining[remaining.length - 1]);
        } catch (failure) {
          this.fail(message(failure));
        }
      }
    });
  };
  exit = (id) => {
    if (this.disposed || this.busy) return;
    this.run(() => {
      const target = id ?? (this.current !== void 0 && this.snapshot.ids.includes(this.current) ? this.current : this.snapshot.ids[0] ?? this.current);
      if (target !== void 0 && !this.dependencies.catalog().sessions.some((row) => row.id === target)) {
        this.fail("This conversation is no longer available.");
        return;
      }
      this.cancelPlacement();
      this.returnNative(target, true);
    });
  };
  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPlacement();
    const unsubscribe = this.unsubscribeCatalog;
    this.unsubscribeCatalog = void 0;
    try {
      unsubscribe?.();
    } catch (failure) {
      this.fail(message(failure));
    }
    this.restore();
    this.releaseExcept(/* @__PURE__ */ new Set());
    this.candidates.clear();
    this.nativeTarget = void 0;
    this.snapshot = { ids: [] };
    this.listeners.clear();
  };
  readCatalog(catalog) {
    const rows = new Map(catalog.sessions.map((row) => [row.id, row]));
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
    const main = catalog.sessions.filter((row) => row.mainView);
    const selected = main.some((row) => row.id === this.current) ? this.current : main.length === 1 ? main[0].id : void 0;
    if (selected === void 0) return;
    if (this.nativeTarget !== void 0) {
      if (selected === this.nativeTarget) {
        this.current = selected;
        this.nativeTarget = void 0;
        this.candidates.clear();
        if (this.acquire([selected])) this.releaseExcept(/* @__PURE__ */ new Set([selected]));
        return;
      }
      if (selected === this.current) return;
      this.nativeTarget = void 0;
      this.candidates.clear();
    }
    if (selected === this.current) {
      if (this.pendingPlacement === void 0 && this.snapshot.ids.length === 0 && this.acquire([selected])) {
        this.releaseExcept(/* @__PURE__ */ new Set([selected]));
      }
      return;
    }
    this.cancelPlacement();
    const previous = this.current;
    this.current = selected;
    const newBlank = catalog.ready && this.candidates.delete(selected);
    if (!newBlank) this.candidates.clear();
    if (newBlank && previous !== void 0 && rows.has(previous)) {
      if (this.snapshot.ids.includes(selected)) return;
      const existing = this.snapshot.ids.length > 0 ? this.snapshot.ids : [previous];
      const placement = this.snapshot.placement;
      const empty = placement?.slots.indexOf(null) ?? -1;
      if (placement !== void 0 && empty !== -1) {
        const slots = [...placement.slots];
        slots[empty] = selected;
        const next2 = [...existing, selected];
        const previousReferences = new Set(this.references.keys());
        if (!this.acquire(next2)) return;
        try {
          this.deactivate ??= this.dependencies.activate();
        } catch (failure) {
          this.releaseExcept(previousReferences);
          this.fail(message(failure));
          return;
        }
        this.publish({ ids: next2, placement: { layout: placement.layout, slots } });
        this.releaseExcept(new Set(next2));
        return;
      }
      const limited = existing.length >= 4;
      const next = [...limited ? existing.slice(-3) : existing, selected];
      if (this.acquire(next)) {
        try {
          this.deactivate ??= this.dependencies.activate();
          this.publish(limited ? { ids: next, notice: "limit" } : { ids: next });
          this.releaseExcept(new Set(next));
          return;
        } catch (failure) {
          this.fail(message(failure));
        }
      }
      const error2 = this.snapshot.error;
      this.restore();
      this.publish(error2 === void 0 ? { ids: [] } : { ids: [], error: error2 });
      if (this.references.has(selected)) this.releaseExcept(/* @__PURE__ */ new Set([selected]));
      return;
    }
    if (this.snapshot.ids.includes(selected)) return;
    const retained = this.acquire([selected]);
    const error = retained ? void 0 : this.snapshot.error;
    this.restore();
    this.publish(error === void 0 ? { ids: [] } : { ids: [], error });
    if (retained) this.releaseExcept(/* @__PURE__ */ new Set([selected]));
  }
  returnNative(target, navigate) {
    if (target !== void 0 && !this.acquire([target])) return;
    this.candidates.clear();
    this.nativeTarget = target;
    this.publish({ ids: [] });
    this.restore();
    this.releaseExcept(new Set([this.current, target].filter((id) => id !== void 0)));
    if (navigate && target !== void 0) {
      try {
        this.dependencies.open(target);
      } catch (failure) {
        this.fail(message(failure));
      }
    }
    this.resync = true;
  }
  /** Commit explicit layouts only after every conversation is usable. */
  stagePlacement(next) {
    this.cancelPlacement();
    const pending = { previousReferences: new Set(this.references.keys()) };
    this.pendingPlacement = pending;
    if (!this.acquire(next.ids)) {
      this.cancelPlacement();
      return;
    }
    const ready = next.ids.map((id) => this.references.get(id).ready);
    void Promise.all(ready).then(() => {
      if (this.disposed || this.pendingPlacement !== pending) return;
      this.run(() => {
        try {
          const catalog = this.dependencies.catalog();
          if (!catalog.ready || next.ids.some((id) => !catalog.sessions.some((row) => row.id === id))) {
            throw new Error("This conversation is no longer available.");
          }
          this.deactivate ??= this.dependencies.activate();
        } catch (failure) {
          this.cancelPlacement();
          this.fail(message(failure));
          return;
        }
        this.pendingPlacement = void 0;
        this.publish(next);
        this.releaseExcept(new Set(next.ids));
      });
    }, (failure) => {
      if (this.disposed || this.pendingPlacement !== pending) return;
      this.run(() => {
        this.cancelPlacement();
        this.fail(message(failure));
      });
    });
  }
  cancelPlacement() {
    const pending = this.pendingPlacement;
    if (pending === void 0) return;
    this.pendingPlacement = void 0;
    this.releaseExcept(pending.previousReferences);
  }
  acquire(ids) {
    const acquired = [];
    try {
      for (const id of ids) {
        if (this.references.has(id)) continue;
        const reference = this.dependencies.retain(id);
        this.references.set(id, reference);
        acquired.push(id);
        void reference.ready.catch((failure) => {
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
  run(operation) {
    this.busy = true;
    try {
      operation();
    } catch (failure) {
      this.fail(message(failure));
    } finally {
      this.busy = false;
      if (this.resync) this.syncCatalog();
    }
  }
  restore() {
    const dispose = this.deactivate;
    this.deactivate = void 0;
    try {
      dispose?.();
    } catch (failure) {
      this.fail(message(failure));
    }
  }
  releaseExcept(retained) {
    for (const id of this.references.keys()) if (!retained.has(id)) this.release(id);
  }
  release(id) {
    const reference = this.references.get(id);
    this.references.delete(id);
    try {
      reference?.release();
    } catch (failure) {
      this.fail(message(failure));
    }
  }
  fail(error) {
    if (this.snapshot.error !== error) this.publish({ ...this.snapshot, error });
  }
  publish(snapshot) {
    this.snapshot = snapshot;
    for (const listener of [...this.listeners]) listener();
  }
};

// src/history-drag.ts
var HISTORY_MIME = "application/x-harness-chatsplit-session";
var PICKER_HEIGHT = 124;
var HistoryDrag = class {
  constructor(dependencies) {
    this.dependencies = dependencies;
    const { events } = dependencies;
    events.addEventListener("pointerdown", this.pointerDown, true);
    events.addEventListener("pointermove", this.pointerMove, true);
    events.addEventListener("pointerup", this.pointerUp, true);
    events.addEventListener("pointercancel", this.pointerUp, true);
    events.addEventListener("dragstart", this.start, true);
    events.addEventListener("dragover", this.over, true);
    events.addEventListener("dragleave", this.leave, true);
    events.addEventListener("drop", this.drop, true);
    events.addEventListener("dragend", this.cancel, true);
    events.addEventListener("blur", this.cancel);
    events.addEventListener("keydown", this.keyDown, true);
  }
  anchors = /* @__PURE__ */ new Map();
  targets = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  snapshot = {};
  origin;
  zone = null;
  layoutZone = null;
  disposed = false;
  getSnapshot = () => this.snapshot;
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  anchor = (element, id) => {
    if (this.disposed) return () => {
    };
    this.anchors.set(element, id);
    return () => {
      this.anchors.delete(element);
    };
  };
  setZone = (element) => {
    this.zone = element;
  };
  setLayoutZone = (element) => {
    this.layoutZone = element;
  };
  registerTarget = (element, target) => {
    if (this.disposed || !isSnapTarget(target)) return () => {
    };
    this.targets.set(element, target);
    return () => {
      if (this.targets.get(element) === target) this.targets.delete(element);
    };
  };
  cancel = () => {
    this.origin = void 0;
    if (this.snapshot.id !== void 0) this.publish({});
  };
  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    const { events } = this.dependencies;
    events.removeEventListener("pointerdown", this.pointerDown, true);
    events.removeEventListener("pointermove", this.pointerMove, true);
    events.removeEventListener("pointerup", this.pointerUp, true);
    events.removeEventListener("pointercancel", this.pointerUp, true);
    events.removeEventListener("dragstart", this.start, true);
    events.removeEventListener("dragover", this.over, true);
    events.removeEventListener("dragleave", this.leave, true);
    events.removeEventListener("drop", this.drop, true);
    events.removeEventListener("dragend", this.cancel, true);
    events.removeEventListener("blur", this.cancel);
    events.removeEventListener("keydown", this.keyDown, true);
    this.cancel();
    this.anchors.clear();
    this.targets.clear();
    this.listeners.clear();
    this.zone = null;
    this.layoutZone = null;
  };
  pointerDown = (event) => {
    this.cancel();
    this.origin = event.button === 0 ? { x: event.clientX, y: event.clientY, target: event.target } : void 0;
  };
  pointerUp = () => {
    this.origin = void 0;
  };
  pointerMove = (event) => {
    if (this.origin && (event.buttons & 1) !== 0) this.origin.latest = { x: event.clientX, y: event.clientY };
  };
  keyDown = (event) => {
    if (event.key === "Escape") this.cancel();
  };
  start = (event) => {
    const origin = this.origin;
    this.cancel();
    if (!origin || !event.dataTransfer || !this.dependencies.allowed()) return;
    const point = origin.latest ?? { x: event.clientX, y: event.clientY };
    const dx = point.x - origin.x;
    if (dx < 3 || dx < Math.abs(point.y - origin.y)) return;
    const source = event.target;
    if (typeof source?.contains !== "function" || typeof source.getBoundingClientRect !== "function") return;
    if (origin.target === null || !source.contains(origin.target)) return;
    const matches = [...this.anchors].filter(([element]) => source.contains(element));
    if (matches.length !== 1) return;
    const id = matches[0][1];
    if (!this.dependencies.available(id)) return;
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(HISTORY_MIME, id);
    this.publish({ id, left: source.getBoundingClientRect().right + 12 });
  };
  hit(event) {
    const zone = this.zone;
    if (!zone || !event.target || !zone.contains(event.target)) return {};
    const rect = zone.getBoundingClientRect();
    const { clientX: x, clientY: y } = event;
    if (!Number.isFinite(x) || !Number.isFinite(y) || rect.width <= 0 || rect.height <= 0 || x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return {};
    const grid = this.layoutZone?.getBoundingClientRect();
    const bounds = grid && grid.width > 0 && grid.height > 0 ? grid : rect;
    const area = bounds === rect ? void 0 : {
      left: bounds.left - rect.left,
      top: bounds.top - rect.top,
      width: bounds.width,
      height: bounds.height
    };
    for (const [element, target] of this.targets) {
      if (!zone.contains(element) || !element.contains(event.target)) continue;
      const cell = element.getBoundingClientRect();
      if (x >= cell.left && x < cell.right && y >= cell.top && y < cell.bottom) {
        return { picker: true, target, area };
      }
    }
    if (y < rect.top + PICKER_HEIGHT) return { picker: true };
    const layout = getSnapLayout(this.dependencies.layout() ?? "columns");
    const relativeX = (x - bounds.left) / bounds.width;
    const relativeY = (y - bounds.top) / bounds.height;
    const slot = layout.cells.findIndex((cell) => relativeX >= cell.x && relativeX < cell.x + cell.width && relativeY >= cell.y && relativeY < cell.y + cell.height);
    return slot < 0 ? {} : { target: { layout: layout.id, slot }, area };
  }
  valid(id) {
    return this.dependencies.allowed() && this.dependencies.available(id);
  }
  over = (event) => {
    const { id, left } = this.snapshot;
    if (id === void 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.dataTransfer || !this.valid(id)) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
      this.cancel();
      return;
    }
    const hit = this.hit(event);
    event.dataTransfer.dropEffect = hit.target ? "copy" : "none";
    this.publish({ id, left, ...hit });
  };
  leave = (event) => {
    if (this.snapshot.id === void 0 || event.relatedTarget !== null) return;
    const { innerWidth, innerHeight } = this.dependencies.events;
    if (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= innerWidth || event.clientY >= innerHeight) {
      const { id, left } = this.snapshot;
      this.publish({ id, left });
    }
  };
  drop = (event) => {
    const id = this.snapshot.id;
    if (id === void 0) return;
    event.preventDefault();
    event.stopPropagation();
    const target = this.hit(event).target;
    const accepted = target && event.dataTransfer?.getData(HISTORY_MIME) === id && this.valid(id);
    this.cancel();
    if (accepted) this.dependencies.add(id, target);
  };
  publish(snapshot) {
    const previous = this.snapshot;
    if (previous.id === snapshot.id && previous.left === snapshot.left && previous.picker === snapshot.picker && previous.target?.layout === snapshot.target?.layout && previous.target?.slot === snapshot.target?.slot && previous.area?.left === snapshot.area?.left && previous.area?.top === snapshot.area?.top && previous.area?.width === snapshot.area?.width && previous.area?.height === snapshot.area?.height) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
};

// src/styles.ts
var dashboardStyles = `
.dsh-snap-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:minmax(0,1fr); gap:8px; padding:8px; flex:1; min-height:0; height:100%; box-sizing:border-box; overflow:hidden; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-base); }
.dsh-snap-grid:not([data-snap-layout])[data-pane-count="3"],.dsh-snap-grid:not([data-snap-layout])[data-pane-count="4"] { grid-template-rows:repeat(2,minmax(0,1fr)); }
.dsh-snap-grid:not([data-snap-layout])[data-pane-count="3"] > :last-child { grid-column:1 / -1; }
.dsh-snap-grid[data-snap-layout] { grid-template-columns:repeat(12,minmax(0,1fr)); grid-template-rows:repeat(2,minmax(0,1fr)); }
.dsh-snap-empty { display:flex; align-items:center; justify-content:center; min-width:0; min-height:0; border:1px dashed var(--dsw-alias-border-l4); border-radius:10px; color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary)); font-size:12px; }
.dsh-snap-pane { position:relative; display:flex; flex-direction:column; min-height:0; min-width:0; border:1px solid var(--dsw-alias-border-l4); border-radius:10px; overflow:hidden; background:var(--dsw-alias-bg-base); }
.dsh-snap-chat { display:flex; flex:1; flex-direction:column; min-height:0; min-width:0; overflow:hidden; }
.dsh-snap-pane-tools { position:absolute; top:5px; right:6px; display:flex; gap:3px; z-index:3; opacity:0; transition:opacity .12s; }
.dsh-snap-pane:hover .dsh-snap-pane-tools,.dsh-snap-pane:focus-within .dsh-snap-pane-tools { opacity:1; }
.dsh-snap-icon { display:inline-flex; align-items:center; justify-content:center; border:1px solid var(--dsw-alias-border-l4); border-radius:6px; padding:0; width:26px; height:26px; color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-layer-2); cursor:pointer; font:inherit; font-size:16px; }
.dsh-snap-icon:hover { background:var(--dsw-alias-bg-layer-3); color:var(--dsw-alias-label-primary); }
.dsh-snap-icon:focus-visible { outline:2px solid currentColor; outline-offset:2px; }
.dsh-snap-message { display:flex; align-items:center; justify-content:center; flex:1; min-height:0; padding:24px; text-align:center; overflow-wrap:anywhere; font-size:13px; color:var(--dsw-alias-label-secondary); }
.dsh-snap-notice { position:absolute; bottom:16px; right:16px; max-width:420px; padding:12px 16px; border:1px solid var(--dsw-alias-border-l4); border-radius:10px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); z-index:22; pointer-events:none; font-size:13px; }
.dsh-snap-drop { position:fixed; top:0; bottom:0; right:0; z-index:30; pointer-events:auto; -webkit-app-region:no-drag; }
.dsh-snap-preview-surface { position:absolute; inset:0; pointer-events:none; }
.dsh-snap-highlight { position:absolute; box-sizing:border-box; border:8px solid transparent; border-radius:20px; background:rgba(79,133,239,.19); background-clip:padding-box; pointer-events:none; }
.dsh-snap-highlight::after { content:''; position:absolute; inset:0; border:2px solid #5686ef; border-radius:12px; box-shadow:inset 0 0 0 1px #ffffff55,0 4px 24px #315ba622; }
.dsh-snap-top-hint { position:absolute; left:50%; top:10px; width:44px; height:5px; transform:translateX(-50%); border-radius:9px; background:#8294ad99; pointer-events:none; }
.dsh-snap-picker { position:absolute; top:12px; left:50%; transform:translateX(-50%); width:560px; max-width:calc(100% - 32px); box-sizing:border-box; padding:12px 14px 8px; border:1px solid #8b9bac55; border-radius:15px; background:var(--dsw-alias-bg-layer-2,#eff5fa); box-shadow:0 7px 24px #23344930; pointer-events:auto; }
.dsh-snap-layouts { display:flex; gap:12px; height:56px; }
.dsh-snap-layout { position:relative; flex:1; min-width:0; height:100%; }
.dsh-snap-layout-cell { position:absolute; box-sizing:border-box; border:2px solid transparent; border-radius:5px; background:var(--dsw-alias-bg-layer-3,#dce6ed); background-clip:padding-box; pointer-events:auto; }
.dsh-snap-layout-cell::after { content:''; position:absolute; inset:0; border:1px solid #8b9bac99; border-radius:3px; pointer-events:none; }
.dsh-snap-layout-cell[data-snap-active] { background:#5686ef; background-clip:padding-box; }
.dsh-snap-layout-cell[data-snap-active]::after { border-color:#4076dc; }
.dsh-snap-picker-caption { margin-top:6px; text-align:center; font-size:11px; line-height:14px; color:var(--dsw-alias-label-secondary,#64758b); pointer-events:none; }
.dsh-snap-drop-label { position:absolute; bottom:24px; left:50%; transform:translateX(-50%); padding:8px 14px; border:1px solid #5686ef55; border-radius:9px; background:var(--dsw-alias-bg-base,#fff); color:var(--dsw-alias-label-primary,#26364a); font-size:13px; white-space:nowrap; pointer-events:none; box-shadow:0 4px 16px #0002; }
@media(max-width:900px) { .dsh-snap-grid:not([data-snap-layout]) { overflow-y:auto; grid-template-columns:minmax(0,1fr); grid-auto-rows:minmax(340px,1fr); grid-template-rows:none; } .dsh-snap-grid:not([data-snap-layout])[data-pane-count="3"],.dsh-snap-grid:not([data-snap-layout])[data-pane-count="4"] { grid-template-rows:none; } .dsh-snap-layouts { gap:7px; } }
@media(prefers-reduced-motion:reduce) { .dsh-snap-pane-tools { transition:none; } }
`;

// src/client.tsx
var NS = "multi-agent-dashboard";
var CHAT_SLOT = "multi-agent-dashboard.snap-chat";
var en = {
  split: "Split conversations",
  close: "Close split pane",
  single: "Return to single conversation",
  opening: "Opening conversation\u2026",
  unavailable: "This conversation is no longer available.",
  failed: "Could not open conversation.",
  missing: "Harness conversation view is unavailable.",
  limit: "The layout is full. Earlier conversations remain in the sidebar.",
  drop: "Release to add this conversation to split view",
  choose: "Drop onto a layout area",
  empty: "Empty pane",
  columns: "Two columns",
  "wide-left": "Wide left",
  "wide-right": "Wide right",
  "three-columns": "Three columns",
  "left-stack": "Left and two stacked",
  grid: "Four panes",
  area: "Area"
};
var zh = {
  split: "\u5BF9\u8BDD\u5206\u5C4F",
  close: "\u5173\u95ED\u6B64\u5206\u5C4F",
  single: "\u6062\u590D\u5355\u4E2A\u5BF9\u8BDD",
  opening: "\u6B63\u5728\u6253\u5F00\u5BF9\u8BDD\u2026",
  unavailable: "\u8FD9\u4E2A\u5BF9\u8BDD\u5DF2\u4E0D\u53EF\u7528\u3002",
  failed: "\u65E0\u6CD5\u6253\u5F00\u5BF9\u8BDD\u3002",
  missing: "Harness \u5BF9\u8BDD\u89C6\u56FE\u5F53\u524D\u4E0D\u53EF\u7528\u3002",
  limit: "\u5DF2\u6309\u6240\u9009\u5E03\u5C40\u663E\u793A\uFF0C\u79FB\u51FA\u7684\u5BF9\u8BDD\u4ECD\u53EF\u4ECE\u4FA7\u680F\u6253\u5F00\u3002",
  drop: "\u677E\u5F00\u4EE5\u52A0\u5165\u5206\u5C4F",
  choose: "\u62D6\u5230\u5E03\u5C40\u4E2D\u7684\u533A\u57DF",
  empty: "\u7A7A\u95F2\u5206\u5C4F",
  columns: "\u53CC\u680F",
  "wide-left": "\u5DE6\u5BBD\u53F3\u7A84",
  "wide-right": "\u5DE6\u7A84\u53F3\u5BBD",
  "three-columns": "\u4E09\u680F",
  "left-stack": "\u4E00\u4E3B\u4E24\u526F",
  grid: "\u56DB\u5BAB\u683C",
  area: "\u533A\u57DF"
};
function ChatView({ renderSlot }) {
  return /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, renderSlot("conversation.session", { view: "chat" }));
}
function EmbeddedChat({ useSession, useConversation, useSessions, sessionId, renderFactorySlot, t }) {
  const session = useSession((value) => value);
  const conversation = useConversation((value) => value);
  const summaryBlank = useSessions((state) => state.byId[sessionId]?.blank);
  const active = conversation.activeTargets.size > 0 || !session.blank && !session.awaitingFirstTurn || session.running;
  const shellPhase = active ? "active" : session.promptAttempted ? "engaging" : "blank";
  const settling = shellPhase === "blank" && session.openState === "loading" && summaryBlank !== true;
  const hero = shellPhase === "blank" && (session.openState === "open" || summaryBlank === true);
  if (session.removed) return /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-message", role: "status" }, t("unavailable"));
  if (session.openState === "error") return /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-message", role: "alert" }, t("failed"), " ", session.openError?.message);
  return /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-chat" }, renderFactorySlot("conversation.content", {
    variant: "embedded",
    phase: settling ? "settling" : hero ? "hero" : "active",
    hero
  }, { slots: { views: ChatView }, fallback: /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-message", role: "alert" }, t("missing")) }));
}
function SessionPane({ id, title, controller, SessionProvider, renderSlot, t, style }) {
  const reference = controller.ref(id);
  const [ready, setReady] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)();
  (0, import_react.useEffect)(() => {
    let live = true;
    setReady(false);
    setError(void 0);
    void reference?.ready.then(() => {
      if (live) setReady(true);
    }).catch((failure) => {
      if (live) setError(String(failure));
    });
    return () => {
      live = false;
    };
  }, [reference]);
  return /* @__PURE__ */ import_react.default.createElement("section", { className: "dsh-snap-pane", "aria-label": title, "data-snap-session": id, style }, /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-pane-tools" }, /* @__PURE__ */ import_react.default.createElement("button", { type: "button", className: "dsh-snap-icon", title: t("single"), "aria-label": `${t("single")}: ${title}`, onClick: () => controller.exit(id) }, "\u25A1"), /* @__PURE__ */ import_react.default.createElement("button", { type: "button", className: "dsh-snap-icon", title: t("close"), "aria-label": `${t("close")}: ${title}`, onClick: () => controller.close(id) }, "\xD7")), error !== void 0 ? /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-message", role: "alert" }, t("failed"), " ", error) : ready && reference !== void 0 ? /* @__PURE__ */ import_react.default.createElement(SessionProvider, { session: reference }, renderSlot(CHAT_SLOT, {})) : /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-message", role: "status" }, t("opening")));
}
function SplitView({ controller, historyDrag, useSessions, SessionProvider, renderSlot, t }) {
  const state = (0, import_react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot);
  const catalog = useSessions((value) => value);
  const layout = state.placement && getSnapLayout(state.placement.layout);
  const cells = state.placement?.slots ?? state.ids;
  return /* @__PURE__ */ import_react.default.createElement("div", { ref: historyDrag.setLayoutZone, className: "dsh-snap-grid", "aria-label": t("split"), "data-pane-count": state.ids.length, "data-snap-layout": layout?.id }, cells.map((id, index) => {
    const rect = layout?.cells[index];
    const style = rect && gridCell(rect);
    return id === null ? /* @__PURE__ */ import_react.default.createElement("div", { key: `empty-${index}`, className: "dsh-snap-empty", style, "aria-label": t("empty") }, t("empty")) : /* @__PURE__ */ import_react.default.createElement(
      SessionPane,
      {
        key: id,
        id,
        title: catalog.byId[id]?.displayTitle ?? id,
        style,
        controller,
        SessionProvider,
        renderSlot,
        t
      }
    );
  }));
}
function gridCell(rect) {
  return {
    gridColumn: `${Math.round(rect.x * 12) + 1} / span ${Math.round(rect.width * 12)}`,
    gridRow: `${Math.round(rect.y * 2) + 1} / span ${Math.round(rect.height * 2)}`
  };
}
function previewCell(rect) {
  return { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` };
}
function LayoutCell({ historyDrag, target, rect, active, label }) {
  const element = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    if (element.current) return historyDrag.registerTarget(element.current, target);
  }, [historyDrag, target.layout, target.slot]);
  return /* @__PURE__ */ import_react.default.createElement(
    "div",
    {
      ref: element,
      className: "dsh-snap-layout-cell",
      role: "img",
      "aria-label": label,
      "data-snap-active": active || void 0,
      style: previewCell(rect)
    }
  );
}
function HistoryAnchor({ sessionId, historyDrag }) {
  const marker = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    if (marker.current) return historyDrag.anchor(marker.current, sessionId);
  }, [historyDrag, sessionId]);
  return /* @__PURE__ */ import_react.default.createElement("span", { ref: marker, hidden: true, "aria-hidden": "true" });
}
function SplitStatus({ controller, historyDrag, t }) {
  const state = (0, import_react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot);
  const drag = (0, import_react.useSyncExternalStore)(historyDrag.subscribe, historyDrag.getSnapshot);
  const preview = drag.target && getSnapLayout(drag.target.layout).cells[drag.target.slot];
  const [dismissed, setDismissed] = (0, import_react.useState)();
  const notice = state.error ?? (state.notice === "limit" ? t("limit") : void 0);
  (0, import_react.useEffect)(() => {
    setDismissed(void 0);
    if (notice === void 0 || state.error !== void 0) return;
    const timer = window.setTimeout(() => setDismissed(notice), 6e3);
    return () => window.clearTimeout(timer);
  }, [notice, state.error]);
  return /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("style", null, dashboardStyles), drag.id !== void 0 && /* @__PURE__ */ import_react.default.createElement("div", { ref: historyDrag.setZone, className: "dsh-snap-drop", style: { left: drag.left } }, /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-preview-surface", "aria-hidden": "true", style: drag.area && { ...drag.area, right: "auto", bottom: "auto" } }, preview && /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-highlight", style: previewCell(preview), "data-preview-layout": drag.target?.layout, "data-preview-slot": drag.target?.slot })), drag.picker ? /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-picker", role: "group", "aria-label": t("choose") }, /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-layouts" }, SNAP_LAYOUTS.map((layout) => /* @__PURE__ */ import_react.default.createElement("div", { key: layout.id, className: "dsh-snap-layout", title: t(layout.id) }, layout.cells.map((rect, slot) => /* @__PURE__ */ import_react.default.createElement(
    LayoutCell,
    {
      key: slot,
      historyDrag,
      rect,
      target: { layout: layout.id, slot },
      active: drag.target?.layout === layout.id && drag.target.slot === slot,
      label: `${t(layout.id)} \xB7 ${t("area")} ${slot + 1}`
    }
  ))))), /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-picker-caption" }, t("choose"))) : /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-top-hint", "aria-hidden": "true" }), preview && /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-drop-label", role: "status" }, t("drop"))), notice !== void 0 && dismissed !== notice && /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-notice", role: state.error ? "alert" : "status" }, notice));
}
var inject = ["slots", "sessions", "uiWorkspace", "locale", "layout"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), "split: dictionaries");
  let actions;
  const controller = new SplitController({
    catalog: () => {
      const list = ctx.sessions.list.getSnapshot();
      return { ready: list.phase === "ready", sessions: Object.values(list.byId).map((row) => ({
        id: row.id,
        blank: row.blank && row.origin !== "subagent",
        mainView: (row.retainedBy.mainView ?? 0) > 0
      })) };
    },
    subscribeCatalog: (callback) => ctx.sessions.list.subscribe(callback),
    retain: (id) => ctx.sessions.retain(id, { source: "multiAgentDashboard" }),
    open: (id) => ctx.uiWorkspace.openSession(id),
    activate: () => ctx.slots.register({
      name: "main",
      key: "conversation",
      priority: -10,
      locale: NS,
      children: { [CHAT_SLOT]: { kind: "single", scope: "session" } },
      inject: () => actions
    }, SplitView)
  });
  const historyDrag = new HistoryDrag({
    events: window,
    layout: () => controller.getSnapshot().placement?.layout,
    allowed: () => ctx.layout.panelInfo.getSnapshot().activePanelId === null,
    available: (id) => {
      const row = ctx.sessions.list.getSnapshot().byId[id];
      return row !== void 0 && !row.blank && row.origin !== "subagent";
    },
    add: (id, target) => controller.addHistory(id, target)
  });
  actions = { controller, historyDrag };
  ctx.effect(() => () => historyDrag.dispose(), "split: history drag lifetime");
  ctx.effect(() => () => controller.dispose(), "split: controller lifetime");
  ctx.slots.inject(CHAT_SLOT, () => ctx.slots.register({ name: CHAT_SLOT, locale: NS }, EmbeddedChat));
  ctx.slots.inject("sidebar.workspaces.session.row.action", () => ctx.slots.register({
    name: "sidebar.workspaces.session.row.action",
    id: "harness-chatsplit.history-anchor",
    order: 900,
    inject: () => actions
  }, HistoryAnchor));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "local-conversation-split-status", order: 100, locale: NS, inject: () => actions }, SplitStatus));
}

    return module.exports;
  }
});
