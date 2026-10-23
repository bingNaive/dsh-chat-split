/** The native New Session action owns creation; this plugin owns only the split presentation. */
export const dashboardStyles = `
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
.dsh-snap-drop { position:fixed; top:0; bottom:0; right:0; z-index:30; pointer-events:auto; }
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
