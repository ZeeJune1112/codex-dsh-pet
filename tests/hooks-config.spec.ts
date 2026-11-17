import { describe, expect, it } from 'vitest'
import { createHookCommand, HOOK_MARKER, mergeHooksConfig } from '../src/integration/hooks-config'

describe('Codex user hooks config generator', () => {
  it('quotes paths with spaces and rejects paths that cmd could expand or split', () => {
    expect(createHookCommand('C:\\Program Files\\node.exe', 'C:\\pet folder\\hooks.js')).toBe('"C:/Program Files/node.exe" "C:/pet folder/hooks.js"')
    for (const path of ['C:\\%PET_HOME%\\hooks.js', 'C:\\!PET_HOME!\\hooks.js', 'bad"path', 'bad\npath', 'bad\rpath']) {
      expect(() => createHookCommand(path, 'C:\\pet\\hooks.js')).toThrow(/unsupported/i)
      expect(() => createHookCommand('C:\\node.exe', path)).toThrow(/unsupported/i)
    }
  })

  it('preserves user fields and hook groups, updates only marked entries, and is idempotent', () => {
    const own = { type: 'command', command: 'old', statusMessage: HOOK_MARKER }
    const existing = JSON.stringify({
      description: 'keep me', custom: { setting: 4 },
      hooks: {
        Stop: [{ matcher: 'custom', hooks: [{ type: 'command', command: 'user-command' }] }, { hooks: [own] }],
        PreCompact: [{ hooks: [{ type: 'command', command: 'another-command' }] }],
      },
    })
    const merged = mergeHooksConfig(existing, 'node "C:\\pet folder\\hooks.js"')
    const parsed = JSON.parse(merged)
    expect(parsed.description).toBe('keep me')
    expect(parsed.custom).toEqual({ setting: 4 })
    expect(parsed.hooks.PreCompact).toEqual(JSON.parse(existing).hooks.PreCompact)
    expect(parsed.hooks.Stop[0]).toEqual(JSON.parse(existing).hooks.Stop[0])
    expect(parsed.hooks.Stop[1].hooks[0]).toMatchObject({ command: 'node "C:\\pet folder\\hooks.js"', async: true, timeout: 1 })
    expect(parsed.hooks.SessionEnd[0].hooks[0]).toMatchObject({ async: false, timeout: 1 })
    expect(mergeHooksConfig(merged, 'node "C:\\pet folder\\hooks.js"')).toBe(merged)
  })

  it('rejects malformed input without producing a replacement config', () => {
    for (const input of ['bad', '[]', '{"hooks":[]}', '{"hooks":{"Stop":4}}']) {
      expect(() => mergeHooksConfig(input, 'node hooks.js')).toThrow()
    }
  })
})
