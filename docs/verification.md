# Windows source-release verification

Status on **2026-11-17**: automated code, native pipe/window smoke and management
checks are available. **Issue #7 remains open**: no desktop-pet definitions have
been approved through native Hooks review, and actual Codex event delivery and
physical desktop interaction acceptance are not yet verified. No validation
here activates Hooks, writes trust decisions, or makes model calls.

Environment observed: Windows 11 x64, NT build 26200; Node 22.23.2, npm 10.9.8.
The integration baseline before this verification patch was `69940e1`; the
upstream baseline and scoped patches are in [upstream-sync.md](upstream-sync.md).
This patch passed 129 tests in 24 files, both typechecks, build, all five
verification commands (including native), and package dry-run on that Windows
environment. The baseline `LICENSE` and `assets` trees are unchanged. A separate
fresh native child signalled readiness and accepted its first synthetic event
in 649 ms in one observed run, then the authenticated manager quit it; this
measurement is not a startup-time guarantee.

## Evidence classification

**Observed** means the stated local runtime/API was exercised. **Synthetic**
means supplied events, an injected clock/backend, or test fixtures; even when a
native pipe/window is used, this does not establish Codex Hook semantics.
**Public-doc** means a published contract only. **Not-tested** means no acceptance
claim can be made. A row may identify native observation and synthetic input
separately.

