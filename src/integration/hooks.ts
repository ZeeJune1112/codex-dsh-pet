/** Hook events whose payloads are safe and useful for one pet session. */
export const CODEX_HOOK_EVENT_TYPES = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Stop',
  'Interrupt',
  'SessionEnd',
] as const

export type CodexHookEventType = typeof CODEX_HOOK_EVENT_TYPES[number]

export interface HookStateMetadata {
  toolName?: string
  permissionMode?: string
}

/**
 * The only shape allowed across the hook boundary. It deliberately has no
 * transcript, model, cwd, tool input, tool output, or arbitrary payload.
 */
export interface NormalizedHookEvent {
  eventType: CodexHookEventType
  sessionId: string
  turnId?: string
  timestamp: number
  state?: HookStateMetadata
}

type RecordValue = Record<string, unknown>

function asRecord(value: unknown): RecordValue | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : null
}

function readString(value: unknown, maxLength = 256): string | undefined {
  if (typeof value !== 'string') return undefined
  const result = value.trim()
  return result.length > 0 && result.length <= maxLength ? result : undefined
}

function readTimestamp(input: RecordValue, fallback: number): number {
  const value = input.timestamp ?? input.time
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function hookType(value: unknown): CodexHookEventType | undefined {
  const candidate = readString(value)
  return candidate !== undefined && (CODEX_HOOK_EVENT_TYPES as readonly string[]).includes(candidate)
    ? candidate as CodexHookEventType
    : undefined
}

function readState(input: RecordValue): HookStateMetadata | undefined {
  const nested = asRecord(input.state)
  const state: HookStateMetadata = {}
  const toolName = readString(nested?.toolName ?? nested?.tool_name ?? input.toolName ?? input.tool_name)
  const permissionMode = readString(nested?.permissionMode ?? nested?.permission_mode ?? input.permissionMode ?? input.permission_mode)
  if (toolName !== undefined && /^[\w.:-]{1,128}$/.test(toolName)) state.toolName = toolName
  if (permissionMode !== undefined && ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk'].includes(permissionMode)) state.permissionMode = permissionMode
  return Object.keys(state).length > 0 ? state : undefined
}

/** Parse one Codex hook stdin payload without retaining or forwarding raw input. */
export function normalizeHookEvent(input: unknown, now = Date.now()): NormalizedHookEvent | null {
  const record = asRecord(input)
  if (!record) return null
  const eventType = hookType(record.hook_event_name ?? record.event_type ?? record.eventType ?? record.event)
  const sessionId = readString(record.session_id ?? record.sessionId)
  if (eventType === undefined || sessionId === undefined) return null
  const turnId = readString(record.turn_id ?? record.turnId)
  const timestamp = readTimestamp(record, now)
  const state = readState(record)
  const normalized: NormalizedHookEvent = { eventType, sessionId, timestamp }
  if (turnId !== undefined) normalized.turnId = turnId
  if (state !== undefined) normalized.state = state
  return normalized
}
