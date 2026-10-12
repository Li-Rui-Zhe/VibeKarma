# VibeKarma 开发指南

[← 返回项目首页](../README.md)

## 环境要求

| 项目 | 要求 |
| :--- | :--- |
| 系统 | Windows 10/11，或 Intel / Apple Silicon macOS |
| Node.js | 22 或更高版本 |
| pnpm | 10；仓库指定 `10.13.1` |
| Rust | stable |
| Windows 原生构建 | Visual C++ Build Tools、Windows SDK、WebView2 Runtime |
| macOS 原生构建 | Xcode Command Line Tools |
| 使用日记功能 | 已安装并登录的 Codex CLI，以及可见的 Codex 桌面窗口 |

## 启动

```bash
pnpm install
pnpm run tauri dev
```

开发服务器使用 `127.0.0.1:1420`。端口被旧开发进程占用时，先关闭该进程，再重新启动。

主控制器默认 `580 × 400`，打开日记本时切换为 `1000 × 700`。透明交互窗口只在奖惩期间显示。

只查看前端预览：

```bash
pnpm dev
```

浏览器预览使用示例日记与窗口数据；真实桌面窗口识别、CLI 调用和透明覆盖层需要 Tauri 原生环境。

## 检查与构建

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

构建桌面安装包：

```bash
pnpm run tauri build
```

运行已构建前端与原生后端：

```bash
pnpm build
cargo run --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol
```

## 技术结构

```text
src/
  App.tsx                       控制台、设置、CLI 状态与修复弹窗
  OverlayApp.tsx                透明交互层、画饼与反馈
  components/WhipPhysics.tsx     鞭子的物理运动与抽击反馈
  components/DiaryBook.tsx       翻页、筛选与长文分页
  lib/backend.ts                原生命令与浏览器预览数据
src-tauri/src/
  codex.rs                      反馈队列、日记生成与失败重试
  codex/resolver.rs              CLI 检测、路径与调用优先级
  codex/updater.rs               更新方式识别、执行与原路径验证
  codex/diagnostics.rs           分类错误与可复制的处理说明
  codex/{windows,macos}.rs       各平台 CLI 发现
  codex_window/                 窗口识别、原生覆盖层与窗口模式
  storage.rs                    设置、事件与 SQLite 日记存储
docs/media/                     GitHub 首页的展示图片和 GIF
```

反馈只静默记录一次，再由独立的 CLI 进程写日记；它不会注入或改写当前 Codex 对话。

## CLI 发现与更新

自动模式先检查外部 CLI，再尝试桌面客户端内置 CLI。手动配置 CLI 后，优先使用指定路径；指定文件不可用时会提示修复或切回自动检测。

- 候选文件通过短超时的 `--version` 检查，跳过损坏的候选。
- 设置中展示实际路径、版本与来源；启动成功不代表当前模型、账号或网络一定可用。
- 旧设置中的 `codex`、`codex.cmd` 等命令名仍可通过 `PATH` 解析。
- 更新检查成功后缓存 30 分钟，失败后缓存 60 秒；手动检查可强制刷新。
- 官方独立安装使用自更新；npm 使用原安装前缀；macOS Homebrew 使用对应 cask。
- 更新期间禁止并发生成日记。更新前后校验原路径及版本，防止只更新另一份 CLI。
- 内置 CLI、手动固定版本目录和无法识别的安装方式提供人工处理建议。
- 更新完成后自动重试当前运行中的失败任务，保留原时间、原因与上下文，不重复记录反馈。失败队列不跨应用重启保留。

Windows 商店版客户端位于系统管理的 `WindowsApps` 目录，内部 CLI 可能无法启动。遇到这种情况应安装外部 CLI；不要通过修改系统目录权限来绕过限制。

## 本地数据

默认数据目录有 D 盘时为 `D:\VibeKarmaData`，否则回退到系统应用数据目录。可通过 `VIBEKARMA_DATA_DIR` 覆盖。

```text
settings.json                  CLI 路径、Codex 配置目录及额外环境变量
events/YYYY-MM-DD.jsonl         反馈与本地事件
vibekarma.sqlite3               日记数据库
cli-update-cache/              更新缓存与临时下载
```

旧版本的 `diaries/index.json` 首次启动时会导入 SQLite，原文件保留。

日记 CLI 使用临时会话与 `read-only` 沙箱，工作目录为应用数据目录。日记进程沿用本机登录、Provider、`CODEX_HOME`，也可通过本地设置指定配置目录或额外环境变量。

窗口上下文和近期日记会成为生成提示的一部分，由本机 CLI 配置的 Provider 处理。真实日志、数据库、认证文件和密钥不应进入公开仓库或展示素材。

macOS 读取聊天内容需要辅助功能授权；未授权或读取失败不会阻止奖惩，会显示提示并降级生成日记。实现范围与后续验证步骤见 [Mac 验证说明](MACOS_VERIFICATION.md)。

## 发布流程

`.github/workflows/release.yml` 在推送 `v*` 标签时构建 Windows x64 NSIS/MSI、macOS Intel DMG 和 Apple Silicon DMG，生成草稿 Release。检查安装包及说明后，再发布草稿。

发布前同步 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 与 `src-tauri/tauri.conf.json` 的版本，在 `docs/releases/v版本号.md` 写发布说明，然后运行 `node scripts/check-release.mjs`。先推送普通提交并等待该提交在 main 的 CI 全部通过，再推送对应的版本标签；Release 会检查标签与版本一致、该提交的 CI 已成功，以及对应 Release 尚未正式发布。

CI 在 Windows、Mac Intel 与 Apple Silicon 上构建原生应用，并检查进程存活和隔离目录中的 SQLite 初始化。Release 另外核对四种安装包的版本、架构和基础启动，上传草稿附件与 Actions 测试报告。这些检查不代替实际 Codex 会话和人工权限授权测试。

安装包当前没有代码签名。签名证书与认证信息使用发布平台的加密秘密存储，不提交到源码仓库。

## 相关文档

- [首页与功能演示](../README.md)
- [展示素材说明](media/README.md)
- [安全说明](../SECURITY.md)
- [Apache License 2.0](../LICENSE)
- [署名与资源许可](../NOTICE)
