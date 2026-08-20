import { createHash } from 'node:crypto'

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isPluginRelativePath(value) {
  if (typeof value !== 'string') return false
  const path = value.trim()
  if (!path.startsWith('./') || path.length <= 2 || path.includes('\\') || path.includes('\0')) return false
  return !path.split('/').some((part) => part === '..' || part === '')
}

export function codexHookSources(manifest) {
  if (!isRecord(manifest) || !Object.prototype.hasOwnProperty.call(manifest, 'hooks')) {
    return { declared: false, sources: [{ kind: 'path', path: './hooks/hooks.json' }], errors: [] }
  }

  const entries = Array.isArray(manifest.hooks) ? manifest.hooks : [manifest.hooks]
  const sources = []
  const errors = []
  for (const entry of entries) {
    if (typeof entry === 'string') {
      const path = entry.trim()
      if (isPluginRelativePath(path)) sources.push({ kind: 'path', path })
      else errors.push('hooks path must be a plugin-root-relative path beginning with ./')
    } else if (isRecord(entry)) {
      sources.push({ kind: 'inline', config: entry })
    } else {
      errors.push('hooks entries must be paths or JSON objects')
    }
  }
  return { declared: true, sources, errors }
}

export function hookFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function hookStorageKey(value) {
  return encodeURIComponent(value).replace(/%/g, '_')
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

function hookMap(config) {
  if (!isRecord(config)) return undefined
  return isRecord(config.hooks) ? config.hooks : config
}

export function withPluginHookEnvironment(config, environment) {
  const output = JSON.parse(JSON.stringify(config))
  const hooks = hookMap(output)
  if (!hooks) return output

  const exports = [
    ['PLUGIN_ROOT', environment.pluginRoot],
    ['PLUGIN_DATA', environment.pluginData],
    ['CLAUDE_PLUGIN_ROOT', environment.pluginRoot],
    ['CLAUDE_PLUGIN_DATA', environment.pluginData],
  ].map(([key, value]) => 'export ' + key + '=' + shellQuote(value) + ';').join(' ')

  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group.hooks)) continue
      for (const hook of group.hooks) {
        if (!isRecord(hook) || (hook.type !== undefined && hook.type !== 'command') || typeof hook.command !== 'string') continue
        hook.command = exports + '\n' + hook.command
      }
    }
  }
  return output
}
