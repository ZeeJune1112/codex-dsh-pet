import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { defaultHostScript } from '../lib/hooks.js'

assert.equal(defaultHostScript(), resolve('lib/standalone.js'))

const root = mkdtempSync(join(tmpdir(), 'pet-hook-verify-'))
function run(args, input, diagnostics = '') {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ['lib/hooks.js', ...args], { windowsHide: true, stdio: 'pipe',
      env: { ...process.env, LOCALAPPDATA: root, CODEX_PET_DIAGNOSTICS: diagnostics } })
    let stdout = '', stderr = ''
    // Process startup is OS scheduled; the wrapper's own deadline begins after JS startup.
    const guard = setTimeout(() => { child.kill(); reject(new Error('hook process did not exit')) }, 5000)
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', code => {
      clearTimeout(guard)
      resolveRun({ code, stdout, stderr })
    })
    if (input !== undefined) child.stdin.end(input)
  })
}

try {
  const target = join(root, 'hooks.json')
  const generated = await run(['--generate-config', target], '')
  assert.equal(generated.code, 0)
  assert.equal(existsSync(target), false)
  assert.equal(JSON.parse(generated.stdout).hooks.SessionEnd[0].hooks[0].async, false)
  for (const input of ['not JSON', '{"hook_event_name":"Stop"}', undefined]) {
    const result = await run([], input)
    assert.equal(result.code, 0)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, '')
  }
  const log = join(root, 'codex-dsh-pet', 'diagnostics.jsonl')
  assert.equal(existsSync(log), false)
  const diagnostic = await run([], 'private invalid payload', '1')
  assert.deepEqual(diagnostic, { code: 0, stdout: '', stderr: '' })
  assert.deepEqual(JSON.parse(readFileSync(log, 'utf8')), { errorCode: 'INVALID_INPUT' })
  console.log('Built hook config, host path, silent failures, stalled stdin, and opt-in diagnostics verified (isolated data; no activation).')
} finally {
  assert(resolve(root).startsWith(resolve(tmpdir()) + sep))
  rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 })
}
