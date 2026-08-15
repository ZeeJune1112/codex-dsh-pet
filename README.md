# dsh-pet

English | [中文](README.zh.md)

An optional desktop companion for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It is **compatible with Codex desktop-pet packages** (`pet.json` plus an 8×9 or 8×11 sprite sheet) and can **import pets directly from [Petdex](https://petdex.dev/)** without installing the Petdex CLI.

The pet acts as an ambient agent-status indicator: it relaxes when DSH is idle, thinks while the model reasons, works while tools run, waits when input is needed, and celebrates or frowns when a turn finishes.

It is **not** a second chat UI, a task manager, or a full desktop app. It is a status indicator.

- **Plugin-first**: a normal deepseek-harness plugin — no separately launched daemon, browser, or desktop app.
- **Built-in Petdex import**: `/pet import <slug>` downloads an approved pet from the official Petdex API; normal rendering is local and has no telemetry.
- **Zero added LLM cost**: event → state resolution is fully deterministic.
- **Runtime-discovered pets**: pets under `assets/pets/` are discovered at startup, so adding a pet is dropping a folder in — no rebuild.

---

## Installation

The plugin is a Cordis **bundle** that ships both a host half (the pet window)
and a client half (the settings card). `dsh plugin add` installs it and, because
the manifest declares `dsh.bundle`, adds it to the profile's bundle list
automatically.

### From a local directory

Install the plugin directly from its source directory (the profile keeps it as
a `link:` dependency):

```sh
dsh plugin --profile <name> add /path/to/dsh-pet
```

On Windows, for example:

```sh
dsh plugin --profile web add D:/deepseek-pet
```

You can also run `dsh plugin --profile <name> add .` from inside the plugin
directory.

### From a tarball

Pack the plugin, then install the tarball:

```sh
npm pack
dsh plugin --profile <name> add /path/to/ysyyhhh-dsh-pet-0.2.0.tgz
```

### From a Git repository

```sh
dsh plugin --profile <name> add github:ysyyhhh/dsh-pet
```

If the repository does not commit build artifacts, configure a `prepare`
script so `dsh plugin add` builds the plugin during install.

### Run

```sh
dsh --profile <name>
```

> If you are running Harness from a source checkout, prefix the commands above
> with `pnpm` — i.e. run `pnpm dsh plugin ...` and `pnpm dsh ...` from the
> Harness repository.

> The settings card requires Harness to expose the `dsh-pet` settings
> namespace (via its `WEB_SETTINGS_NAMESPACES` allowlist). The pet window itself
> does not depend on that allowlist.

### Enable / disable

Set `enabled: false` in the plugin's config, or remove the bundle from the
profile. The plugin then loads but shows nothing; removing it entirely leaves
Harness fully functional.

---

## Codex pet compatibility and Petdex import

The plugin reads the same Codex pet package shape used by Petdex: a `pet.json`
manifest plus a WebP or PNG sprite sheet. Use the built-in commands from DSH:

```text
/pet import boba     # download, validate, install, and select from petdex.dev
/pet list            # list bundled and imported pets
/pet use boba        # select an installed pet
```

Imported pets persist under `~/.dsh/dsh-pet/pets/`, so plugin upgrades do not
remove them. You can also copy any compatible Codex pet folder there manually.

See **[Adding a Pet](docs/adding-a-pet.md)** for the full walkthrough, and the
**[asset format reference](docs/adding-a-pet.md#asset-format-reference)** for the
exact `pet.json` and sprite-sheet layout.

---

## Supported platforms

| Platform | Status |
|----------|--------|
| Windows 11 | ✅ primary target (Win32 layered window via koffi) |
| Linux (X11 / XWayland) | ✅ (XCB ARGB overlay; **requires a compositor**) |
| macOS | ❌ not implemented (backend interface is reserved) |

Linux per-pixel transparency needs a running compositor (GNOME/KDE ship one by default; lightweight WMs need picom or similar). On Wayland the overlay runs through XWayland.

---

## Configuration

All fields are optional and validated with a Schemastery schema (invalid values fail loudly at load). The user-editable fields (`enabled`, `petScale`, `petId`, `hideWhenIdle`) are exposed on the Web settings card.

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Master switch. |
| `alwaysOnTop` | `true` | Keep the pet above other windows. |
| `petScale` | `1` | Pet size, 0.5–4× in 0.25 steps. |
| `petId` | `text` | Which pet to display (a directory name under `assets/pets/`). |
| `hideWhenIdle` | `false` | Automatically hide the pet when it sleeps (no task), and show it again on activity. |
| `animationEnabled` | `true` | Run the frame animation (static frame when false). |
| `idleFrequencySec` | `20` | Seconds (≥8) between randomized idle variations. |
| `clickThrough` | `false` | Pass pointer events through (Windows only). |
| `startSleeping` | `false` | Start in the sleeping state. |
| `animationSpeed` | `1` | Global speed multiplier (0.25–4). |

Example:

```yaml
- insert:
    - id: dsh-pet
      name: "@ysyyhhh/dsh-pet"
      config:
        petScale: 1
        petId: text
        idleFrequencySec: 30
```

Window position is persisted privately under `~/.dsh/dsh-pet/position.json` (best-effort; failures are ignored). It does not depend on any Harness storage service.

### Developer mode

When the core `ctx.commands` service is present, the plugin also accepts renderer-state commands without invoking an LLM:

```text
/pet thinking
/pet working
/pet waiting_for_user
/pet success
/pet error
/pet reset
```

Valid states: `STARTING IDLE THINKING WORKING CODING RUNNING_COMMAND WAITING_FOR_USER SUCCESS ERROR SLEEPING`.

---

## Architecture

```
harness events / lifecycle
        ↓  (the only harness-specific layer)
integration/  HarnessBridge · capability-detection · event-mapping
        ↓  NormalizedEvent
core/         PetStateResolver · PetStateMachine · TaskStateRegistry
        ↓  SemanticState
renderer/     AnimationController · PetWindow
        ↓  finished RGBA frames
renderer/backend/  Win32Backend · X11Backend   (native overlays via koffi)
        ↑
renderer/codex-pet/  PetContract · PetLoader   (pet.json + sprite sheet)
```

- **`HarnessBridge`** is the only module that knows raw harness event names. Everything above it is harness-independent.
- **Pet core** (`core/`) is a standalone library: testable with no harness, no window, no network.
- **Backends** are platform-isolated behind `WindowBackend`; the renderer never sees Win32 or X11 details.
- **Client half** (`src/client/`) is a separate browser bundle registered through the harness module loader; the host and client halves communicate through the settings namespace.

### Harness dependencies

Only the Cordis plugin lifecycle and these **core** services/events are used:

- Plugin entry: `apply(ctx, config)` + `name` / `inject` / `Config`.
- Lifecycle: `ctx.effect()`, `ctx.on()`, `ctx.logger(name)`.
- Activity observation: `session/event`, `agent/status`.
- Settings: the `dsh-pet` settings namespace (host-side), bound by the client card.
- Optional (detected, not required): `ctx.agents`, `ctx.sessions`, `ctx.approval`, `ctx.commands`.

No non-core plugin is required. If an optional service is absent, the pet degrades gracefully (coarser states, no `/pet` command).

### External dependencies

| Package | Purpose | Runtime |
|---------|---------|---------|
| `koffi` | Win32 + X11 FFI for the overlay window | Node ≥22 |
| `sharp` | Decode WebP/PNG sprite sheets to RGBA | Node ≥22 |
| `@deepseek-ai/schemastery` | Config schema validation | Node ≥22 |
| `clsx` | Class-name helper for the client card (inlined into the browser bundle) | build |

Peer (type-only, not bundled): `@deepseek-ai/cordis`.

The client bundle's `react` and `@deepseek-ai/dsh-client-*` imports are externalized:
they are provided at runtime by the harness module loader, so the plugin does not
ship them as runtime dependencies (they appear only as dev dependencies for type
checking and bundling).

**Explicitly avoided**: Electron, Tauri, WebView2/webview, GLFW/SDL/raylib, game engines, GPU/OpenGL, Docker, databases, Redis, any external server, browser automation.

### Event → state mapping

| Normalized event (from harness) | Pet state (semantic → animation) |
|----------------------------------|----------------------------------|
| startup | `STARTING` → `waving` |
| idle (`agent/status: idle`) | `IDLE` → `idle` |
| `assistant/chunk` (text/reasoning/tool-call delta) | `THINKING` → `running` |
| `tool/call` (editing tools) | `CODING` → `running` |
| `tool/call` (shell/command tools) | `RUNNING_COMMAND` → `running` |
| `tool/call` (other) | `WORKING` → `running` |
| `approval/asked` / waiting | `WAITING_FOR_USER` → `waiting` |
| `turn/end` reason `completed` | `SUCCESS` → `review` |
| `turn/end` reason `error`/`aborted` | `ERROR` → `failed` |
| long quiet period | `SLEEPING` → `idle` |

`SUCCESS` / `ERROR` / `STARTING` are transient (default 2s) then return to `IDLE`. Concurrent agents are tracked per session/task and folded by priority `WAITING_FOR_USER > ERROR > WORKING > THINKING > SUCCESS > IDLE`.

### Extending

- **Adding a pet** — see [Adding a Pet](docs/adding-a-pet.md); no code change is required.
- **Adding an animation state** — extend `SemanticState` in `src/core/types.ts`, its resolver mapping in `src/core/PetStateResolver.ts`, and its renderer pose in `SEMANTIC_TO_CODEX`.
- **Adding a window backend** — implement `WindowBackend` (`src/renderer/backend/WindowBackend.ts`) and register it in `src/renderer/backend/selectBackend.ts`.

---

## Testing

```sh
npm test               # vitest unit tests (core + loader + integration)
npm run typecheck      # tsc --noEmit (host half)
npm run typecheck:client # tsc -p tsconfig.client.json --noEmit (client half)
npm run build          # tsdown bundle (host + client)
npm run gen:assets     # regenerate the bundled text pet
```

The pet core is tested without a harness or a display. The native overlay backends require a real desktop session and are **not** exercised by the headless test suite — they need manual verification on Windows/Linux.

---

## Known limitations

- **Linux transparency requires a compositor**; on Wayland the pet runs as an XWayland client (no native wlr-layer-shell).
- **macOS is not implemented**.
- The bundled placeholder is the `text` test pet only — original SVG-drawn text, with no OpenAI/Codex/DeepSeek character artwork or trademarks.
- Native window rendering (frameless/transparent/topmost/drag) has not been exercised by automated CI and needs a manual check on a real desktop.

---

## License

MIT.
