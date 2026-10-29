import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const { version } = JSON.parse(await readFile('package.json', 'utf8'))
await mkdir('build', { recursive: true })
const file = `build/bubble-plugin-${version}.zip`
// Only Bubble's export goes in the handoff, never the checkout or its environment.
const entries = [
  'actions',
  'elements',
  'api',
  'html_headers.html',
  'meta_data.json',
  'shared_tech_params.json',
]
// Remove an earlier archive through unlink so zip cannot retain stale entries.
const { unlink } = await import('node:fs/promises')
await unlink(file).catch((error) => {
  if (error.code !== 'ENOENT') throw error
})
execFileSync('zip', ['-qr', file, ...entries])
const sha256 = createHash('sha256')
  .update(await readFile(file))
  .digest('hex')
await writeFile(`${file}.sha256`, `${sha256}  ${file.split('/').pop()}\n`)
console.log(`Bubble candidate: ${file} (${sha256}). Install and publish using CONTRIBUTING.md.`)
