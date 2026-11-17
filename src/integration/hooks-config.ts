import { CODEX_HOOK_EVENT_TYPES } from './hooks'

export const HOOK_MARKER = '[codex-dsh-pet] State feedback'

/** cmd expands environment variables even inside quoted paths. */
export function createHookCommand(executable: string, script: string): string {
  if ([executable, script].some(path => /[%!"\r\n]/.test(path))) throw new Error('Unsupported character in Hooks command path')
  return `"${executable.replaceAll('\\', '/')}" "${script.replaceAll('\\', '/')}"`
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Generate user hooks.json content; this function never writes or trusts hooks. */
export function mergeHooksConfig(existing: string, command: string): string {
  const config: unknown = existing.trim() ? JSON.parse(existing) : {}
  if (!record(config)) throw new Error('hooks.json must be an object')
  const hooks = config.hooks ?? {}
  if (!record(hooks)) throw new Error('hooks must be an object')
  config.hooks = hooks
  for (const event of CODEX_HOOK_EVENT_TYPES) {
    const groups = hooks[event] ?? []
    if (!Array.isArray(groups)) throw new Error(`${event} must contain matcher groups`)
    const handler = {
      type: 'command', command, statusMessage: HOOK_MARKER,
      timeout: 1, async: event !== 'SessionEnd',
    }
    let found = false
    hooks[event] = groups.map((group: unknown) => {
      if (!record(group) || !Array.isArray(group.hooks)) throw new Error(`invalid ${event} matcher group`)
      const handlers = group.hooks.flatMap((entry: unknown) => {
        if (!record(entry) || entry.statusMessage !== HOOK_MARKER) return [entry]
        if (found) return []
        found = true
        return [handler]
      })
      return { ...group, hooks: handlers }
    })
    if (!found) (hooks[event] as unknown[]).push({ hooks: [handler] })
  }
  return `${JSON.stringify(config, null, 2)}\n`
}
