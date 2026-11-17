import { describe, expect, it } from 'vitest'
import { normalizeHookEvent } from '../src/integration/hooks'

describe('Codex hook normalization', () => {
  it('keeps only the whitelisted event/session/turn/time/state fields', () => {
    const result = normalizeHookEvent({
      hook_event_name: 'PreToolUse',
      session_id: 'session-1',
      turn_id: 'turn-2',
      timestamp: 1700000000000,
      tool_name: 'Bash',
      permission_mode: 'default',
      transcript_path: 'C:\\private\\transcript.jsonl',
      model: 'secret-model',
      cwd: 'C:\\repo',
      arbitrary: { raw: 'payload' },
    })

    expect(result).toEqual({
      eventType: 'PreToolUse',
      sessionId: 'session-1',
      turnId: 'turn-2',
      timestamp: 1700000000000,
      state: { toolName: 'Bash', permissionMode: 'default' },
    })
    expect(JSON.stringify(result)).not.toContain('transcript')
    expect(JSON.stringify(result)).not.toContain('secret-model')
  })

  it('rejects unknown events and missing session ids without throwing', () => {
    expect(normalizeHookEvent({ hook_event_name: 'Unknown', session_id: 's1' })).toBeNull()
    expect(normalizeHookEvent({ hook_event_name: 'Stop' })).toBeNull()
    expect(normalizeHookEvent(null)).toBeNull()
  })

  it('normalizes a missing timestamp from the supplied clock', () => {
    expect(normalizeHookEvent({ hook_event_name: 'SessionStart', session_id: 's1' }, 1234)).toEqual({
      eventType: 'SessionStart', sessionId: 's1', timestamp: 1234,
    })
  })

})
