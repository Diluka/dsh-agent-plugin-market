/// <reference path="../types/host.d.ts" />

export const WORKSPACE_CONFIG_VERSION = 1

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function copyRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
}

/**
 * @param {unknown} value
 * @returns {Record<string, boolean>}
 */
function copyBooleanRecord(value) {
  /** @type {Record<string, boolean>} */
  const result = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const [key, enabled] of Object.entries(value)) {
    if (typeof enabled === 'boolean') result[key] = enabled
  }
  return result
}

/**
 * @param {unknown} config
 * @returns {MarketConfig}
 */
function copyConfig(config) {
  const source = config && typeof config === 'object'
    ? /** @type {Record<string, unknown>} */ (config)
    : {}
  return /** @type {MarketConfig} */ ({
    ...source,
    markets: Array.isArray(source.markets) ? [...source.markets] : [],
    installed: copyRecord(source.installed),
    disabledSkills: copyRecord(source.disabledSkills),
    enabledStandaloneSkills: copyRecord(source.enabledStandaloneSkills),
    hookApprovals: copyRecord(source.hookApprovals),
  })
}

/** @returns {WorkspaceConfig} */
export function emptyWorkspaceConfig() {
  return { version: WORKSPACE_CONFIG_VERSION, pluginSkills: {}, standaloneSkills: {} }
}

/**
 * Workspace files contain only sparse boolean overrides. Unknown fields are
 * intentionally ignored so a future schema cannot affect current activation.
 *
 * @param {unknown} config
 * @returns {WorkspaceConfig}
 */
export function normalizeWorkspaceConfig(config) {
  const source = config && typeof config === 'object' && !Array.isArray(config)
    ? /** @type {Record<string, unknown>} */ (config)
    : {}
  return {
    version: WORKSPACE_CONFIG_VERSION,
    pluginSkills: copyBooleanRecord(source.pluginSkills),
    standaloneSkills: copyBooleanRecord(source.standaloneSkills),
  }
}

/**
 * @param {WorkspaceConfig | null | undefined} config
 * @param {WorkspaceOverrideGroup} group
 * @param {string} key
 * @returns {boolean | undefined}
 */
export function workspaceOverride(config, group, key) {
  if (!config || !Object.prototype.hasOwnProperty.call(config[group], key)) return undefined
  return config[group][key]
}

/**
 * @param {MarketConfig} config
 * @param {WorkspaceConfig | null | undefined} workspace
 * @param {string} pluginKey
 * @param {string} fullName
 */
export function pluginSkillEnabled(config, workspace, pluginKey, fullName) {
  const override = workspaceOverride(workspace, 'pluginSkills', fullName)
  if (override !== undefined) return override
  if (!config.installed[pluginKey]) return false
  return !config.disabledSkills[fullName]
}

/**
 * @param {MarketConfig} config
 * @param {WorkspaceConfig | null | undefined} workspace
 * @param {string} fullName
 */
export function standaloneSkillEnabled(config, workspace, fullName) {
  const override = workspaceOverride(workspace, 'standaloneSkills', fullName)
  return override === undefined ? !!config.enabledStandaloneSkills[fullName] : override
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} prefix
 */
function clearPrefixedKeys(record, prefix) {
  for (const key of Object.keys(record)) {
    if (key.startsWith(prefix)) delete record[key]
  }
}

/**
 * Plugin names may contain slashes, but valid skill names cannot. The final
 * separator identifies the exact owner; a prefix would also match plugin p/q
 * when clearing plugin p.
 *
 * @param {Record<string, unknown>} record
 * @param {string} pluginKey
 */
function clearPluginSkillKeys(record, pluginKey) {
  for (const fullName of Object.keys(record)) {
    if (fullName.slice(0, fullName.lastIndexOf('/')) === pluginKey) delete record[fullName]
  }
}

/**
 * @param {unknown} config
 * @param {MarketEntry} market
 */
export function addMarketToConfig(config, market) {
  const next = copyConfig(config)
  next.markets.push(market)
  return next
}

/**
 * @param {unknown} config
 * @param {string} marketId
 */
export function removeMarketFromConfig(config, marketId) {
  const next = copyConfig(config)
  const prefix = marketId + '/'
  next.markets = next.markets.filter((market) => !market || market.id !== marketId)
  for (const key of Object.keys(next.installed)) {
    if (next.installed[key] && next.installed[key].marketId === marketId) delete next.installed[key]
  }
  clearPrefixedKeys(next.disabledSkills, prefix)
  clearPrefixedKeys(next.enabledStandaloneSkills, prefix)
  clearPrefixedKeys(next.hookApprovals, prefix)
  return next
}

/**
 * @param {unknown} config
 * @param {{marketId: string, refType: MarketInputRefType, ref?: string | null, name?: string}} change
 */
