const nativeFamilies = [
  { prefix: '@img/sharp-', licenses: ['Apache-2.0', 'LGPL-3.0-or-later', 'Apache-2.0 AND LGPL-3.0-or-later'] },
  { prefix: '@resvg/resvg-js-', licenses: ['MPL-2.0'] },
  { prefix: '@koromix/koffi-', licenses: ['MIT'] },
]

export function runtimeLicenses(licensesByGroup) {
  const packages = new Map()
  for (const [licenseKey, entries] of Object.entries(licensesByGroup)) {
    for (const entry of entries) {
      const name = entry.name
      if (!name || name === 'screenmcp' || name.startsWith('@screenmcp/')) continue
      const license = entry.license ?? licenseKey
      const family = nativeFamilies.find(candidate => name.startsWith(candidate.prefix))
      if (family && !family.licenses.includes(license))
        throw new Error(`Unattributed native license for ${name}: ${license}`)
      for (const version of entry.versions ?? []) {
        if (!version || !license) throw new Error(`Missing version/license metadata for ${name}`)
        // Platform bindings are covered by the native-family notice shared by all release targets.
        if (!family) packages.set(`${name}@${version}`, license)
      }
    }
  }
  return packages
}
