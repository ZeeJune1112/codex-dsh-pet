# Upstream baseline and local patches

The preserved upstream is [ysyyhhh/dsh-pet](https://github.com/ysyyhhh/dsh-pet),
commit [`a17346b9c41efb4220f387216008928bba652e0e`](https://github.com/ysyyhhh/dsh-pet/tree/a17346b9c41efb4220f387216008928bba652e0e).
Its history is an ancestor of this checkout, and `upstream` remains the upstream
remote. The origin remote is the downstream repository. The recorded upstream
HEAD check on 2026-11-17 still matched this baseline; later releases are not yet
tested. The upstream MIT notice remains verbatim in root `LICENSE`.

| Local patch | Reviewable starting commit / paths | Regression evidence |
| --- | --- | --- |
| Standalone Windows lifecycle, settings and original bundled role | `26214b9407df5dbfeef0dcffd9ee6bc2b147d20e`; `src/standalone.ts`, `src/host/persistence.ts` | host persistence, renderer and real native smoke |
| Hook allowlist, config merge, bounded wrapper, named pipe | `160c70602c8f7668106aa24c07eb5fa624f3bda4`; `src/hooks.ts`, `src/integration/hooks*`, `src/host/hook-server.ts` | parsing/config tests, real pipe and emitted wrapper checks |
| Per-session instances, conservative order/turn handling, persistent binding | `2ff69ae79074d94efff28fac221aecb5e718a75d`; `src/standalone.ts`, host persistence | two-session pipe pipeline, stale wait, Stop continuation and restart |
| HWND callback isolation, offscreen recovery, topmost/speed, bounded atomic imports; Sharp 0.35.5 | `f2a42b3c0134bc25c7a6043f5a9565ff5ed237b0`; Win32 backend, PetWindow, import modules and lockfile | injected Win32 messages, retained animation tests, real ZIP/decode tests |
| Standalone manager, downstream role directory and explicit migration | `27859fa12205e0765c74f6519018f9c784cb8a10`; `src/management`, client standalone and shared cards | real HTTP, React controls, import/migration tests and native API smoke |
| Readiness signal, opt-in diagnostic metadata, verification and source notices | `2b9d3ba90058869c33de181f57093d62cfeccdb9`; `src/integration/diagnostics.ts`, `src/integration/hooks-transport.ts`, `scripts/verify-pipeline.mjs` | deterministic deadline/late-readiness test, detached-child readiness, allowlist log and built pipeline |
| Final integration review: native ownership, ACK/readiness races, command paths, image bounds and concurrent hide | `src/host/persistence.ts`, `src/integration/hooks*`, `src/renderer/codex-pet/PetLoader.ts`, imports, `src/standalone.ts` | concurrent Windows child/crash recovery; real pipe with delayed backend/winning listener; rejected shell-sensitive paths; pre-allocation checks across all import paths; role-load/hide regression |
| Follow-up review: first-opening updates, shutdown drain, legacy preferences and failed-role recovery | `src/standalone.ts`, `src/management`, shared pet card | deferred atlas/update race; incomplete HTTP body releases windows/mutex; same-role migration preserves both settings; missing/corrupt roles remain repairable through management |

Compatibility means retaining the sprite contract, row/frame timing, renderer,
management operations and plugin entry points while fixing known defects. It
does not mean byte-for-byte behavior of a broken callback or waiting state.
Only the original Text (test) role exists in the baseline asset tree; imported
character artwork is deliberately local, not a newly invented substitute for an
upstream character collection.

## Sync procedure

1. Start from a clean review branch and record the current downstream SHA. Fetch
   `upstream`, select an exact candidate SHA, and compare it with the baseline:
   `git diff a17346b9c41efb4220f387216008928bba652e0e <candidate-sha> -- src assets package.json`.
2. Merge the selected upstream commit, keeping history. Resolve each patch row
   above against the upstream implementation; retire a patch only when the
   upstream behavior passes its regression. Keep unrelated user edits out of the
   sync. Do not overwrite downstream bindings or copy imported roles into Git.
3. Run `npm ci`, both typechecks, `npm test`, `npm run build`, all native-free
   verification scripts and `npm pack --dry-run`. On Windows 11 x64, also run
   `npm run verify:native` and the physical checks in `windows-validation.md`.
   Recheck the source notice/lockfile inventory and `npm audit --omit=dev`.
4. Repeat native-reviewed Hooks acceptance when adapter/config/runtime behavior
   changes. Record the candidate SHA, each retained/retired patch and evidence
   classification before updating this baseline. A build or fixture run cannot
   certify real Codex delivery or compatibility with future upstream releases.
