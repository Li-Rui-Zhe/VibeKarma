# VibeKarma

VibeKarma 是一个使用 Tauri 2、React 和 Rust 开发的本地 Codex 桌面伴侣。它直接作用于真实 Codex 客户端窗口，把用户的奖励和纠正变成即时引导，并由独立 Codex 线程生成第一人称反省日记。

## 当前 MVP

- 通过 Windows UI Automation 自动识别真实 Codex 桌面窗口、输入框和运行状态。
- 鼠标可切换为鞭子或奖励印章，通过透明覆盖层直接作用在真实 Codex 窗口上。
- 落下动效后立即发送反馈，不再经过固定原因表单。
- 原因可以自由填写，也可以留空让 Codex 根据近期真实窗口内容自行判断。
- Codex 正在工作时反馈进入当前任务；空闲时作为新消息发送。
- 每次“鞭打”或“奖励”都会启动独立、临时、只读的 Codex CLI 日记线程。
- 新日记固定为一页：标题不超过 20 个汉字，正文为 3 个短段落、220～280 个汉字；超限时由 Codex 压缩重写。
- 日记人格采用外冷内热、有自尊、轻微傲娇的私人表达，并参考最近三篇日记避免重复措辞。
- 日记保存在 SQLite，并通过可拖动翻页的日记本回看。
- 主控制器使用普通窗口层级，只有短暂的透明动效层置顶。

## Codex 与 CCSwitch

VibeKarma 不保存 OpenAI API Key，也不强制检查某一种登录方式。反馈发送到已经打开的 Codex 桌面客户端；日记线程调用电脑上已有的 Codex CLI，并继承其配置。

以下方式都可以使用：

- `codex login` 登录后的 Codex。
- 通过 API Key 或自定义 Provider 配置的 Codex。
- CCSwitch 已经切换好的 Codex 配置。
- 在 VibeKarma 设置中指定独立的 `CODEX_HOME`、Codex 路径或环境变量。

如果认证或 Provider 配置不可用，独立日记线程会返回错误，VibeKarma 只展示错误，不读取凭据文件，也不会用本地模板冒充 Codex 日记。

## 本地开发

要求：

- Node.js 22 或更高版本。
- pnpm 10。
- Rust stable MSVC 工具链。
- Windows 上安装 Visual C++ Build Tools、Windows SDK 和 WebView2。
- 本机可执行的 Codex CLI。

```bash
pnpm install
pnpm tauri dev
```

只运行已经构建的界面和 Tauri 后端，不启动热更新服务：

```bash
pnpm build
cargo run --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol
```

前端检查：

```bash
pnpm test
pnpm build
```

Rust 检查：

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

## 数据位置

应用默认把数据写入 `D:\VibeKarmaData`；如果机器没有 D 盘，则回退到系统应用数据目录。开发或测试时可以设置 `VIBEKARMA_DATA_DIR` 覆盖位置。

```text
settings.json
events/YYYY-MM-DD.jsonl
vibekarma.sqlite3
```

旧版本的 `diaries/index.json` 会在首次启动时导入 SQLite，原文件不会删除。

日记生成线程使用 `read-only` 沙箱和 `never` 审批策略。它只根据客户端提供的事实记录写日记，不会修改项目。

## GitHub 打包

推送 `v*` 标签后，GitHub Actions 会创建草稿 Release，并构建：

- Windows x64
- Linux x64
- macOS Intel
- macOS Apple Silicon

```bash
git tag v0.1.0
git push origin v0.1.0
```

未配置代码签名时，Windows SmartScreen 和 macOS Gatekeeper 可能显示未签名应用警告。签名密钥不应提交到仓库。

## 安全边界

- React 前端不能直接执行任意系统命令。
- 所有 Codex 协议消息由 Rust 后端发送。
- 桌面反馈通过 Unicode 键盘输入发送，不使用或覆盖系统剪贴板。
- 日记线程使用 `read-only` 沙箱、临时会话和独立上下文。
- 日记生成或解析失败时只显示错误，不写入模板日记。
- `badclaude/` 仅作为本地只读参考，不属于 VibeKarma 源码或发布内容。

## 官方协议参考

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Codex 审批与安全](https://learn.chatgpt.com/docs/agent-approvals-security)
