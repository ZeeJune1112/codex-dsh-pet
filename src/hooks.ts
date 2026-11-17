import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeHookEvent } from './integration/hooks'
import { sendHookEvent } from './integration/hooks-transport'
import { createHookCommand, mergeHooksConfig } from './integration/hooks-config'
import { recordDiagnostic } from './integration/diagnostics'
export { defaultHostScript, launchDetachedHost, sendHookEvent } from './integration/hooks-transport'
export { normalizeHookEvent } from './integration/hooks'

export async function runHook(): Promise<void> {
  let input = ''
  try {
    for await (const chunk of process.stdin) {
      input += chunk.toString()
      if (Buffer.byteLength(input) > 64 * 1024) { recordDiagnostic({ errorCode: 'INPUT_TOO_LARGE' }); return }
    }
    const event = normalizeHookEvent(JSON.parse(input))
    input = ''
    if (!event) recordDiagnostic({ errorCode: 'INVALID_INPUT' })
    else if (!await sendHookEvent(event)) recordDiagnostic({ event, errorCode: 'DELIVERY_UNAVAILABLE' })
  } catch { recordDiagnostic({ errorCode: 'INVALID_INPUT' }) }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv[2] === '--generate-config') {
    try {
      const path = process.argv[3] ?? join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'hooks.json')
      let existing = ''
      try { existing = readFileSync(path, 'utf8') } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const command = createHookCommand(process.execPath, fileURLToPath(import.meta.url))
      process.stdout.write(mergeHooksConfig(existing, command))
    } catch { console.error('Cannot generate hooks config; existing configuration was not modified.'); process.exitCode = 1 }
  } else {
    // SessionEnd is synchronous; bound even stdin and exit silently with success.
    const deadline = setTimeout(() => process.exit(0), 900)
    runHook().finally(() => { clearTimeout(deadline); process.exit(0) })
  }
}
