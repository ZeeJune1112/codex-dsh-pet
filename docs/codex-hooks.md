# Codex single-session hook feedback

Build with `npm run build`. `node lib/hooks.js --generate-config` reads the user
`$CODEX_HOME/hooks.json` (default `~/.codex/hooks.json`) and prints merged JSON to
stdout. An optional path argument selects the input file for review/testing. It
does not write configuration or activate/trust hooks. Only handlers marked
`[codex-dsh-pet] State feedback` are replaced; unrelated user fields and hooks
are retained. Repeating generation produces the same result. Malformed config
fails without producing replacement content.

Use the generated JSON when reviewing the user hook configuration. Do not
redirect output over the input file: shell redirection can truncate it before
it is read. Codex's native review in Settings > Hooks (or `/hooks` in the CLI)
is still required. Config already using inline TOML hooks should be reviewed
before adding a second representation; this generator only merges hooks.json.

The wrapper forwards only event type, session ID, optional turn ID, timestamp,
tool name and a recognized permission-mode value. It does not open a transcript,
persist the input, forward tool arguments/results, call a model, or return
approval/block/context output. Raw stdin is capped at 64 KiB. Malformed input,
unreachable pipes, and failed launches silently exit zero.

The Windows pipe name includes a hash of the user's home directory. The first
delivery failure starts the standalone host detached with hidden stdio, waits
400 ms and retries once. Transport has an 800 ms deadline; the entire wrapper,
including stdin, has a 900 ms deadline after JavaScript startup. All generated
handlers set a one-second Codex timeout. `SessionEnd` is explicitly synchronous:
Codex runs it synchronously even if an async flag is set. Other handlers are
async. These limits may drop an event on a slow cold start; a later event can
reach the running host. The per-user name prevents ordinary user collisions;
it is not authentication against another process able to access the pipe.

The host binds the first received session for its process lifetime and ignores
other sessions. Restart it to observe a different session. Events and the
binding stay in memory; position/scale persistence is unchanged. Older observed
timestamps are ignored. With no source timestamp, adapter receipt time is used;
this cannot reconstruct the true order of delayed asynchronous hooks.

| Hook | Public `currentSemanticState` | Existing animation |
| --- | --- | --- |
| SessionStart | STARTING | waving |
| UserPromptSubmit | THINKING | running |
| PreToolUse, PostToolUse | WORKING | running |
| PermissionRequest | POSSIBLY_WAITING | waiting |
| Stop | UNKNOWN | neutral idle pose |
| Interrupt | INTERRUPTED | neutral idle pose |
| SessionEnd | ENDED | neutral idle pose |
| No fresh observation for 30 seconds | UNKNOWN | neutral idle pose |

The neutral pose does not assert that Codex is idle or successful. Unknown,
interrupted and ended are separate public statuses for a future visible status
indicator. The existing sprite contract has no dedicated poses for them.
PermissionRequest only suggests possible waiting; later activity supersedes it,
without claiming that a particular approval was granted. Stop never means
success, and only a received SessionEnd means ended. A completed tool does not
mean the turn is finished. The upstream harness state machine is unchanged.

Tests cover whitelist parsing, idempotent merge, real local-pipe delivery,
detached cold startup/retry, deadlines and silent wrapper exit. Live native
Codex delivery and trust review still require a user session. Source contract:
[Codex Hooks](https://learn.chatgpt.com/docs/hooks), checked 2026-11-17.
