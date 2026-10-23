import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { PropsLocale, PropsRenderFactories, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import { SplitController } from './split-controller.js';
import { HistoryDrag } from './history-drag.js';
import { isWorkspaceChoice, supersedesWorkspaceChoice } from './workspace-switch.js';
import { dashboardStyles } from './styles.js';
import { SNAP_LAYOUTS, getSnapLayout, type SnapRect, type SnapTarget } from './snap-layout.js';

const NS = 'multi-agent-dashboard';
const CHAT_SLOT = 'multi-agent-dashboard.snap-chat';
const en = {
  split: 'Split conversations', close: 'Close split pane', single: 'Return to single conversation',
  opening: 'Opening conversation…', unavailable: 'This conversation is no longer available.',
  failed: 'Could not open conversation.', missing: 'Harness conversation view is unavailable.',
  limit: 'The layout is full. Earlier conversations remain in the sidebar.',
  drop: 'Release to add this conversation to split view',
  choose: 'Drop onto a layout area', empty: 'Empty pane',
  columns: 'Two columns', 'wide-left': 'Wide left', 'wide-right': 'Wide right',
  'three-columns': 'Three columns', 'left-stack': 'Left and two stacked', grid: 'Four panes',
  area: 'Area',
} as const;
const zh: Record<keyof typeof en, string> = {
  split: '对话分屏', close: '关闭此分屏', single: '恢复单个对话',
  opening: '正在打开对话…', unavailable: '这个对话已不可用。',
  failed: '无法打开对话。', missing: 'Harness 对话视图当前不可用。',
  limit: '已按所选布局显示，移出的对话仍可从侧栏打开。',
  drop: '松开以加入分屏',
  choose: '拖到布局中的区域', empty: '空闲分屏',
  columns: '双栏', 'wide-left': '左宽右窄', 'wide-right': '左窄右宽',
  'three-columns': '三栏', 'left-stack': '一主两副', grid: '四宫格', area: '区域',
};
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'multi-agent-dashboard': keyof typeof en; }
  interface SlotMap { 'multi-agent-dashboard.snap-chat': { kind: 'single'; scope: 'session' }; }
}
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { multiAgentDashboard: unknown; }
}
type Localized = PropsLocale<typeof NS>;
interface Actions { controller: SplitController; historyDrag: HistoryDrag; }
type SplitProps = PropsRuntime<'main'> & PropsRenderSlots<typeof CHAT_SLOT> & Actions & Localized;

