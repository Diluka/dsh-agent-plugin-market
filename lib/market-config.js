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

export function addMarketToConfig(config, market) {
  const next = copyConfig(config)
  next.markets.push(market)
  return next
}

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

export function installPluginInConfig(config, key, installed) {
  const next = copyConfig(config)
  if (!next.installed[key]) next.installed[key] = installed
  return next
}

export function uninstallPluginFromConfig(config, key) {
  const next = copyConfig(config)
  delete next.installed[key]
  delete next.hookApprovals[key]
  clearPrefixedKeys(next.disabledSkills, key + '/')
  return next
}

export function setSkillEnabledInConfig(config, { fullName, enabled, standalone }) {
  const next = copyConfig(config)
  const target = standalone ? next.enabledStandaloneSkills : next.disabledSkills
  if (standalone ? enabled : !enabled) target[fullName] = true
  else delete target[fullName]
  return next
}

export function setStandaloneSkillsEnabledInConfig(config, skills, enabled) {
  const next = copyConfig(config)
  for (const skill of Array.isArray(skills) ? skills : []) {
    if (!skill || typeof skill.fullName !== 'string' || !skill.fullName) continue
    if (enabled) next.enabledStandaloneSkills[skill.fullName] = true
    else delete next.enabledStandaloneSkills[skill.fullName]
  }
  return next
}
