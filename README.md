# dsh-chat-split

DeepSeek Harness 聊天分屏插件。点击原生「新会话」，在同一窗口中并排打开多个独立对话。

Split independent chats side by side in DeepSeek Harness using the native New Session button.

**版本：0.4.3 · 适配 Harness 0.2.1-rc.2 · MIT**

这是社区插件，与 DeepSeek 官方无隶属关系。当前主要验证环境为 Windows。

## 功能

- 点击 Harness 原生「新会话」，自动加入分屏，无需额外工作台入口。
- 两个对话左右排列；三个对话上方两格、下方一格；四个对话为两行两列。
- 已有四格时，新对话替换最早的一格；移出的会话仍保留在历史列表中。
- 将鼠标移入一格，使用右上角 **□** 恢复原生单窗，或 **×** 关闭该分屏。
- 各格使用 Harness 原生聊天内容，输入、模型选择、权限和草稿由宿主管理。
- 包含历史会话向右拖入分屏的实验性实现。**该功能通过模拟事件测试，但尚未完成真实桌面拖拽验证。**

正常点击历史会话会退出分屏。布局在刷新或重启后不恢复。插件不会广播提示词、调用模型或实现 Agent 之间的协作。

## 安装

先安装并启动一次 **DeepSeek Harness 0.2.1-rc.2**。从项目发布附件获取 `dsh-chat-split-0.4.3.tgz`，或按下文从源码打包。

1. 在 Harness 中打开「插件 → 添加插件 → 安装第三方插件」。
2. 粘贴 `.tgz` 文件的本机绝对路径，不要解压。
3. 安装完成后点击「立即启用」。
4. 更新已有版本时，完全退出并重新打开 Harness。
5. 打开一个对话，再点击原生「新会话」开始分屏。如果没有现有对话，第一次新建先打开单窗。

也可完全退出 Harness 后，通过桌面版自带的命令安装（Windows PowerShell）：

```powershell
$packagePath = (Resolve-Path '.\dsh-chat-split-0.4.3.tgz').Path
$dsh = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
& $dsh plugin --profile desktop add $packagePath --ignore-scripts
```

如果 Harness 安装在其他位置，请相应调整 `$dsh`。不要使用独立 npm 运行时操作桌面版配置，也不要把 `DSH_HOME` 指向开发目录后再操作桌面配置。

插件显示名称为 `dsh-chat-split`。内部包标识保留 `@local/deepseek-multi-agent-dashboard`，用于直接升级此前的本地版本；无需同时安装两个版本。本项目通过源码和 `.tgz` 分发，没有发布到 npm。

## 历史会话拖拽（实验性）

按住侧栏普通历史会话标题，**先向右拖动**，出现蓝色分屏区域后移入并松开。向上或向下起拖仍使用原生排序；如果先纵向起拖，请松开后重新开始。

相同会话不会重复加入。按 Esc 或在目标区域外松开会取消。不支持空白新会话、归档或搜索结果中的行。真实鼠标操作仍待确认，详见 [验证记录](VALIDATION.md)。

## 开发与打包

需要 Node.js 24+ 和 pnpm。在项目根目录运行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm build
pnpm test
pnpm pack
```

默认生成 `local-deepseek-multi-agent-dashboard-0.4.3.tgz`；可将文件名改为 `dsh-chat-split-0.4.3.tgz`，内部包标识保持不变。

`client.js` 是必须随插件分发的构建文件；源码位于 `src/`，测试位于 `tests/`。运行时仅外部引用宿主提供的 React。类型检查启用 strict，`skipLibCheck` 仅跳过第三方包内部声明检查。

可选的隔离 Web 开发环境需要 PowerShell 7：

```powershell
.\scripts\setup.ps1
.\scripts\start.ps1
```

该环境使用项目内的 `.runtime` 和 `.dsh-home`，不迁入桌面聊天数据。默认监听 `127.0.0.1:3080`，可用 `-Port 3081` 更换端口。启动链接含临时访问令牌，不要分享。它省略了可选 Office 转换引擎，不用于 Office 功能测试。

## 兼容性与边界

- 精确适配 Harness `0.2.1-rc.2`；其他版本、macOS 和 Linux 尚未验证。
- 使用已核验的公开会话、保留引用和 UI 插槽接口，不修改官方源码。官方没有直接提供历史会话拖入主区的 API，实验性拖拽包含针对该版本布局的适配。
- “新会话”识别依据是新出现的空白会话成为主会话；公开目录不提供创建来源，因此少数远端同步后立即打开的空白会话可能被视为新建。
- 不支持手动调整分屏比例、布局持久化、广播消息或 Agent 自动分工。
- 多路真实模型回复和长会话压力尚未验证。

接口出处见 [API-EVIDENCE.md](API-EVIDENCE.md)，检查范围见 [VALIDATION.md](VALIDATION.md)。反馈问题时请附 Harness 版本、系统版本和复现步骤，不要附 API Key 或包含私人聊天的日志。

## License

[MIT](LICENSE)。保留所采用的 DeepSeek 集成示例模式的版权归属。
