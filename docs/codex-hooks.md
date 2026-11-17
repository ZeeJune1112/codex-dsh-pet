# Codex session-isolated hook feedback

Build with `npm run build`. `node lib/hooks.js --generate-config` reads the user
`$CODEX_HOME/hooks.json` (default `~/.codex/hooks.json`) and prints merged JSON to
stdout. An optional path argument selects the input file for review/testing. It
does not write configuration or activate/trust hooks. Only handlers marked
`[codex-dsh-pet] State feedback` are replaced; unrelated user fields and hooks
are retained. Repeating generation produces the same result. Malformed config
fails without producing replacement content.
Node or wrapper paths containing `%`, `!`, quotes, or line breaks are rejected
because Windows command expansion can change their meaning even inside quotes.
Generation then exits with an error and emits no replacement JSON.

Use the generated JSON when reviewing the user hook configuration. Do not
redirect output over the input file: shell redirection can truncate it before
it is read. Codex's native review in Settings > Hooks (or `/hooks` in the CLI)
is still required. Config already using inline TOML hooks should be reviewed
before adding a second representation; this generator only merges hooks.json.

For a concrete, non-activating PowerShell review copy (UTF-8 without a BOM):

```powershell
npm run build
[IO.File]::WriteAllText("$PWD/hooks.review.json", (node lib/hooks.js --generate-config | Out-String))
```

Inspect the eight desktop-pet entries in `hooks.review.json`, including the resolved
Node and wrapper paths, one-second timeout, async settings and preservation of your
unrelated hooks. This file is a review artifact, not an active config. When ready,
the user can copy the reviewed merged content to the input `hooks.json` location.
Then use the desktop composer **Review hooks**, or **Settings > Hooks** (CLI:
`/hooks`), to review and enable the exact definitions. A changed definition needs
fresh review. Neither the generator nor these verification scripts write approval
hashes, disable trust checks, or confirm native approval from file presence.
Keep the review copy private because unrelated user hook commands may be present.

The wrapper forwards only event type, session ID, optional turn ID, timestamp,
tool name and a recognized permission-mode value. It does not open a transcript,
persist the input, forward tool arguments/results, call a model, or return
approval/block/context output. Raw stdin is capped at 64 KiB. Malformed input,
unreachable pipes, and failed launches silently exit zero.

The Windows pipe name includes a hash of the user's home directory. An initial
connection failure starts the standalone host detached with hidden stdio. The child
signals pipe readiness over a temporary IPC channel; the wrapper then retries
once. If a concurrent child loses ownership and exits, the launcher probes for
the winning host's pipe before sending that retry. Probes contain no event payload.
An acknowledgement failure after connection never launches a host or replays the
event, since the host may already have processed it. The channel is closed on
readiness or deadline, and a late signal cannot trigger delivery. Transport has
one 800 ms deadline including acknowledgement; the entire wrapper,
including stdin, has a 900 ms deadline after JavaScript startup. All generated
handlers set a one-second Codex timeout. `SessionEnd` is explicitly synchronous:
Codex runs it synchronously even if an async flag is set. Other handlers are
async. These limits may drop an event on a slow cold start; a later event can
reach the running host. The per-user name prevents ordinary user collisions;
it is not authentication against another process able to access the pipe.

The host routes events by opaque session ID. A new session first binds an
unbound pet; if all pets are bound, the host creates another instance. Instances
have separate IDs and windows, so multiple chats can use the same role. Focus
does not change a binding. Drag, hover, right-click hide and scale affect only
the selected instance. Role loading uses the downstream `pets` directory under
the host data directory, with bundled roles as fallback; it does not consult
the upstream `~/.dsh` directory automatically.

`state.json` under `%LOCALAPPDATA%\codex-dsh-pet` stores version 2 configuration:
instance ID, role ID, opaque session binding, position, scale and visibility.
Writes use a flushed temporary file and atomic rename. Existing single-pet
position/scale files migrate on load. Events, turn IDs, feedback and timestamps
are excluded from this state file; chat content and tool data are never saved.
Restart restores each bound pet as
UNKNOWN/unobserved and each unbound pet as IDLE. A new observation can restore
feedback; history lost during restart cannot be reconstructed.

