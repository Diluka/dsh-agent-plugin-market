/**
 * @typedef {{id: string, name?: string, repo: string, addedAt?: number, refType?: 'branch' | 'tag' | 'commit', ref?: string}} MarketEntry
 * @typedef {{marketId: string, pluginName: string, installedAt?: number}} InstalledPlugin
 * @typedef {{markets: MarketEntry[], installed: Record<string, InstalledPlugin>, disabledSkills: Record<string, boolean>, enabledStandaloneSkills: Record<string, boolean>, hookApprovals: Record<string, {fingerprint: string, approvedAt?: number}>}} MarketConfig
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function copyRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
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
  clearPrefixedKeys(next.disabledSkills, key + '/')
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
