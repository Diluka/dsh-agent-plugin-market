// CI-only release-cohort pinning. Keep DSH dependencies on the tested version
// while preserving each release's published framework dependency ranges.

module.exports = {
  hooks: {
    readPackage(pkg) {
      const version = process.env.DSH_VERSION
      if (!version) throw new Error('DSH_VERSION is required for the DSH smoke install')
      for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
        for (const name of Object.keys(pkg[field] || {})) {
          if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) {
            pkg[field][name] = version
          }
        }
      }
      return pkg
    },
  },
}
