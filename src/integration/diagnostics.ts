import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { defaultHostDataDir } from '../host/persistence'
import type { NormalizedHookEvent } from './hooks'
import type { CodexFeedbackState } from '../standalone'

type ErrorCode = 'INVALID_INPUT' | 'INPUT_TOO_LARGE' | 'DELIVERY_UNAVAILABLE' | 'HOST_EVENT_FAILED' | 'STALE_EVENT' | 'STALE_WAIT' | 'STALE_ACTIVITY'
interface Diagnostic {
  event?: Pick<NormalizedHookEvent, 'eventType' | 'sessionId' | 'turnId'>
  stateTransition?: { from: CodexFeedbackState; to: CodexFeedbackState }
  errorCode?: ErrorCode
}

/** Construct a fresh allowlist record; never serialize the caller's event or exception. */
export function recordDiagnostic(value: Diagnostic, directory = defaultHostDataDir()): void {
  if (process.env.CODEX_PET_DIAGNOSTICS !== '1') return
  try {
    const event = value.event
    const record = {
      ...(event ? { eventType: event.eventType, sessionHash: createHash('sha256').update(event.sessionId).digest('hex'),
        ...(event.turnId === undefined ? {} : { turnId: event.turnId }) } : {}),
      ...(value.stateTransition ? { stateTransition: { from: value.stateTransition.from, to: value.stateTransition.to } } : {}),
      ...(value.errorCode ? { errorCode: value.errorCode } : {}),
    }
    const path = join(directory, 'diagnostics.jsonl')
    let size = 0
    try { size = statSync(path).size } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return }
    const line = `${JSON.stringify(record)}\n`
    // shortcut: stop at 1 MiB; delete the local log before collecting a new validation run.
    if (size + Buffer.byteLength(line) > 1024 * 1024) return
    mkdirSync(directory, { recursive: true })
    appendFileSync(path, line, { encoding: 'utf8', mode: 0o600 })
  } catch { /* diagnostics must never change hook or host behavior */ }
}