function ChatView({ renderSlot }: ConversationViewsProps) {
  return <>{renderSlot('conversation.session', { view: 'chat' })}</>;
}
function EmbeddedChat({ useSession, useConversation, useSessions, sessionId, renderFactorySlot, t }:
  PropsRuntime<typeof CHAT_SLOT> & PropsRenderFactories & Localized) {
  const session = useSession(value => value);
  const conversation = useConversation(value => value);
  const summaryBlank = useSessions(state => state.byId[sessionId]?.blank);
  const active = conversation.activeTargets.size > 0 || (!session.blank && !session.awaitingFirstTurn) || session.running;
  const shellPhase = active ? 'active' : session.promptAttempted ? 'engaging' : 'blank';
  const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true;
  const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true);
  if (session.removed) return <div className="dsh-snap-message" role="status">{t('unavailable')}</div>;
  if (session.openState === 'error') return <div className="dsh-snap-message" role="alert">{t('failed')} {session.openError?.message}</div>;
  return <div className="dsh-snap-chat">{renderFactorySlot('conversation.content', {
    variant: 'embedded', phase: settling ? 'settling' : hero ? 'hero' : 'active', hero,
  }, { slots: { views: ChatView }, fallback: <div className="dsh-snap-message" role="alert">{t('missing')}</div> })}</div>;
}
function SessionPane({ id, title, controller, SessionProvider, renderSlot, t, style }: Pick<SplitProps, 'controller' | 'SessionProvider' | 'renderSlot' | 't'> & { id: string; title: string; style?: React.CSSProperties }) {
  const reference = controller.ref(id) as SessionReference | undefined;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    setReady(false); setError(undefined);
    void reference?.ready.then(() => { if (live) setReady(true); }).catch((failure: unknown) => { if (live) setError(String(failure)); });
    return () => { live = false; };
  }, [reference]);
  return <section className="dsh-snap-pane" aria-label={title} data-snap-session={id} style={style}
    onClickCapture={event => {
      if (isWorkspaceChoice(event.currentTarget, event.target)) controller.beginWorkspaceChange(id);
    }}>
    <div className="dsh-snap-pane-tools">
      <button type="button" className="dsh-snap-icon" title={t('single')} aria-label={`${t('single')}: ${title}`} onClick={() => controller.exit(id)}>□</button>
      <button type="button" className="dsh-snap-icon" title={t('close')} aria-label={`${t('close')}: ${title}`} onClick={() => controller.close(id)}>×</button>
    </div>
    {error !== undefined ? <div className="dsh-snap-message" role="alert">{t('failed')} {error}</div>
      : ready && reference !== undefined ? <SessionProvider session={reference}>{renderSlot(CHAT_SLOT, {})}</SessionProvider>
        : <div className="dsh-snap-message" role="status">{t('opening')}</div>}
  </section>;
}
function SplitView({ controller, historyDrag, useSessions, SessionProvider, renderSlot, t }: SplitProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const catalog = useSessions(value => value);
  const layout = state.placement && getSnapLayout(state.placement.layout);
  const cells = state.placement?.slots ?? state.ids;
  return <div ref={historyDrag.setLayoutZone} className="dsh-snap-grid" aria-label={t('split')} data-pane-count={state.ids.length} data-snap-layout={layout?.id}>
    {cells.map((id, index) => {
      const rect = layout?.cells[index];
      const style = rect && gridCell(rect);
      return id === null
        ? <div key={`empty-${index}`} className="dsh-snap-empty" style={style} aria-label={t('empty')}>{t('empty')}</div>
        : <SessionPane key={id} id={id} title={catalog.byId[id as SessionId]?.displayTitle ?? id} style={style}
          controller={controller} SessionProvider={SessionProvider} renderSlot={renderSlot} t={t} />;
    })}
  </div>;
}
function gridCell(rect: SnapRect): React.CSSProperties {
  return { gridColumn: `${Math.round(rect.x * 12) + 1} / span ${Math.round(rect.width * 12)}`,
    gridRow: `${Math.round(rect.y * 2) + 1} / span ${Math.round(rect.height * 2)}` };
}
function previewCell(rect: SnapRect): React.CSSProperties {
  return { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` };
}
function LayoutCell({ historyDrag, target, rect, active, label }: {
  historyDrag: HistoryDrag; target: SnapTarget; rect: SnapRect; active: boolean; label: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (element.current) return historyDrag.registerTarget(element.current, target);
  }, [historyDrag, target.layout, target.slot]);
  return <div ref={element} className="dsh-snap-layout-cell" role="img" aria-label={label}
    data-snap-active={active || undefined} style={previewCell(rect)} />;
}
function HistoryAnchor({ sessionId, historyDrag }: PropsRuntime<'sidebar.workspaces.session.row.action'> & Actions) {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (marker.current) return historyDrag.anchor(marker.current, sessionId);
  }, [historyDrag, sessionId]);
  return <span ref={marker} hidden aria-hidden="true" />;
}
function SplitStatus({ controller, historyDrag, t }: Actions & Localized) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const drag = useSyncExternalStore(historyDrag.subscribe, historyDrag.getSnapshot);
  const preview = drag.target && getSnapLayout(drag.target.layout).cells[drag.target.slot];
  const [dismissed, setDismissed] = useState<string>();
  const notice = state.error ?? (state.notice === 'limit' ? t('limit') : undefined);
  useEffect(() => {
    setDismissed(undefined);
    if (notice === undefined || state.error !== undefined) return;
    const timer = window.setTimeout(() => setDismissed(notice), 6000);
    return () => window.clearTimeout(timer);
  }, [notice, state.error]);
  return <><style>{dashboardStyles}</style>
    {drag.id !== undefined && <div ref={historyDrag.setZone} className="dsh-snap-drop" style={{ left: drag.left }}>
      <div className="dsh-snap-preview-surface" aria-hidden="true" style={drag.area && { ...drag.area, right: 'auto', bottom: 'auto' }}>
        {preview && <div className="dsh-snap-highlight" style={previewCell(preview)} data-preview-layout={drag.target?.layout} data-preview-slot={drag.target?.slot} />}
      </div>
      {drag.picker ? <div className="dsh-snap-picker" role="group" aria-label={t('choose')}>
        <div className="dsh-snap-layouts">{SNAP_LAYOUTS.map(layout => <div key={layout.id} className="dsh-snap-layout" title={t(layout.id)}>
          {layout.cells.map((rect, slot) => <LayoutCell key={slot} historyDrag={historyDrag} rect={rect} target={{ layout: layout.id, slot }}
            active={drag.target?.layout === layout.id && drag.target.slot === slot} label={`${t(layout.id)} · ${t('area')} ${slot + 1}`} />)}
        </div>)}</div>
        <div className="dsh-snap-picker-caption">{t('choose')}</div>
      </div> : <div className="dsh-snap-top-hint" aria-hidden="true" />}
      {preview && <div className="dsh-snap-drop-label" role="status">{t('drop')}</div>}
    </div>}
    {notice !== undefined && dismissed !== notice && <div className="dsh-snap-notice" role={state.error ? 'alert' : 'status'}>{notice}</div>}
  </>;
}
export const inject = ['slots', 'sessions', 'uiWorkspace', 'locale', 'layout'];
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'split: dictionaries');
  let actions: Actions;
  const controller = new SplitController({
    catalog: () => {
      const list = ctx.sessions.list.getSnapshot();
      return { ready: list.phase === 'ready', sessions: Object.values(list.byId).map(row => ({
        id: row.id, blank: row.blank && row.origin !== 'subagent', mainView: (row.retainedBy.mainView ?? 0) > 0,
        mainViewCount: row.retainedBy.mainView ?? 0,
      })) };
    },
    subscribeCatalog: callback => ctx.sessions.list.subscribe(callback),
    retain: id => ctx.sessions.retain(id as SessionId, { source: 'multiAgentDashboard' }),
    open: id => ctx.uiWorkspace.openSession(id as SessionId),
    activate: () => ctx.slots.register({ name: 'main', key: 'conversation', priority: -10, locale: NS,
      children: { [CHAT_SLOT]: { kind: 'single', scope: 'session' } }, inject: () => actions,
    }, SplitView),
  });
  const historyDrag = new HistoryDrag({
    events: window,
    layout: () => controller.getSnapshot().placement?.layout,
    allowed: () => ctx.layout.panelInfo.getSnapshot().activePanelId === null,
    available: id => {
      const row = ctx.sessions.list.getSnapshot().byId[id as SessionId];
      return row !== undefined && !row.blank && row.origin !== 'subagent';
    },
    add: (id, target) => controller.addHistory(id, target),
  });
  actions = { controller, historyDrag };
  ctx.effect(() => {
    // Window capture precedes the pane's React capture, including portal menus.
    const click = (event: MouseEvent) => {
      if (supersedesWorkspaceChoice(event.target)) controller.cancelWorkspaceChange();
    };
    const key = (event: KeyboardEvent) => {
      const navigate = (event.ctrlKey || event.metaKey) && ['KeyN', 'KeyK', 'KeyO'].includes(event.code);
      if (event.key === 'Escape' || navigate) controller.cancelWorkspaceChange();
    };
    window.addEventListener('click', click, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('click', click, true);
      window.removeEventListener('keydown', key, true);
    };
  }, 'split: workspace navigation intent');
  ctx.effect(() => () => historyDrag.dispose(), 'split: history drag lifetime');
  ctx.effect(() => () => controller.dispose(), 'split: controller lifetime');
  ctx.slots.inject(CHAT_SLOT, () => ctx.slots.register({ name: CHAT_SLOT, locale: NS }, EmbeddedChat));
  ctx.slots.inject('sidebar.workspaces.session.row.action', () => ctx.slots.register({
    name: 'sidebar.workspaces.session.row.action', id: 'harness-chatsplit.history-anchor', order: 900, inject: () => actions,
  }, HistoryAnchor));
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'local-conversation-split-status', order: 100, locale: NS, inject: () => actions }, SplitStatus));
}
