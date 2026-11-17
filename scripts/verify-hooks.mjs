import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defaultHostScript } from '../lib/hooks.js'

assert.equal(defaultHostScript(), resolve('lib/standalone.js'))

function run(args, input) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ['lib/hooks.js', ...args], { windowsHide: true, stdio: 'pipe' })
    let stdout = '', stderr = ''
    const started = Date.now()
    const guard = setTimeout(() => { child.kill(); reject(new Error('hook process did not exit')) }, 3000)
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', code => {
      clearTimeout(guard)
      resolveRun({ code, stdout, stderr, elapsed: Date.now() - started })
    })
    if (input !== undefined) child.stdin.end(input)
  })
}

const target = join(mkdtempSync(join(tmpdir(), 'pet-config-')), 'hooks.json')
const generated = await run(['--generate-config', target], '')
assert.equal(generated.code, 0)
assert.equal(existsSync(target), false)
assert.equal(JSON.parse(generated.stdout).hooks.SessionEnd[0].hooks[0].async, false)
for (const input of ['not JSON', '{"hook_event_name":"Stop"}', undefined]) {
  const result = await run([], input)
  assert.equal(result.code, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
  assert.ok(result.elapsed < 2000, `hook took ${result.elapsed}ms`)
}
console.log('Built hook config, host path, silent failures, and stalled stdin verified.')
