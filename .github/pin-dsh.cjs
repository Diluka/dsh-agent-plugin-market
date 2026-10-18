// CI-only release-cohort pinning. DSH 0.2.1-rc.2 uses exact DSH dependencies,
// but plugin wildcard peers and framework patch ranges can still drift.
// DSH 0.2.1-rc.2 targets Cordis 4.0.5, Loader 1.0.6, and Include 1.0.10.
// Revalidate this baseline together with DSH_VERSION when upgrading CI.
const frameworkVersions = {
  '@deepseek-ai/cordis': '4.0.5',
  '@deepseek-ai/cordis-plugin-group': '1.0.5',
  '@deepseek-ai/cordis-plugin-include': '1.0.10',
  '@deepseek-ai/cordis-plugin-loader': '1.0.6',
  '@deepseek-ai/cordis-plugin-timer': '1.1.7',
  '@deepseek-ai/cosmokit': '1.8.6',
  '@deepseek-ai/schemastery': '3.18.5',
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
