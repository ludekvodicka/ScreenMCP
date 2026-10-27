const nativeFamilies = [
  { prefix: '@img/sharp-', licenses: ['Apache-2.0', 'LGPL-3.0-or-later', 'Apache-2.0 AND LGPL-3.0-or-later'] },
  { prefix: '@resvg/resvg-js-', licenses: ['MPL-2.0'] },
  { prefix: '@koromix/koffi-', licenses: ['MIT'] },
]

// pnpm 12 `licenses list --prod` omits transitive optionalDependencies (get-windows' node-pre-gyp
// tree) that electron-builder still packages, so the production set comes from `pnpm list --prod`.
// An aliased dependency (`wrap-ansi-cjs`) is identified by its real package name in `from`. Platform
// bindings are not descended into: their own dependencies differ by operating system.
export function productionIdentities(projects) {
  const identities = new Set()
  const visit = dependencies => {
    for (const dependency of Object.values(dependencies ?? {})) {
      identities.add(`${dependency.from}@${dependency.version}`)
      if (nativeFamilies.some(family => dependency.from.startsWith(family.prefix))) continue
      visit(dependency.dependencies)
      visit(dependency.optionalDependencies)
    }
  }
  for (const project of projects) {
    visit(project.dependencies)
    visit(project.optionalDependencies)
  }
  return identities
}

export function runtimeLicenses(licensesByGroup, production) {
  const packages = new Map()
  for (const [licenseKey, entries] of Object.entries(licensesByGroup)) {
    for (const entry of entries) {
      const name = entry.name
      if (!name || name === 'screenmcp' || name.startsWith('@screenmcp/')) continue
      const license = entry.license ?? licenseKey
      const family = nativeFamilies.find(candidate => name.startsWith(candidate.prefix))
      for (const version of entry.versions ?? []) {
        if (!production.has(`${name}@${version}`)) continue
        if (!version || !license) throw new Error(`Missing version/license metadata for ${name}`)
        if (family && !family.licenses.includes(license))
          throw new Error(`Unattributed native license for ${name}: ${license}`)
        // Platform bindings are covered by the native-family notice shared by all release targets.
        if (!family) packages.set(`${name}@${version}`, license)
      }
    }
  }
  return packages
}
