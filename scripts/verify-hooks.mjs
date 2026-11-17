import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cpSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { defaultHostScript } from '../lib/hooks.js'

assert.equal(defaultHostScript(), resolve('lib/standalone.js'))

const root = mkdtempSync(join(tmpdir(), 'pet-hook-verify-'))
function run(args, input, diagnostics = '', script = resolve('lib/hooks.js')) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, ...args], { windowsHide: true, stdio: 'pipe', cwd: root,
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
  const unsupported = join(root, '%PET_PATH%', 'lib')
  cpSync(resolve('lib'), unsupported, { recursive: true })
  const existing = '{"description":"preserve this config"}\n'
  writeFileSync(target, existing)
  const rejected = await run(['--generate-config', target], '', '', join(unsupported, 'hooks.js'))
  assert.equal(rejected.code, 1)
  assert.equal(rejected.stdout, '')
  assert.match(rejected.stderr, /Cannot generate hooks config/)
  assert.equal(readFileSync(target, 'utf8'), existing)
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
  console.log('Built hook config, unsupported path rejection, host path, silent failures, stalled stdin, and opt-in diagnostics verified (isolated data; no activation).')
} finally {
  assert(resolve(root).startsWith(resolve(tmpdir()) + sep))
  rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 })
}
