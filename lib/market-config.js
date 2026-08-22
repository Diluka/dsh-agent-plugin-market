/**
 * @typedef {{id: string, name?: string, repo?: string, addedAt?: number, refType?: 'branch' | 'tag' | 'commit', ref?: string}} MarketEntry
 * @typedef {{marketId: string, pluginName: string, installedAt?: number}} InstalledPlugin
 * @typedef {{fingerprint: string, approvedAt?: number}} HookApproval
 * @typedef {{fullName: string}} SkillReference
 * @typedef {{fullName: string, enabled: boolean, standalone: boolean}} SkillEnabledChange
 * @typedef {{
 *   [key: string]: unknown,
 *   markets: MarketEntry[],
 *   installed: Record<string, InstalledPlugin>,
 *   disabledSkills: Record<string, boolean>,
 *   enabledStandaloneSkills: Record<string, boolean>,
 *   hookApprovals: Record<string, HookApproval>
 * }} MarketConfig
 */

function copyRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
}

function copyConfig(config) {
  const source = config && typeof config === 'object' ? config : {}
  return {
    ...source,
    markets: Array.isArray(source.markets) ? [...source.markets] : [],
    installed: copyRecord(source.installed),
    disabledSkills: copyRecord(source.disabledSkills),
    enabledStandaloneSkills: copyRecord(source.enabledStandaloneSkills),
    hookApprovals: copyRecord(source.hookApprovals),
  }
}

function clearPrefixedKeys(record, prefix) {
  for (const key of Object.keys(record)) {
    if (key.startsWith(prefix)) delete record[key]
  }
}

/**
 * Returns a config copy containing the supplied market.
 *
 * @param {MarketConfig} config
 * @param {MarketEntry} market
 * @returns {MarketConfig}
 */
export function addMarketToConfig(config, market) {
  const next = copyConfig(config)
  next.markets.push(market)
  return next
}

/**
 * Removes one market and all of its persisted state from a config copy.
 *
 * @param {MarketConfig} config
 * @param {string} marketId
 * @returns {MarketConfig}
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
 * Adds an installation when the plugin key is not already installed.
 *
 * @param {MarketConfig} config
 * @param {string} key
 * @param {InstalledPlugin} installed
 * @returns {MarketConfig}
 */
export function installPluginInConfig(config, key, installed) {
  const next = copyConfig(config)
  if (!next.installed[key]) next.installed[key] = installed
  return next
}

/**
 * Removes one plugin installation, its approval, and disabled skill entries.
 *
 * @param {MarketConfig} config
 * @param {string} key
 * @returns {MarketConfig}
 */
export function uninstallPluginFromConfig(config, key) {
  const next = copyConfig(config)
  delete next.installed[key]
  delete next.hookApprovals[key]
  clearPrefixedKeys(next.disabledSkills, key + '/')
  return next
}

/**
 * Applies one plugin or standalone skill enablement change to a config copy.
 *
 * @param {MarketConfig} config
 * @param {SkillEnabledChange} change
 * @returns {MarketConfig}
 */
export function setSkillEnabledInConfig(config, { fullName, enabled, standalone }) {
  const next = copyConfig(config)
  const target = standalone ? next.enabledStandaloneSkills : next.disabledSkills
  if (standalone ? enabled : !enabled) target[fullName] = true
  else delete target[fullName]
  return next
}

/**
 * Applies one enablement value to the supplied standalone skills.
 *
 * @param {MarketConfig} config
 * @param {SkillReference[]} skills
 * @param {boolean} enabled
 * @returns {MarketConfig}
 */
export function setStandaloneSkillsEnabledInConfig(config, skills, enabled) {
  const next = copyConfig(config)
  for (const skill of Array.isArray(skills) ? skills : []) {
    if (!skill || typeof skill.fullName !== 'string' || !skill.fullName) continue
    if (enabled) next.enabledStandaloneSkills[skill.fullName] = true
    else delete next.enabledStandaloneSkills[skill.fullName]
  }
  return next
}
