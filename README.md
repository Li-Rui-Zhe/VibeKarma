# VibeKarma

VibeKarma 是一个用 Tauri 2、React 19 和 Rust 构建的 Codex 桌面伴侣。它覆盖在真实 Codex 桌面窗口上，把“惩罚一下”和“奖励一下”做成可操作的互动反馈，并让本机 Codex CLI 将这次反馈写成第一人称反省日记。

> 当前桌面交互依赖 Windows 窗口识别能力，完整体验以 Windows 为准。

## 当前功能

### 惩罚一下

- 自动识别当前可见的 Codex 桌面窗口，并在窗口范围内打开透明覆盖层。
- 鞭子会跟随鼠标按物理链条摆动；高速甩动时产生抽击、声音、震动和鞭痕反馈。
- 触发阈值经过降低，普通鼠标甩动也比较容易打出有效抽击。
- 一次覆盖层内可以连续抽击，但最终只记录一次惩罚。
- 单击放手并结束，`Esc` 撤回本次惩罚。

### 奖励一下

- 按钮文案为“奖励一下 / 画个大饼，现场兑现”。
- 悬停时，笔会沿着饼的轮廓完成绘制动效。
- 进入覆盖层后按住鼠标画饼，松手时校验轨迹；有效轨迹会现场变成一张真正的大饼。
- 轨迹太短或范围太小时不会提交，可以直接重画；`Esc` 退出。

### 反省日记

- 每次有效奖励或惩罚都会静默记录一次反馈，并异步启动独立的 Codex CLI 日记进程。
- 当前只有“奖励日记”和“挨打日记”，没有自动生成的“收工日记”。
- 日记参考当前 Codex 窗口的近期内容，以及最近三篇日记，用来保持角色和旧梗的连续性。
- 原因输入是可选的；留空时 Codex 根据窗口上下文判断，不再传递冗余的“用户补充”字段。
- 标题最多 20 个字符；正文不限制固定字数或段数。
- 日记正文按实际渲染尺寸自动分页，当前页放不下的内容会原样续到下一页，不会压缩、截断或覆盖页脚。
- 日记本支持拖动翻页，并使用独立的前封面与后封面插画。

## 实际工作流程

```text
点击奖惩按钮
  → 检查并定位真实 Codex 桌面窗口
  → 在目标窗口上显示透明互动层
  → 用户完成抽鞭子或画大饼
  → 静默记录一次反馈
  → 独立 Codex CLI 进程生成日记
  → 写入本地 SQLite
  → 日记本收到事件并显示新日记
```

奖惩反馈不会注入、打断或改写当前 Codex 任务。Rust 后端只读取可见窗口的近期文本作为日记素材，日记生成与正在工作的 Codex 会话彼此独立。

## 技术结构

- `src/`：React 界面、透明覆盖层、奖惩动效和日记本分页。
- `src/components/WhipPhysics.tsx`：鼠标驱动的鞭子物理与命中判断。
- `src/components/DrawPieIcon.tsx`：奖励按钮的画饼动效。
- `src/components/DiaryBook.tsx`：封面、翻页和基于 DOM 测量的正文分页。
- `src-tauri/src/codex_window.rs`：Codex 窗口识别、覆盖层定位和窗口模式。
- `src-tauri/src/codex.rs`：反馈队列、日记提示词和独立 Codex CLI 调用。
- `src-tauri/src/storage.rs`：设置、事件日志和 SQLite 日记存储。

主控制器默认为 `580 × 400`，打开日记本时切换为 `1000 × 700`。透明覆盖窗口只在奖惩互动期间显示。

## 运行要求

- Windows 10/11。
- Node.js 22 或更高版本。
- pnpm 10。
- Rust stable MSVC 工具链。
- Visual C++ Build Tools、Windows SDK 和 WebView2 Runtime。
- 已安装并可正常运行的 Codex CLI。
- 已打开且可见的 Codex 桌面客户端窗口。

VibeKarma 不保存 OpenAI API Key。日记进程继承本机 Codex CLI 已有的登录、Provider 和 `CODEX_HOME` 配置，也可以在应用设置中指定 Codex 可执行文件、独立 `CODEX_HOME` 或额外环境变量。

## 本地开发

```powershell
pnpm install
pnpm run tauri dev
```

如果 `1420` 端口已被旧的 Vite 进程占用，需要先关闭旧开发进程，再重新运行上述命令。

构建和测试：

```powershell
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

只运行已构建的前端与 Tauri 后端：

```powershell
pnpm build
cargo run --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol
```

## 数据位置

有 D 盘时，应用默认使用 `D:\VibeKarmaData`；否则回退到系统应用数据目录。可以通过 `VIBEKARMA_DATA_DIR` 覆盖数据位置。

```text
settings.json
events/YYYY-MM-DD.jsonl
vibekarma.sqlite3
```

旧版本的 `diaries/index.json` 会在首次启动时导入 SQLite，原文件不会被删除。

日记进程使用临时会话、`read-only` 沙箱和 `never` 审批策略。它的工作目录是 VibeKarma 数据目录，不会修改用户项目。

## 发布

推送 `v*` 标签会触发 GitHub Actions，创建草稿 Release，并尝试构建 Windows x64、Linux x64、macOS Intel 和 macOS Apple Silicon 安装包。当前真实 Codex 窗口识别与互动覆盖层仍是 Windows 专属能力；其他平台的安装包不代表完整功能已经适配。

```powershell
git tag v0.1.0
git push origin v0.1.0
```

未配置代码签名时，Windows SmartScreen 和 macOS Gatekeeper 可能提示应用未签名。签名证书、SSH 私钥、API Key 和本地认证文件都不应提交到仓库。

## 安全边界

- React 前端不能直接执行任意系统命令。
- 奖惩交互只覆盖已经识别到的可见 Codex 窗口。
- 当前反馈流程不会模拟键盘输入，也不会写入系统剪贴板或当前 Codex 任务。
- Codex 登录信息由本机 Codex CLI 管理，VibeKarma 不复制凭据。
- 日记生成失败时记录本地错误，不会伪造一篇成功生成的日记。
- `output/`、`tmp/`、日志、数据库、本地配置和 `badclaude/` 参考项目均不进入版本库。

更完整的安全说明见 [SECURITY.md](./SECURITY.md)。

## License

[MIT](./LICENSE)