export function setMarketRefInConfig(config, { marketId, refType, ref, name }) {
  const next = copyConfig(config)
  next.markets = next.markets.map((market) => {
    if (!market || market.id !== marketId) return market
    const updated = { ...market }
    if (typeof name === 'string' && name.trim()) updated.name = name.trim()
    if (refType === 'default') {
      delete updated.refType
      delete updated.ref
    } else {
      updated.refType = refType
      updated.ref = String(ref || '').trim()
    }
    return updated
  })
  return next
}

/**
 * @param {unknown} config
 * @param {string} key
 * @param {InstalledPlugin} installed
 */
export function installPluginInConfig(config, key, installed) {
  const next = copyConfig(config)
  if (!next.installed[key]) next.installed[key] = installed
  return next
}

/**
 * @param {unknown} config
 * @param {string} key
 */
export function uninstallPluginFromConfig(config, key) {
  const next = copyConfig(config)
  delete next.installed[key]
  delete next.hookApprovals[key]
  clearPluginSkillKeys(next.disabledSkills, key)
  return next
}

/**
 * @param {unknown} config
 * @param {{fullName: string, enabled: boolean, standalone: boolean}} change
 */
export function setSkillEnabledInConfig(config, { fullName, enabled, standalone }) {
  const next = copyConfig(config)
  const target = standalone ? next.enabledStandaloneSkills : next.disabledSkills
  if (standalone ? enabled : !enabled) target[fullName] = true
  else delete target[fullName]
  return next
}

/**
 * @param {unknown} config
 * @param {readonly {fullName?: unknown}[] | unknown} skills
 * @param {boolean} enabled
 * @param {boolean} standalone
 */
function setSkillsEnabledInConfig(config, skills, enabled, standalone) {
  const next = copyConfig(config)
  const target = standalone ? next.enabledStandaloneSkills : next.disabledSkills
  for (const skill of Array.isArray(skills) ? skills : []) {
    if (!skill || typeof skill.fullName !== 'string' || !skill.fullName) continue
    if (standalone ? enabled : !enabled) target[skill.fullName] = true
    else delete target[skill.fullName]
  }
  return next
}

/**
 * @param {unknown} config
 * @param {readonly {fullName?: unknown}[] | unknown} skills
 * @param {boolean} enabled
 */
export function setPluginSkillsEnabledInConfig(config, skills, enabled) {
  return setSkillsEnabledInConfig(config, skills, enabled, false)
}

/**
 * @param {unknown} config
 * @param {readonly {fullName?: unknown}[] | unknown} skills
 * @param {boolean} enabled
 */
export function setStandaloneSkillsEnabledInConfig(config, skills, enabled) {
  return setSkillsEnabledInConfig(config, skills, enabled, true)
}

/**
 * Clear every workspace skill override belonging to one plugin.
 *
 * @param {unknown} workspace
 * @param {string} key
 * @returns {WorkspaceConfig}
 */
export function clearPluginSkillOverrides(workspace, key) {
  const next = normalizeWorkspaceConfig(workspace)
  clearPluginSkillKeys(next.pluginSkills, key)
  return next
}

/**
 * Serialize a complete, validated plugin group's desired effective states.
 * Equal-to-global values inherit.
 *
 * @param {MarketConfig} config
 * @param {WorkspaceConfig} workspace
 * @param {string} key
 * @param {readonly {fullName: string, enabled: boolean}[]} skills
 */
export function setWorkspacePluginSkillStatesInConfig(config, workspace, key, skills) {
  const next = clearPluginSkillOverrides(workspace, key)
  for (const { fullName, enabled } of skills) {
    if (enabled !== pluginSkillEnabled(config, null, key, fullName)) next.pluginSkills[fullName] = enabled
  }
  return next
}

/**
 * @param {unknown} config
 * @param {WorkspaceOverrideGroup} group
 * @param {string} key
 * @param {WorkspaceOverrideMode} mode
 */
function setWorkspaceOverride(config, group, key, mode) {
  const next = normalizeWorkspaceConfig(config)
  if (mode === 'inherit') delete next[group][key]
  else next[group][key] = mode === 'enabled'
  return next
}

/**
 * @param {unknown} config
 * @param {string} fullName
 * @param {WorkspaceOverrideMode} mode
 */
export function setWorkspacePluginSkillOverride(config, fullName, mode) {
  return setWorkspaceOverride(config, 'pluginSkills', fullName, mode)
}

/**
 * @param {unknown} config
 * @param {string} fullName
 * @param {WorkspaceOverrideMode} mode
 */
export function setWorkspaceStandaloneSkillOverride(config, fullName, mode) {
  return setWorkspaceOverride(config, 'standaloneSkills', fullName, mode)
}

/** @param {WorkspaceConfig | null | undefined} config */
export function workspaceOverrideCount(config) {
  if (!config) return 0
  return Object.keys(config.pluginSkills).length + Object.keys(config.standaloneSkills).length
}
