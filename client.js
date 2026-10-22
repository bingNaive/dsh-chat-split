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
  addHistory = (id) => {
    if (this.disposed || this.busy || this.nativeTarget !== void 0 || this.snapshot.ids.includes(id)) return;
    this.run(() => {
      const catalog = this.dependencies.catalog();
      if (!catalog.ready) return;
      const known = new Set(catalog.sessions.map((row) => row.id));
      if (!known.has(id)) {
        this.fail("This conversation is no longer available.");
        return;
      }
      const existing = this.snapshot.ids.length > 0 ? this.snapshot.ids : this.current !== void 0 && known.has(this.current) ? [this.current] : [];
      if (existing.length === 0 || existing.includes(id)) return;
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
      const remaining = this.snapshot.ids.filter((value) => value !== id);
      if (remaining.length < 2) {
        this.returnNative(remaining[0], true);
        return;
      }
      this.publish({ ids: remaining });
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
      this.returnNative(target, true);
    });
  };
  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
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
      if (this.snapshot.ids.length === 0 && this.acquire([selected])) {
        this.releaseExcept(/* @__PURE__ */ new Set([selected]));
      }
      return;
    }
    const previous = this.current;
    this.current = selected;
    const newBlank = catalog.ready && this.candidates.delete(selected);
    if (!newBlank) this.candidates.clear();
    if (newBlank && previous !== void 0 && rows.has(previous)) {
      if (this.snapshot.ids.includes(selected)) return;
      const existing = this.snapshot.ids.length > 0 ? this.snapshot.ids : [previous];
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
    events.addEventListener("drop", this.drop, true);
    events.addEventListener("dragend", this.cancel, true);
    events.addEventListener("blur", this.cancel);
    events.addEventListener("keydown", this.keyDown, true);
  }
  anchors = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  snapshot = {};
  origin;
  zone = null;
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
    events.removeEventListener("drop", this.drop, true);
    events.removeEventListener("dragend", this.cancel, true);
    events.removeEventListener("blur", this.cancel);
    events.removeEventListener("keydown", this.keyDown, true);
    this.cancel();
    this.anchors.clear();
    this.listeners.clear();
    this.zone = null;
  };
  pointerDown = (event) => {
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
  inZone(event) {
    return this.zone !== null && event.target !== null && this.zone.contains(event.target);
  }
  over = (event) => {
    if (this.snapshot.id === void 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = this.inZone(event) ? "copy" : "none";
  };
  drop = (event) => {
    const id = this.snapshot.id;
    if (id === void 0) return;
    event.preventDefault();
    event.stopPropagation();
    const accepted = this.inZone(event) && event.dataTransfer?.getData(HISTORY_MIME) === id && this.dependencies.allowed() && this.dependencies.available(id);
    this.cancel();
    if (accepted) this.dependencies.add(id);
  };
  publish(snapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
};

// src/styles.ts
var dashboardStyles = `
.dsh-snap-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:minmax(0,1fr); gap:8px; padding:8px; flex:1; min-height:0; height:100%; box-sizing:border-box; overflow:hidden; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-base); }
.dsh-snap-grid[data-pane-count="3"],.dsh-snap-grid[data-pane-count="4"] { grid-template-rows:repeat(2,minmax(0,1fr)); }
.dsh-snap-grid[data-pane-count="3"] > :last-child { grid-column:1 / -1; }
.dsh-snap-pane { position:relative; display:flex; flex-direction:column; min-height:0; min-width:0; border:1px solid var(--dsw-alias-border-l4); border-radius:10px; overflow:hidden; background:var(--dsw-alias-bg-base); }
.dsh-snap-chat { display:flex; flex:1; flex-direction:column; min-height:0; min-width:0; overflow:hidden; }
.dsh-snap-pane-tools { position:absolute; top:5px; right:6px; display:flex; gap:3px; z-index:3; opacity:0; transition:opacity .12s; }
.dsh-snap-pane:hover .dsh-snap-pane-tools,.dsh-snap-pane:focus-within .dsh-snap-pane-tools { opacity:1; }
.dsh-snap-icon { display:inline-flex; align-items:center; justify-content:center; border:1px solid var(--dsw-alias-border-l4); border-radius:6px; padding:0; width:26px; height:26px; color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-layer-2); cursor:pointer; font:inherit; font-size:16px; }
.dsh-snap-icon:hover { background:var(--dsw-alias-bg-layer-3); color:var(--dsw-alias-label-primary); }
.dsh-snap-icon:focus-visible { outline:2px solid currentColor; outline-offset:2px; }
.dsh-snap-message { display:flex; align-items:center; justify-content:center; flex:1; min-height:0; padding:24px; text-align:center; overflow-wrap:anywhere; font-size:13px; color:var(--dsw-alias-label-secondary); }
.dsh-snap-notice { position:absolute; bottom:16px; right:16px; max-width:420px; padding:12px 16px; border:1px solid var(--dsw-alias-border-l4); border-radius:10px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); z-index:22; pointer-events:none; font-size:13px; }
.dsh-snap-drop { position:absolute; top:12px; bottom:12px; right:12px; border:2px solid #5686ef; border-radius:14px; background:rgba(86,134,239,.14); z-index:30; pointer-events:auto; display:flex; align-items:center; justify-content:center; }
.dsh-snap-drop-preview { position:absolute; inset:16px; display:grid; grid-template-columns:1fr 1fr; gap:12px; pointer-events:none; }
.dsh-snap-drop-preview span { border:1px dashed #5686ef; border-radius:10px; background:rgba(86,134,239,.06); }
.dsh-snap-drop-label { padding:14px 20px; border:1px solid #5686ef; border-radius:12px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font-size:15px; pointer-events:none; box-shadow:0 6px 24px #0002; }
@media(max-width:900px) { .dsh-snap-grid { overflow-y:auto; grid-template-columns:minmax(0,1fr); grid-auto-rows:minmax(340px,1fr); grid-template-rows:none; } .dsh-snap-grid[data-pane-count="3"],.dsh-snap-grid[data-pane-count="4"] { grid-template-rows:none; } }
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
  limit: "Showing the four most recent panes. Earlier conversations remain in the sidebar.",
  drop: "Release to add this conversation to split view"
};
var zh = {
  split: "\u5BF9\u8BDD\u5206\u5C4F",
  close: "\u5173\u95ED\u6B64\u5206\u5C4F",
  single: "\u6062\u590D\u5355\u4E2A\u5BF9\u8BDD",
  opening: "\u6B63\u5728\u6253\u5F00\u5BF9\u8BDD\u2026",
  unavailable: "\u8FD9\u4E2A\u5BF9\u8BDD\u5DF2\u4E0D\u53EF\u7528\u3002",
  failed: "\u65E0\u6CD5\u6253\u5F00\u5BF9\u8BDD\u3002",
  missing: "Harness \u5BF9\u8BDD\u89C6\u56FE\u5F53\u524D\u4E0D\u53EF\u7528\u3002",
  limit: "\u5DF2\u4FDD\u7559\u6700\u8FD1 4 \u4E2A\u5206\u5C4F\uFF0C\u4E4B\u524D\u7684\u5BF9\u8BDD\u4ECD\u53EF\u4ECE\u4FA7\u680F\u6253\u5F00\u3002",
  drop: "\u677E\u5F00\u4EE5\u52A0\u5165\u5206\u5C4F"
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
function SessionPane({ id, title, controller, SessionProvider, renderSlot, t }) {
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
  return /* @__PURE__ */ import_react.default.createElement("section", { className: "dsh-snap-pane", "aria-label": title, "data-snap-session": id }, /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-pane-tools" }, /* @__PURE__ */ import_react.default.createElement("button", { type: "button", className: "dsh-snap-icon", title: t("single"), "aria-label": `${t("single")}: ${title}`, onClick: () => controller.exit(id) }, "\u25A1"), /* @__PURE__ */ import_react.default.createElement("button", { type: "button", className: "dsh-snap-icon", title: t("close"), "aria-label": `${t("close")}: ${title}`, onClick: () => controller.close(id) }, "\xD7")), error !== void 0 ? /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-message", role: "alert" }, t("failed"), " ", error) : ready && reference !== void 0 ? /* @__PURE__ */ import_react.default.createElement(SessionProvider, { session: reference }, renderSlot(CHAT_SLOT, {})) : /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-message", role: "status" }, t("opening")));
}
function SplitView({ controller, useSessions, SessionProvider, renderSlot, t }) {
  const state = (0, import_react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot);
  const catalog = useSessions((value) => value);
  return /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-grid", "aria-label": t("split"), "data-pane-count": state.ids.length }, state.ids.map((id) => /* @__PURE__ */ import_react.default.createElement(
    SessionPane,
    {
      key: id,
      id,
      title: catalog.byId[id]?.displayTitle ?? id,
      controller,
      SessionProvider,
      renderSlot,
      t
    }
  )));
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
  const [dismissed, setDismissed] = (0, import_react.useState)();
  const notice = state.error ?? (state.notice === "limit" ? t("limit") : void 0);
  (0, import_react.useEffect)(() => {
    setDismissed(void 0);
    if (notice === void 0 || state.error !== void 0) return;
    const timer = window.setTimeout(() => setDismissed(notice), 6e3);
    return () => window.clearTimeout(timer);
  }, [notice, state.error]);
  return /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("style", null, dashboardStyles), drag.id !== void 0 && /* @__PURE__ */ import_react.default.createElement("div", { ref: historyDrag.setZone, className: "dsh-snap-drop", style: { left: drag.left } }, /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-drop-preview", "aria-hidden": "true" }, /* @__PURE__ */ import_react.default.createElement("span", null), /* @__PURE__ */ import_react.default.createElement("span", null)), /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-drop-label", role: "status" }, t("drop"))), notice !== void 0 && dismissed !== notice && /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-snap-notice", role: state.error ? "alert" : "status" }, notice));
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
    allowed: () => ctx.layout.panelInfo.getSnapshot().activePanelId === null,
    available: (id) => {
      const row = ctx.sessions.list.getSnapshot().byId[id];
      return row !== void 0 && !row.blank && row.origin !== "subagent";
    },
    add: (id) => controller.addHistory(id)
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
