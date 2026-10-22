# 官方 API 核验：点击新会话自动分屏

更新日期：2026-10-23。官方仓库由 [DeepSeek 官方页面](https://www.deepseek.com/harness/en/) 指向 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。

本次核验固定在源码快照 `687f282e8625c6b8d11ff58211a90524be2e4317`。实际 npm 运行时、用于类型检查的官方声明以及目标桌面版均为 **0.2.1-rc.2**。以下说明对应插件 **dsh-chat-split 0.4.3**，保留原生新建自动分屏并新增历史行拖拽，不代表上游未来版本继续兼容。桌面交互的实际完成范围以 `VALIDATION.md` 中对应版本的记录为准。

## 历史行拖拽

官方没有公开的会话拖入主区 API。插件通过公开的 [`sidebar.workspaces.session.row.action`](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-workspace/src/client/contract/slots.ts#L72) 取得 `sessionId`，渲染自己的隐藏 marker。原生非空白行[始终挂载该插槽](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-workspace/src/client/rows/Rows.tsx#L664)，CSS 只控制行动区显隐。已另外读取本机 app.asar 内的 ui-workspace 发布 bundle，确认一致。

通过标准浏览器捕获事件及 `source.contains(插件 marker)` 识别行，不查询宿主 CSS 或私有 data 属性。只接管以向右移动开始的拖拽，阻止原生排序初始化并写入自有 MIME；向上/向下起拖交还宿主。不能仅旁听原生 payload：原生 [dragend 会提交最后的排序目标](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx#L618)，可能在主区放下后仍误排序。

拖拽目标使用公开 `shell.overlay`。`ctx.layout.panelInfo` 只提供当前面板，**不提供主区几何**；浮层左边距由原生可拖行的标准 DOM 矩形加间距定位。这是固定版本的 DOM 布局适配，并非官方分屏或拖拽契约。没有私有组件导入或宿主 DOM 修改。丢弃、取消和重复拖入不导航、不创建会话；成功 drop 调用插件自己的控制器，通过已核验的公开 retain/factory 生命周期加入视图。

## 插件显示名称

0.3.2 使用导出的 `locale/en.json`、`locale/zh.json` 中的 `meta.title` 和 `meta.description` 提供名称及说明，符合[官方显示元数据规范](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/cookbook/adding-a-package.md#plugin-display-metadata)。管理器[优先采用 meta.title](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-plugin-manager/src/client/presentation.ts#L121)，因此保留内部包名不影响品牌展示。已使用官方 `@deepseek-ai/dsh-app-boot` 公开导出的 `readPluginMeta` 验证两种语言均返回 `harness-ChatSplit`。

## 原生新会话的真实调用路径

原生按钮直接调用注入的 `startSession()`，没有单独的“新会话按钮”扩展插槽，也不经过快捷键命令分发：

1. `SidebarRoot.tsx` 的按钮 `onClick` 调用 `startSession()`，见 [按钮实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-sidebar/src/client/SidebarRoot.tsx#L259)。
2. ui-sidebar 将调用转发给 `uiWorkspace.startSession(workspaceId)`，见 [注入回调](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-sidebar/src/client/index.ts#L65)。公开方法名是 `startSession`，不是 `newSession`。
3. `startSession()` 选择明确指定、当前或最近工作区。未传 options 时，经 `openWorkspaceSession(..., reuse=undefined)` 调用 `sessions.create({workspaceId})`，不请求复用已有空白会话。见 [startSession](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-workspace/src/client/navigation.ts#L320) 与 [connectBlank 的新建分支](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-workspace/src/client/navigation.ts#L199)。已同时核对本机安装的 rc.2 发布 bundle 中该分支。
4. 创建成功先发布 `blank:true` 的会话目录行，再返回会话 ID。见 [manager.create](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/client/sessions/manager.ts#L508) 和 [sessions.create](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/client/sessions/service.ts#L428)。
5. 原生导航先 `retain(newId,{source:'mainView'})`，再更新选择及 `mainReference`，最后释放旧主会话引用。见 [replaceMain](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-workspace/src/client/navigation.ts#L499)。短暂过渡时，新旧 ID 可能同时拥有 `mainView` 引用。

`session.new` 快捷键也调用 `startSession()`，见 [快捷键实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-workspace/src/client/shortcuts.ts#L81)。替换快捷键本身不会接管原生按钮。

0.3.1 保留原生创建流程，监听公开目录及主会话保留记录，在新空白会话成为主会话后追加分屏。插件不修改按钮，不替换 `uiWorkspace` 服务方法，不声称存在公开的点击拦截 API，也不为同一次操作额外创建会话。

## 插件使用的公开契约

| 用途 | 已核实接口及使用方式 | 固定版本官方源码 |
|---|---|---|
| 独立客户端 bundle | `dsh.bundle.patch`、`dsh.client`、`./client` export、`window.__ModuleLoader__.load` | [官方插件模板](https://github.com/deepseek-ai/deepseek-harness/tree/687f282e8625c6b8d11ff58211a90524be2e4317/packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration) |
| 观察新会话与主会话 | `ctx.sessions.list.getSnapshot()`、`subscribe()`；使用 `phase`、`byId`、`blank`、`origin` 和 `retainedBy.mainView` | [ISessions 契约](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/client/contract/sessions.ts#L47)、[SessionSummary 与 SessionListState](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/client/sessions/service.ts#L27) |
| 主视图保留来源 | `mainView` 由 ui-session 声明；官方 `publishMain` 同样用主视图引用识别当前会话 | [source 声明](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-session/src/client/index.ts#L189)、[publishMain](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-session/src/client/index.ts#L442) |
| 保留旧会话和各分屏 | `ctx.sessions.retain(id,{source:'multiAgentDashboard'})`、`reference.ready`、`reference.release()`；插件通过类型合并声明自己的引用来源 | [SessionReference 与 retain 契约](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/client/contract/sessions.ts#L24) |
| 原生主区域 | `main` 是 root-scoped keyed slot；原生聊天的 key 为 `conversation` | [layout 插槽契约](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-layout/src/client/index.ts#L76)、[原生 main 注册](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-conversation/src/client/apply.ts#L560) |
| 临时分屏与原生恢复 | 分屏时注册 `main`、`key:'conversation'`、`priority:-10`；较小 priority 获胜。解除插件注册后原生注册恢复 | [插槽优先级与排序](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-slots/src/index.ts#L1207)、[renderer 注册生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-renderer/src/client/registry.ts#L741) |
| 独立会话视图 | `SessionProvider` 绑定每个独立引用，插件自有 session-scope 子插槽承载聊天 | [官方内嵌聊天实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-subagent/src/client/sidebar-chat/index.tsx#L112) |
| 官方聊天内容 | `renderFactorySlot('conversation.content',{variant:'embedded',phase,hero},...)`；views 连接 `conversation.session` 的 chat 视图 | [Conversation factory 契约](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-conversation/src/client/contract/slots.ts#L301) |
| 返回单个对话 | `ctx.uiWorkspace.openSession(id)` 恢复选择，通过引用交接保留会话生命周期 | [UiWorkspace 导航契约](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-workspace/src/client/navigation.ts#L38) |
| 状态提示 | `shell.overlay` 的独立 list entry，仅显示错误或四格上限提示 | [shell.overlay 契约](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-layout/src/client/index.ts#L94) |
| 文案与主题 | `ctx.locale.register` 和宿主 `--dsw-alias-*` 颜色变量 | [locale 服务](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/locale/src/client/index.ts)、[设计变量](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-theme/src/styles/design-platform.css) |

没有公开的“包装并调用上一个 main renderer”接口。实现使用可撤销的优先级注册，并通过公开 factory 构造内部聊天。原生 main 声明的子插槽在被遮蔽时仍存在，所以插件只声明自有的 `multi-agent-dashboard.snap-chat`，不重复声明原生 `conversation.header` 或 `main.conversation`。

## 识别规则与边界

公开 `SessionListState` 表示目录和引用状态，不记录“哪次按钮点击创建了哪个会话”。`SessionSummary` 没有创建来源或 `createdAt`；`updatedAt` 也不能证明是本地新建。首次目录到达与以后刷新共用同一数据源，且 `phase` 一旦 ready 就不会在重连时退回 pending，见 [SessionListPhase 说明](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/client/sessions/manager.ts#L35)。

因此，自动分屏识别的是“新出现的顶层空白会话成为主会话”，而不是精确的按钮点击事件。启动时建立已见会话基线；普通历史导航不追加分屏。新旧 `mainView` 短暂重叠时需要等待导航状态稳定，并提前保留上一会话，避免原生释放最后一个引用。引用变化本身会再次发布目录通知，控制器需避免重入。

从远程目录新发现的旧空白会话，如果紧接着成为主会话，公开信息不足以绝对区分其来源。这是当前自动识别方案的边界，不能承诺完全归因于本地“新会话”按钮。无需新建时的普通历史导航会恢复单窗；插件自身恢复单窗使用已知 ID，不作为新建处理。

布局由插件维护：两格左右；三格上方两格、下方一格横跨两列；四格两行两列。第五个会话加入时移出最早一格，保留最近三格与新会话，释放移出格的插件引用，但不调用删除或归档。□ 恢复指定会话单窗，× 关闭一格；少于两格恢复原生主视图。布局不持久化，也不向模型发送消息。

## 安装与运行依据

| 用途 | 已核实方式 | 官方源码 |
|---|---|---|
| 独立 Web 运行 | `dsh plugin --profile web add link:<path>`、`dsh web --patch ... --host 127.0.0.1 --no-open` | [CLI 参考](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/cli/reference/README.md) |
| 桌面版插件安装 | 「插件 → 添加插件 → 安装第三方插件」接受 `.tgz` 绝对路径；完成后点击「立即启用」 | [插件管理器说明](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-plugin-manager/README.zh.md#L57) |
| 桌面版客户端平台 | 桌面版包装完整 Web 应用；模块加载器选择 `dsh.client.platform === 'web'` | [桌面架构](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/README.md#L35)、[模块加载器](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/modules/src/index.ts#L862) |
| 桌面版命令安装 | 桌面版先启动一次初始化，然后完全退出，使用其自带 `dsh.cmd plugin --profile desktop add <package>`；npm 版不能修改桌面配置 | [桌面命令运行时及安装归属](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/README.md#L129) |

本机曾核验 `%LOCALAPPDATA%\Programs\DeepSeek Harness\DeepSeek Harness.exe` 的 `FileVersion` 为 **0.2.1-rc.2**、`ProductVersion` 为 `0.2.1.0`，与插件 `engines.dsh` 精确匹配。自带命令位于 `resources\runtime\cli\bin\dsh.cmd`，使用 Electron Node 模式及随应用提供的 pnpm。点击新会话自动分屏的本机实测记录见 `VALIDATION.md`，不沿用旧版工作台的结果。

实现不导入 Harness 私有组件，不使用 iframe 或宿主 DOM 选择器，不读取私有导航存储，也不构造消息发送端点。官方类型导入用于编译期核验，运行时外部依赖仅为宿主 React，服务和插槽由 Harness 注入。

接口核验基于官方固定版本源码归档。独立 Web 测试目录与桌面应用数据分开；安装和打包步骤见 `README.md`。
