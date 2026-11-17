import { readFile } from 'node:fs/promises'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const expected = `id: ${JSON.stringify(pkg.name)}`

if (!bundle.includes(expected)) {
  throw new Error(`Client bundle must register ${pkg.name} via __ModuleLoader__.load`)
}

console.log(`Client registration verified: ${pkg.name}`)