| Capability | Evidence / method | Classification and limit |
| --- | --- | --- |
| Native Windows process, transparent backend creation, pipe delivery and shutdown | Root smoke at `0afd9c4`; native two-window/same-role isolation and restart at `1cabed3`; reproducible `verify:native` | Observed Win32/pipe; Synthetic event inputs; no physical visual acceptance |
| Two sessions, stale wait, later tool activity, Interrupt, SessionEnd, restart, failed pipe | `verify:pipeline`, `verify:native`, `standalone.spec.ts` | Synthetic events/clock; real local pipe and host. Five-minute reducer behavior is accelerated, not five minutes of real Codex waiting |
| Full native management role import/window/bind/scale/hide/preview/Quit | Root smoke at `69940e1`, ZIP derived only from bundled test art; unauthenticated HTTP 401 / token page 200 | Observed real Win32 and HTTP API; no third-party role download |
| Browser manager render/bind/Quit | Prior browser check of built manager, plus React and real HTTP tests | Observed browser check; Synthetic test inputs; not physical pet window interaction |
| Opt-in diagnostics privacy | Real pipe test plus emitted wrapper `verify:hooks`; default writes no log; opted-in record has only allowlisted fields and hashed session | Synthetic privacy fixture; raw input/tool/prompt/transcript data absent |
| Cold host readiness and failure limits | Detached child reports pipe listening; tests verify deadline expiry and prohibit late retries. Previously 400 ms retry failed twice under load (503/508 ms observations) | Synthetic deterministic readiness/deadline regression; does not guarantee an OS can start a host within 800 ms |
| Wrapper fail-open | `verify:hooks`: invalid JSON, absent session, stalled stdin return zero with empty stdout/stderr; transport error tests | Observed emitted wrapper + Synthetic failures. Whole wrapper bound is 900 ms after JS startup, transport 800 ms; process scheduling/startup is not a hard real-time guarantee |
| Upstream contract, frames, management and imports | Preserved contract/animation/runtime tests, actual ZIP decoding, backend message tests, client registration; [patch ledger](upstream-sync.md) | Synthetic compatibility regression against pinned baseline; no future-upstream certification |
| Hook lifecycle names, IDs, SessionEnd synchronous behavior and trust review | [Official Hooks guide](https://learn.chatgpt.com/docs/hooks), reviewed 2026-11-17 | Public-doc; no local real delivery assertion |
| Native Pet customization surface | [Official Pets guide](https://learn.chatgpt.com/docs/pets), reviewed 2026-11-17 | Public-doc; asset customization does not replace this independent host |
| Actual approved two-chat Hooks, user permission wait/recovery, Interrupt and SessionEnd | Awaiting native review and user-directed activity | Not-tested; approval-policy=never cannot manufacture a real permission prompt |
| Physical drag/hover/right-click, mixed DPI, monitor removal, topmost | [Windows manual checklist](windows-validation.md) | Not-tested. Computer-use attempt failed GetCursorPos with access denied 0x80070005 |
| Concurrent stale singleton-lock recovery | Sequential lock rejection/restart covered; stale-lock removal race remains for final review | Not-tested race; do not claim flawless singleton recovery |

## Reproduce without activating Hooks

```powershell
npm ci --ignore-scripts
npm run typecheck
npm run typecheck:client
npm test
npm run build
npm run verify:hooks
npm run verify:pipeline
npm run verify:management
npm run verify:client-registration
npm pack --dry-run
npm audit --omit=dev --ignore-scripts
```

CI runs these native-free checks on Ubuntu and Windows with Node 22 for pushes
(including integration) and pull requests. A configured job is not evidence of
a completed remote CI run. For a real desktop-capable Windows machine, additionally
run `npm run verify:native`: it opens two real windows, uses a unique named pipe
and temporary `LOCALAPPDATA`, sends synthetic events, exercises restart, and
closes the host/removes its test directory. It does not inspect the user's roles,
modify user Hooks or use production session IDs. `verify:management` uses the
built browser bundle/API with a synthetic window backend. Do not label any of
these commands as real Codex Hook validation.

The readiness regression waits for an explicit pipe-listening signal. Tests use
a generous fixture startup guard and an injected clock for deadline behavior;
they do not assert that a loaded OS schedules a child in a particular number of
milliseconds. If production readiness exceeds its budget, the event is dropped,
the wrapper exits silently, and a later event may reach the now-running host.

## Human acceptance handoff

1. Build and produce the concrete merged review file described in
   [codex-hooks.md](codex-hooks.md). Check preserved unrelated entries and resolved
   Node/wrapper paths. The user installs the reviewed content and reviews/enables
   the definitions in **Settings > Hooks** or composer **Review hooks**. Record
   the app version and exact reviewed definitions privately; never hand-write
   trust hashes or use a trust bypass.
2. Start the host with opt-in diagnostics. Use two existing disposable chats
   during user-authorized work. Record only allowed diagnostic metadata plus
   pass/fail observations: first binding, independent tool activity, and no
   cross-session state changes. Do not launch model activity just to inflate
   verification evidence.
3. Observe a real PermissionRequest caused by an authorized operation in a chat
   that actually requests approval. Leave it unresolved for over five minutes;
   confirm the instance remains waiting and becomes stale. Resolve it through
   the normal UI, then record the next observed event. No specific permission
   release event is assumed or documented by this integration.
4. Interrupt one active authorized chat and confirm the other pet is unaffected.
   Quit/restart the host and test later events; compare with the synthetic pipe
   failure check. Confirm bounded silent failure changes no approval, rejection
   or context in Codex. Absence of a Hook does not establish a trust state.
5. For SessionEnd, use a user-authorized disposable-chat lifecycle action that
   actually yields an event. A focus change is not evidence; a crash need not
   produce SessionEnd. Confirm the instance remains configured and sleeps only
   after the observed end/idle policy.
6. Complete every physical step in `windows-validation.md`, including two
   HWNDs, DPI/monitor changes and cleanup. Record actual results by classification.
   Close #7 only after these required real checks are complete; a report of
   missing access must leave the corresponding criterion open.

## Source release and security inventory

- Keep source history, root MIT license, [third-party notices](../THIRD_PARTY_NOTICES.md),
  native license/version inventory, and the exact lockfile. Source packaging
  excludes `node_modules`, user settings, logs and imported artwork.
- Ship no installer, resident service, model integration, trust approval or
  third-party character artwork. Only the baseline original Text (test) role is
  licensed/provenanced here; character import stays local.
- Production audit after Sharp **0.35.5**: **0** reported vulnerabilities on
  2026-11-17. This remediates the earlier libheif/librsvg advisories
  [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) and
  [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).
  An npm audit is a registry snapshot, not a security proof.
- All-dependency audit: **11 package entries** (4 high, 2 moderate, 5 low), all
  remaining paths dev-only in this lockfile. These include propagated package
  entries, not 11 distinct vulnerabilities. No broad major updates were applied.

| Remaining dev dependency | Advisory / exposure to review | Candidate scope |
| --- | --- | --- |
| js-yaml 4.3.1 | [empty YAML merge CPU exhaustion](https://github.com/advisories/GHSA-2883-xcg3-v3hh) | Compatible 4.3.2 update with upstream dev-tool regression |
| source-map-js 1.2.1 | [indexed source-map offsets DoS](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) | Compatible 1.2.2 update |
| vitest / @vitest/mocker 4.1.10 | [read/path traversal](https://github.com/advisories/GHSA-82fw-gwwq-j7x9), [mock registration injection](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) | Compatible 4.1.12; current CI uses non-server `vitest run` |
| vite 8.2.1 | [Windows editor launch](https://github.com/advisories/GHSA-698v-4r3x-3vcv), [file serving](https://github.com/advisories/GHSA-r825-w8mm-5pxw), [middleware](https://github.com/advisories/GHSA-587h-7wmj-h5pm), [additional path](https://github.com/advisories/GHSA-9jrq-w75r-8gcw), [additional file path](https://github.com/advisories/GHSA-rq7h-c2jc-7f22), [additional server path](https://github.com/advisories/GHSA-vfpm-58rq-9qcg) | Compatible 8.2.4; no exposed dev server was validated |
| zod 4.4.3 | [oversized constrained collections](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | 4.6.6 after checking all parent ranges |
| katex 0.16.47 and DSH/micromark parent entries | [trust bypass with existing prototype pollution](https://github.com/advisories/GHSA-238p-pmpm-9mq7) | First reported fix 0.18.2 does not satisfy current ^0.16 parent ranges; separate upstream/override review needed |

The source-first developer still installs dev dependencies; keep the remaining
advisories visible and re-audit before release. A future native-binary release
needs the additional source/relinking obligations in the native notices review.
