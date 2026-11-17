import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeHookEvent } from './integration/hooks'
import { sendHookEvent } from './integration/hooks-transport'
import { mergeHooksConfig } from './integration/hooks-config'
export { defaultHostScript, launchDetachedHost, sendHookEvent } from './integration/hooks-transport'

export async function runHook(): Promise<void> {
  let input = ''
  try {
    for await (const chunk of process.stdin) {
      input += chunk.toString()
      if (Buffer.byteLength(input) > 64 * 1024) return
    }
    const event = normalizeHookEvent(JSON.parse(input))
    input = ''
    if (event) await sendHookEvent(event)
  } catch { /* silent fail-open; no control or context output */ }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv[2] === '--generate-config') {
    try {
      const path = process.argv[3] ?? join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'hooks.json')
      let existing = ''
      try { existing = readFileSync(path, 'utf8') } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const command = `"${process.execPath.replaceAll('\\', '/')}" "${fileURLToPath(import.meta.url).replaceAll('\\', '/')}"`
      process.stdout.write(mergeHooksConfig(existing, command))
    } catch { console.error('Cannot generate hooks config; existing configuration was not modified.'); process.exitCode = 1 }
  } else {
    // SessionEnd is synchronous; bound even stdin and exit silently with success.
    const deadline = setTimeout(() => process.exit(0), 900)
    runHook().finally(() => { clearTimeout(deadline); process.exit(0) })
  }
}
