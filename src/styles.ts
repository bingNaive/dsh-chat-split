/** The native New Session action owns creation; this plugin owns only the split presentation. */
export const dashboardStyles = `
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
