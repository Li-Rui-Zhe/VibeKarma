# macOS 聊天读取与验证

> 当前版本：v0.2.0。已接入 GitHub Actions 编译、原生测试和基础启动检查；具体通过情况以该提交的 Actions 结果为准。实际 Codex 会话与人工权限授权仍需真机验证。

## 实现行为

- 通过 Core Graphics 找到可见的 Codex / ChatGPT 窗口，再用 ApplicationServices 的 Accessibility API 读取该进程的窗口文本。
- AX 窗口的位置、尺寸必须与选中的桌面窗口一致，按逻辑点匹配，允许 2 点的取整误差。匹配不到或存在多个匹配窗口时，放弃本次读取，不转而读取其他会话。
- 按文档顺序提取 `AXStaticText`，优先使用网页 / 文档区域里的文本。跳过隐藏节点、密码框、输入框、未发送草稿、按钮和菜单子树。
- 只保留最近约 12,000 个 Unicode 字符。遍历最多 2,000 个节点、48 层，总读取预算 3 秒，单次 AX 通信超时 150 毫秒；读取在阻塞工作线程执行，不占用界面线程。超时或异常不返回部分会话。
- 按 Electron 官方方式设置 `AXManualAccessibility`，使网页辅助功能树可读；不执行界面动作、不输入文字、不使用剪贴板，不修改会话内容。
- 启动和定期检测只检查权限，不弹系统授权提示。用户点击应用设置里的“打开辅助功能设置”时才请求系统授权，并打开对应设置页。
- 无权限、窗口变化、文本为空或读取超时时，保留窗口互动功能，显示具体提示。日记改用奖惩类型、填写原因和近期日记，并明确告诉生成模型当前聊天内容不可用。
- 聊天文本仅传给后台日记生成流程，不通过窗口检测接口返回前端。

API 行为依据：[Apple AX 通信超时](https://developer.apple.com/documentation/applicationservices/1459345-axuielementsetmessagingtimeout)、[Apple 辅助功能授权](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions)、[Electron 辅助功能树](https://www.electronjs.org/docs/latest/tutorial/accessibility)。

## Windows 本地可验证的范围

运行 `pnpm test`、`pnpm build`、`cargo test --manifest-path src-tauri/Cargo.toml` 和 `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`。

读取算法的模拟树测试覆盖：窗口坐标匹配、中文与 emoji、最近文本长度、聊天顺序、文档外侧栏过滤、草稿 / 密码 / 隐藏内容排除、空文档、循环 / 超深 / 超大树、超时、读取中断以及错误后不使用部分文本。窗口状态测试覆盖降级不阻止奖惩、聊天文本不返回前端。

本次本地检查结果：19 项前端测试、46 项 Windows Rust 测试通过；前端构建、Rust 格式检查与 Clippy 通过。Windows 开发版重新编译后启动正常。对当前设置组件的本地渲染检查覆盖 Mac 权限提示、按钮等待状态、重新检测入口、降级 / 恢复状态及 Windows 不显示 Mac 授权入口。额外浏览器截图检查被环境的自动审批策略拦截，未完成视觉验证。

额外用本机已安装的 `aarch64-apple-darwin`、`x86_64-apple-darwin` Rust 标准库，对 Mac 原生读取模块及其测试做编译与 Clippy 检查。这个检查只生成编译元数据，不链接 Apple 系统框架、不运行 Mac 应用，也不生成安装包。

## 后续 Mac 环境验证

Actions 矩阵包含 Intel 和 Apple Silicon Mac。main 的 CI 先完成原生测试、完整应用编译与框架链接，再直接启动生成的 `.app` 可执行文件，在隔离数据目录中检查进程存活 12 秒和 SQLite 初始化。Release 要求相同提交的 CI 已通过，再生成 DMG，并核对安装包版本及架构，重复基础启动检查；Release 保留为草稿。

基础启动检查不安装 / 挂载 DMG，也不模拟 Finder 首次打开、Gatekeeper 放行、辅助功能人工授权或实际 Codex 聊天。因此不能据此声称这些交互已验证。

Mac 原生测试还包括 Core Foundation 文本类型检查与中文 / emoji 读取，以及无辅助功能权限时返回授权说明。这些测试随 Mac 上的 `cargo test` 运行，Windows 无法执行。

| 场景 | 预期结果 |
| --- | --- |
| 首次运行，没有辅助功能授权 | 应用正常启动；发现窗口后提示无法读取聊天；鞭子 / 画饼仍可用；日记可降级生成。 |
| 点击辅助功能设置入口 | 打开系统设置；允许安装的 VibeKarma 后重新检测。若系统权限缓存未刷新，退出后重开；不要求关闭 SIP 或修改系统文件。 |
| 授权后，打开 Codex 的一段实际聊天 | 本次奖惩生成的日记能参考当前聊天；不把输入框中的未发送内容作为素材。 |
| 同一进程有两个不同位置的会话窗口 | 只读取当前选中的可见窗口；不会拼接两个会话。 |
| 同一进程存在完全重叠的多个匹配窗口 | 明确提示无法确定窗口，本次不读聊天。 |
| Retina、外接屏、窗口移动 / 缩放 | 覆盖层按逻辑点对齐；检测时窗口位置变化则降级，重新检测后恢复。 |
| Codex 窗口关闭、界面树异常、特别长的会话 | 提示未读取聊天或未找到窗口；不会无限等待、崩溃或使用上次的聊天文本。 |
| 授权撤销、更新安装后权限失效 | 回到权限提示，保留奖惩与降级日记；重新授权后恢复。 |
| Homebrew / npm / 独立 CLI 更新 | 更新正确的安装路径，验证同一路径版本后才重试日记；内置 CLI 指引更新桌面客户端。 |

Actions 能验证编译、测试和打包，但不能代替实际 Codex 窗口、人工授权和多显示器测试。没有完成这些检查前，不应把“代码适配完成”写成“Mac 全流程已验证”。