Older observed timestamps and events for turns already interrupted, ended or
replaced by a newer prompt are ignored. Turn IDs are opaque identities and are
never sorted. Stop is a continuation boundary: it sets UNKNOWN but still allows
later activity in the same turn. Equal-time conflicts, unknown competing turns
and missing turn IDs produce conservative UNKNOWN feedback. An ambiguous event
cannot clear an existing possible wait. PermissionRequest itself can establish
possible waiting even without a turn ID. With no source timestamp, adapter
receipt time is used; this cannot reconstruct the true order of delayed hooks.

| Hook / observation | Public snapshot `feedback` | Existing animation |
| --- | --- | --- |
| SessionStart | STARTING | waving |
| UserPromptSubmit | THINKING | running |
| PreToolUse, PostToolUse | WORKING | running |
| PermissionRequest | POSSIBLY_WAITING | waiting |
| Stop | UNKNOWN | neutral idle pose |
| Interrupt | INTERRUPTED | neutral idle pose |
| SessionEnd | ENDED | neutral idle pose |
| Work without fresh evidence for 30 seconds | UNKNOWN, stale | neutral idle pose |
| Permission wait without fresh evidence for five minutes | POSSIBLY_WAITING, stale | waiting |
| Unbound instance | IDLE | idle |

The neutral pose does not assert that Codex is idle or successful. Unknown,
interrupted and ended are separate public statuses for a future visible status
indicator. The existing sprite contract has no dedicated poses for them.
PermissionRequest only suggests possible waiting; trusted later activity can
supersede it without claiming that a particular approval was granted. A timer
never clears waiting. Stop never means success, and only a received SessionEnd
means ended. SessionEnd keeps the instance and its configuration; a subsequent
SessionStart or a prompt with a new turn ID can resume the same session. A
completed tool does not mean the turn is finished. The upstream harness state
machine is unchanged.

The management boundary is `DesktopPetHost.getSnapshot()`, which returns copies
of each instance's settings plus `feedback`, `pose`, `stale`, `lastEventAt` and
`lastEventType`. `availability` is `unbound`, `unobserved`, `observed`, `stale`, or
`unavailable` (host stopped). These describe local observations, not native Hook
trust: short-lived pipe connections cannot establish ongoing availability or
prove that a Hook was skipped. `bindInstance(id, sessionId)` explicitly rebinds,
and `bindInstance(id, null)` unbinds to idle; binding an already-bound session to
another instance is rejected. `updateInstance(id, { roleId, scale, visible })`
updates settings, and changes on one instance are serialized. A management UI
displays the separate feedback/stale/availability labels alongside neutral sprites.

## Opt-in diagnostics

Diagnostics are off unless the host/wrapper process has `CODEX_PET_DIAGNOSTICS=1`.
To collect a local host validation run, quit the existing host, then run:

```powershell
$env:CODEX_PET_DIAGNOSTICS = '1'
npm run start:host
```

Accepted events and stale-state errors go to
`%LOCALAPPDATA%\codex-dsh-pet\diagnostics.jsonl`. Wrapper delivery/input errors are
also recorded if that wrapper inherited the variable. The only record keys are
`eventType`, `sessionHash` (SHA-256), optional `turnId`, `stateTransition` (`from` /
`to`), and `errorCode`. Errors are fixed codes, never exception messages. Logs omit
raw session IDs, source input, prompts, tool names/arguments/results, transcript
paths/content and management tokens. This does not alter the existing session
binding stored in settings. Diagnostic writes fail open, stop at 1 MiB, and do not
rotate automatically. Delete the local log before a fresh collection if full.
To disable, quit the host, `Remove-Item Env:CODEX_PET_DIAGNOSTICS`, and restart.
Environment changes affect newly launched processes; they do not update a running
Codex app or host. A hash is correlation metadata, not proof of anonymization.

Tests cover whitelist parsing, idempotent merge, real local-pipe two-session
delivery and restart, separate same-role windows, turn ordering, same-turn Stop
continuation, stale waiting, explicit rebinding, settings persistence, detached
cold startup/retry, deadlines and silent wrapper exit. Pipe tests use a fake
window backend; they do not prove native Codex delivery or Windows interaction.
Live native Codex delivery and trust review still require a user session. Source contract:
[Codex Hooks](https://learn.chatgpt.com/docs/hooks), checked 2026-11-17.
