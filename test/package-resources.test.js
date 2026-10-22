import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

test('plugin icon is publicly resolvable and included in the published package', async () => {
  // DSH discovers package-root artwork through the ./icon export without activation.
  const iconUrl = new URL(import.meta.resolve('dsh-agent-plugin-market/icon'))
  const packageUrl = new URL('../', import.meta.url)
  assert.ok(fileURLToPath(iconUrl).startsWith(fileURLToPath(packageUrl)), 'icon stays inside the package')
  const iconPath = iconUrl.href.slice(packageUrl.href.length)
  assert.ok(manifest.files.includes(iconPath), 'publish the exported artwork, not just the local copy')

  const icon = await readFile(iconUrl)
  assert.ok(icon.byteLength > 0 && icon.byteLength <= 256 * 1024, 'DSH accepts icons up to 256 KiB')
  assert.match(icon.toString('utf8'), /<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(icon.toString('utf8'), /\bviewBox="0 0 \d+ \d+"/)
})
