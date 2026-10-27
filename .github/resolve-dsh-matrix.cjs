// Resolve one CI smoke target per distinct DSH version: the declared range
// minimum plus the npm `latest` and `next` channels. The CI preflight enforces
// the declared range, so versions outside it fail the smoke job instead.
const { appendFileSync, readFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function isVersion(version) {
  if (typeof version !== 'string' || version.length > 256) return false
  const match = versionPattern.exec(version)
  return !!match && match.slice(1, 4).every((part) => Number.isSafeInteger(Number(part)))
    && !(match[4] || '').split('.').some((part) => /^0\d+$/.test(part))
}

function buildTargets(range, tags) {
  const bounds = typeof range === 'string' && /^>=(\S+)\s+<=\S+$/.exec(range.trim())
  if (!bounds) throw new Error('engines.dsh must be one bounded inclusive range')
  const candidates = [
    { label: 'minimum', version: bounds[1] },
    { label: 'latest', version: tags?.latest },
    { label: 'next', version: tags?.next },
  ]
  for (const { label, version } of candidates) {
    if (!isVersion(version)) {
      throw new Error(`invalid DSH ${label} version: ${String(version)}`)
    }
  }

  const seen = new Set()
  const targets = []
  for (const { label, version } of candidates) {
    if (seen.has(version)) continue
    seen.add(version)
    targets.push({ label, version })
  }
  return targets
}

if (require.main === module) {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
  const tags = JSON.parse(execFileSync('npm', ['view', '@deepseek-ai/dsh', 'dist-tags', '--json', '--prefer-online'], { encoding: 'utf8' }))
  const targets = buildTargets(manifest.engines?.dsh, tags)
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required')
  appendFileSync(process.env.GITHUB_OUTPUT, `targets=${JSON.stringify(targets)}\n`)
  console.log('DSH smoke targets:', targets)
}

module.exports = { buildTargets }
