// CI-only release-cohort pinning. DSH prerelease packages use caret ranges
// that can resolve framework companions newer than the tested bundle expects.
// DSH 0.1.7-rc.1 targets Cordis 4.0.4, Loader 1.0.5, and Include 1.0.9.
// Revalidate this baseline together with DSH_VERSION when upgrading CI.
const frameworkVersions = {
  '@deepseek-ai/cordis': '4.0.4',
  '@deepseek-ai/cordis-plugin-group': '1.0.4',
  '@deepseek-ai/cordis-plugin-hmr': '1.0.19',
  '@deepseek-ai/cordis-plugin-include': '1.0.9',
  '@deepseek-ai/cordis-plugin-loader': '1.0.5',
  '@deepseek-ai/cordis-plugin-timer': '1.1.6',
  '@deepseek-ai/cosmokit': '1.8.5',
  '@deepseek-ai/schemastery': '3.18.4',
}

module.exports = {
  hooks: {
    readPackage(pkg) {
      const version = process.env.DSH_VERSION
      if (!version) throw new Error('DSH_VERSION is required for the DSH smoke install')
      for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
        for (const name of Object.keys(pkg[field] || {})) {
          if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) {
            pkg[field][name] = version
          } else if (Object.hasOwn(frameworkVersions, name)) {
            pkg[field][name] = frameworkVersions[name]
          }
        }
      }
      return pkg
    },
  },
}
