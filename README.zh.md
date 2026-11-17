# dsh-pet

[English](README.md) | 中文

独立 Codex 宿主的启动、管理链接、实例绑定、导入及显式迁移见 [本地管理说明](docs/management.md)。运行 `npm run start:host` 启动，`npm run management:url` 查询运行中宿主的管理链接。

**dsh-pet** 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的可选桌宠插件。它**兼容 Codex 桌宠格式**（`pet.json` + 8×9 或 8×11 精灵图），并且可以**直接在插件内从 [Petdex](https://petdex.dev/) 导入桌宠**，不需要额外安装 Petdex CLI。

桌宠会跟随 DSH 的工作状态：空闲时放松、模型推理时思考、执行工具时工作、等待输入时求关注，一轮任务结束时庆祝或失落。

它既是状态指示器，也带有完整的 Web 桌宠控制台：不需要再手写命令或修改 YAML。

- **插件优先**：就是一个普通的 deepseek-harness 插件，同时提供无需 Harness 的独立 Windows 宿主来运行内置桌宠。
- **界面直接配置**：当前桌宠大预览、横向宠物库、逐只显示/隐藏、大小、空闲隐藏和拖动排序都在 DSH 设置页完成。
- **真正的多桌宠**：每只桌宠拥有独立窗口、位置、大小与可见状态，可以同时显示并重叠。
- **双通道导入**：界面可直接输入 Petdex slug，也可上传 Codex / 口袋桌宠 ZIP；导入后立即选中并显示。
- **零额外 LLM 成本**：事件 → 状态的解析完全确定，不额外调用模型。
- **运行时发现宠物**：`assets/pets/` 下的宠物在启动时自动发现，添加宠物就是放进一个文件夹——无需重新构建。

---

## 安装

插件是一个同时包含宿主半（宠物窗口）和客户端半（设置卡片）的 Cordis **组合包**。`dsh plugin add` 会安装它，并因清单里声明了 `dsh.bundle` 而自动把它加入 profile 的 bundle 列表。

### 从本地目录安装

直接从插件源码目录安装（profile 会把它作为 `link:` 依赖保留）：

```sh
dsh plugin --profile <name> add /path/to/dsh-pet
```

Windows 下示例：

```sh
dsh plugin --profile web add D:/deepseek-pet
```

也可以在插件目录内执行 `dsh plugin --profile <name> add .`。

### 从 tarball 安装

先打包，再安装 tarball：

```sh
npm pack
dsh plugin --profile <name> add /path/to/ysyyhhh-dsh-pet-0.3.0.tgz
```

### 从 Git 仓库安装

```sh
dsh plugin --profile <name> add github:ysyyhhh/dsh-pet
```

如果仓库未提交构建产物，请配置 `prepare` 脚本，让 `dsh plugin add` 在安装时构建插件。

### 运行

```sh
dsh --profile <name>
```

也可以使用 Node 22/npm 单独启动内置文字宠物宿主（Windows 11）：

```sh
npm run start:host
```

宿主会把位置、缩放和单实例锁保存在 `%LOCALAPPDATA%\\codex-dsh-pet`。

> 如果你是从 harness 仓库源码运行，请在 harness 仓库目录内把上面的命令加上 `pnpm` 前缀——即执行 `pnpm dsh plugin ...` 与 `pnpm dsh ...`。

> 设置界面使用插件自有的同源 `/dsh-pet/*` API，不依赖 Harness 的设置命名空间白名单，因此可在当前 DSH Web 版本直接使用。

### 启用 / 停用

把插件配置里的 `enabled` 设为 `false`，或从 profile 中移除该 bundle。此时插件仍会加载但不显示任何东西；完全移除它对 Harness 正常运行毫无影响。

---

## Codex 桌宠兼容与 Petdex 导入

插件读取 Codex / Petdex 通用的桌宠包：`pet.json` 清单，加一张 WebP 或 PNG 精灵图。在 DSH 设置 → 插件 → DSH 桌宠中可以：

- 输入 Petdex 页面末尾的 slug 并直接导入。
- 上传 Codex 桌宠 ZIP。
- 上传口袋桌宠导出的 ZIP，并恢复其中可兼容的大小配置。

命令仍可作为开发与故障排查入口：

```text
/pet import boba     # 从 petdex.dev 下载、校验、安装并立即选中
/pet list            # 查看内置与已导入桌宠
/pet use boba        # 切换到已安装桌宠
```

导入内容保存在 `~/.dsh/dsh-pet/pets/`，升级插件不会丢失。你也可以把任何兼容 Codex 格式的桌宠文件夹手动复制到这里。

完整流程见 **[添加宠物](docs/adding-a-pet.zh.md)**，确切的 `pet.json` 与精灵图布局见 **[资源格式参考](docs/adding-a-pet.zh.md#资源格式参考)**。

---

## 支持平台

| 平台 | 状态 |
|----------|--------|
| Windows 11 | ✅ 首要目标（基于 koffi 的 Win32 分层窗口）|
| Linux（X11 / XWayland）| ✅（XCB ARGB 悬浮层；**需要合成器**）|
| macOS | ❌ 未实现（后端接口已预留）|

Linux 的逐像素透明需要一个运行中的合成器（GNOME/KDE 默认自带；轻量 WM 需要 picom 之类）。在 Wayland 上悬浮层通过 XWayland 运行。

---

## 配置

组合层字段仍用 Schemastery schema 校验。首次运行后，每只桌宠的可见状态、大小、位置、空闲隐藏和顺序会独立保存在 `~/.dsh/dsh-pet/state.json`，并由 Web 控制台即时写入。

| 字段 | 默认值 | 说明 |
|-------|---------|-------------|
| `enabled` | `true` | 总开关。 |
| `alwaysOnTop` | `true` | 让宠物置顶。 |
| `petScale` | `1` | 宠物大小，0.5–4 倍，步长 0.25。 |
| `petId` | `text` | 显示哪个宠物（即 `assets/pets/` 下的目录名）。 |
| `hideWhenIdle` | `false` | 宠物睡眠（无任务）时自动隐藏，有任务时重新显示。 |
| `animationEnabled` | `true` | 运行动画（为 false 时显示静态帧）。 |
| `idleFrequencySec` | `20` | 随机空闲动作间隔秒数（≥8）。 |
| `clickThrough` | `false` | 让指针事件穿透（仅 Windows）。 |
| `startSleeping` | `false` | 以睡眠状态启动。 |
| `animationSpeed` | `1` | 全局速度倍率（0.25–4）。 |

示例：

```yaml
- insert:
    - id: dsh-pet
      name: "@ysyyhhh/dsh-pet"
      config:
        petScale: 1
        petId: text
        idleFrequencySec: 30
```

旧版的单窗口配置会在首次启动时迁移；之后统一使用 `~/.dsh/dsh-pet/state.json`，不依赖 Harness 设置服务。

### 开发者模式

当核心的 `ctx.commands` 服务存在时，插件会注册一个 `/pet <state>` 命令，用于在不调用任何 LLM 的情况下模拟状态：

```text
/pet thinking
/pet working
/pet waiting_for_user
/pet success
/pet error
/pet reset
```

有效状态：`STARTING IDLE THINKING WORKING CODING RUNNING_COMMAND WAITING_FOR_USER SUCCESS ERROR SLEEPING`。

---

## 架构

```
harness 事件 / 生命周期
        ↓  （唯一的 harness 专属层）
integration/  HarnessBridge · capability-detection · event-mapping
        ↓  NormalizedEvent
core/         PetStateResolver · PetStateMachine · TaskStateRegistry
        ↓  SemanticState
renderer/     AnimationController · PetWindow
        ↓  最终 RGBA 帧
renderer/backend/  Win32Backend · X11Backend   （基于 koffi 的原生悬浮层）
        ↑
renderer/codex-pet/  PetContract · PetLoader   （pet.json + 精灵图）
```

- **`HarnessBridge`** 是唯一了解原始 harness 事件名的模块，其上的所有内容都与 harness 无关。
- **宠物核心**（`core/`）是一个独立库：无需 harness、无需窗口、无需网络即可测试。
- **后端** 在 `WindowBackend` 之后做平台隔离；渲染器永远看不到 Win32 或 X11 细节。
- **客户端半**（`src/client/`）是一个单独的浏览器 bundle，通过 harness 模块加载器注册；宿主半通过插件自有的同源 HTTP API 提供状态、预览和导入。

### Harness 依赖

只用到了 Cordis 插件生命周期和以下**核心**服务/事件：

- 插件入口：`apply(ctx, config)` + `name` / `inject` / `Config`。
- 生命周期：`ctx.effect()`、`ctx.on()`、`ctx.logger(name)`。
- 活动观察：`session/event`、`agent/status`。
- Web 控制台：核心 `webServer` 服务；缺失时桌宠窗口与命令仍可工作。
- 可选（探测、非必需）：`ctx.agents`、`ctx.sessions`、`ctx.approval`、`ctx.commands`。

不需要任何非核心插件。可选服务缺失时插件会优雅降级（状态更粗略、没有 `/pet` 命令）。

### 外部依赖

| 包 | 用途 | 运行时 |
|---------|---------|---------|
| `koffi` | 悬浮窗口的 Win32 + X11 FFI | Node ≥22 |
| `sharp` | 把 WebP/PNG 精灵图解码为 RGBA | Node ≥22 |
| `@deepseek-ai/schemastery` | 配置 schema 校验 | Node ≥22 |
| `clsx` | 客户端卡片的类名辅助（内联进浏览器 bundle）| 构建期 |
| `fflate` | 安全读取 Codex / 口袋桌宠 ZIP | Node ≥22 |

Peer（仅类型、不打包）：`@deepseek-ai/cordis`。

客户端 bundle 里的 `react` 和 `@deepseek-ai/dsh-client-*` 导入都是外部化的：它们由 harness 模块加载器在运行时提供，因此插件不会把它们作为运行时依赖发布（它们只作为 dev 依赖用于类型检查和打包）。

**明确避免**：Electron、Tauri、WebView2/webview、GLFW/SDL/raylib、游戏引擎、GPU/OpenGL、Docker、数据库、Redis、任何外部服务器、浏览器自动化。

### 事件 → 状态映射

| 归一化事件（来自 harness）| 宠物状态（语义 → 动画）|
|----------------------------------|----------------------------------|
| 启动 | `STARTING` → `waving` |
| 空闲（`agent/status: idle`）| `IDLE` → `idle` |
| `assistant/chunk`（text/reasoning/tool-call delta）| `THINKING` → `running` |
| `tool/call`（编辑类工具）| `CODING` → `running` |
| `tool/call`（shell/命令类工具）| `RUNNING_COMMAND` → `running` |
| `tool/call`（其它）| `WORKING` → `running` |
| `approval/asked` / 等待 | `WAITING_FOR_USER` → `waiting` |
| `turn/end` 原因 `completed` | `SUCCESS` → `review` |
| `turn/end` 原因 `error`/`aborted` | `ERROR` → `failed` |
| 长时间静默 | `SLEEPING` → `idle` |

`SUCCESS` / `ERROR` / `STARTING` 是临时状态（默认 2 秒）后回到 `IDLE`。并发 agent 按 session/task 分别跟踪，并按优先级 `WAITING_FOR_USER > ERROR > WORKING > THINKING > SUCCESS > IDLE` 合成。

### 扩展

- **添加宠物** —— 见 [添加宠物](docs/adding-a-pet.zh.md)；无需改代码。
- **添加动画状态** —— 在 `src/core/types.ts` 扩展 `SemanticState`，在 `src/core/PetStateResolver.ts` 扩展其解析映射，并在 `SEMANTIC_TO_CODEX` 扩展渲染姿态。
- **添加窗口后端** —— 实现 `WindowBackend`（`src/renderer/backend/WindowBackend.ts`）并在 `src/renderer/backend/selectBackend.ts` 注册。

---

## 测试

```sh
npm test                # vitest 单元测试（核心 + 加载器 + 集成）
npm run typecheck       # tsc --noEmit（宿主半）
npm run typecheck:client # tsc -p tsconfig.client.json --noEmit（客户端半）
npm run build           # tsdown 打包（宿主 + 客户端）
npm run gen:assets      # 重新生成内置的 text 宠物
```

宠物核心在无 harness、无显示环境的情况下测试。原生悬浮层后端需要真实桌面会话，**不**在无头测试套件中运行——需在 Windows/Linux 上人工验证。

---

## 已知限制

- **Linux 透明需要合成器**；在 Wayland 上宠物作为 XWayland 客户端运行（无原生 wlr-layer-shell）。
- **macOS 未实现**。
- 内置占位宠物只有 `text` 测试宠物——纯 SVG 绘制的文字，不含 OpenAI/Codex/DeepSeek 的角色美术或商标。
- 原生窗口渲染（无边框/透明/置顶/拖动）尚未被自动化 CI 覆盖，需在真实桌面上人工检查。

---

## License

MIT.
