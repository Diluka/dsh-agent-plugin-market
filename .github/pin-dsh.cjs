// CI-only release-cohort pinning. DSH's published caret dependencies may
// otherwise select a newer (or only partially published) prerelease.
// Verified companions for DSH rc.2: newer loader/HMR releases changed the
// awaited activation and registerConfig contracts consumed by rc.2 app-boot.
// Revalidate this baseline together with DSH_VERSION when upgrading CI.
const frameworkVersions = {
  '@deepseek-ai/cordis': '4.0.2',
  '@deepseek-ai/cordis-plugin-group': '1.0.2',
  '@deepseek-ai/cordis-plugin-hmr': '1.0.17',
  '@deepseek-ai/cordis-plugin-include': '1.0.7',
  '@deepseek-ai/cordis-plugin-loader': '1.0.3',
  '@deepseek-ai/cordis-plugin-timer': '1.1.4',
  '@deepseek-ai/cosmokit': '1.8.3',
  '@deepseek-ai/schemastery': '3.18.2',
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
