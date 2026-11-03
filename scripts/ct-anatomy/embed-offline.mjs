// Inline every case in public/ct-cases into the single-file CT Anatomy build.
// Usage: node scripts/ct-anatomy/embed-offline.mjs [case-id ...]   (default: all cases)
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const casesDir = join(root, 'public', 'ct-cases')
const outDir = join(root, 'dist-offline')
const index = JSON.parse(readFileSync(join(casesDir, 'index.json'), 'utf8'))
const want = process.argv.slice(2)
const entries = index.cases.filter((c) => !want.length || want.includes(c.id))
const embed = { index: entries, cases: {} }
for (const c of entries) {
  const meta = JSON.parse(readFileSync(join(casesDir, c.id, 'case.json'), 'utf8'))
  const files = {}
  for (const f of [meta.volume.file, meta.labels?.file].filter(Boolean)) {
    files[f] = readFileSync(join(casesDir, c.id, f)).toString('base64')
  }
  embed.cases[c.id] = { meta, files }
}
const htmlPath = join(outDir, 'ct-anatomy.html')
let html = readFileSync(htmlPath, 'utf8')
const tag = `<script>window.__CT_EMBED__=${JSON.stringify(embed).replace(/</g, '\\u003c')}</script>`
// must run before the inlined module script
html = html.replace('<script type="module"', `${tag}\n<script type="module"`)
html = html.replace(/<link rel="icon"[^>]*>/, '')
writeFileSync(htmlPath, html)
renameSync(htmlPath, join(outDir, 'ct-anatomy-offline.html'))
console.log(`dist-offline/ct-anatomy-offline.html: ${(html.length / 1e6).toFixed(1)} MB, cases: ${entries.map((c) => c.id).join(', ')}`)
