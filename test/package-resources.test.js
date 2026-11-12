import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

test('the declared DSH range excludes the incompatible Connection boundary', () => {
  assert.ok(evaluatePluginCompatibility(manifest, {}, '0.2.1-alpha.1'))
  assert.equal(evaluatePluginCompatibility(manifest, {}, '0.2.1-alpha.2'), undefined)
})

test('the declared DSH range admits future releases without an upper bound', () => {
  for (const version of ['0.2.2-rc.3', '0.3.0-alpha.1', '0.3.0', '1.0.0-beta.1', '1.0.0', '9.0.0']) {
    assert.equal(evaluatePluginCompatibility(manifest, {}, version), undefined, version)
  }
})

test('the pinned DSH development dependencies resolve to their declared versions', () => {
  const require = createRequire(import.meta.url)
  for (const name of ['@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh-home-paths', '@deepseek-ai/dsh-hooks-codex']) {
    assert.equal(require(`${name}/package.json`).version, manifest.devDependencies[name], name)
  }
})

test('the pinned optional Codex bridge imports with its development peers', async () => {
  const bridge = await import('@deepseek-ai/dsh-hooks-codex')
  assert.equal(typeof bridge.apply, 'function')
})

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
