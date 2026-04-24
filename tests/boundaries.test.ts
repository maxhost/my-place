import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Safety net del aislamiento entre features y capas.
 *
 * Parsea estáticamente los imports de `src/` y valida:
 * 1. Ninguna feature importa archivos internos de otra (solo `public.ts`).
 * 2. `shared/` no importa de `features/`.
 *
 * Complementa la regla ESLint — si alguien bypassa ESLint, el test falla el build.
 * Ver `docs/architecture.md` § "Reglas de aislamiento entre módulos".
 */

const SRC_ROOT = join(__dirname, '..', 'src')
const IMPORT_REGEX = /from\s+['"]([^'"]+)['"]/g

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walk(full))
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

function importsOf(file: string): string[] {
  const content = readFileSync(file, 'utf8')
  const imports: string[] = []
  let match: RegExpExecArray | null
  while ((match = IMPORT_REGEX.exec(content)) !== null) {
    const path = match[1]
    if (path !== undefined) imports.push(path)
  }
  return imports
}

describe('boundaries entre capas (docs/architecture.md)', () => {
  const files = walk(SRC_ROOT)

  it('ningún archivo fuera de una feature importa internals de una feature (solo public.ts)', () => {
    const violations: string[] = []
    for (const file of files) {
      const rel = relative(SRC_ROOT, file)
      // Las features pueden importar de sus propios internals, skip.
      const inFeatureMatch = rel.match(/^features\/([^/]+)\//)
      const ownFeature = inFeatureMatch?.[1]

      for (const imp of importsOf(file)) {
        const m = imp.match(/^@\/features\/([^/]+)\/(.+)$/)
        if (!m) continue
        const [, feature, rest] = m
        if (feature === ownFeature) continue
        if (
          rest === 'public' ||
          rest === 'public.ts' ||
          rest === 'public.server' ||
          rest === 'public.server.ts'
        ) {
          continue
        }
        violations.push(`${rel} → @/features/${feature}/${rest}`)
      }
    }
    expect(violations, `violaciones:\n${violations.join('\n')}`).toEqual([])
  })

  it('shared/ no importa de features/', () => {
    const violations: string[] = []
    for (const file of files) {
      const rel = relative(SRC_ROOT, file)
      if (!rel.startsWith('shared/')) continue
      for (const imp of importsOf(file)) {
        if (imp.startsWith('@/features/')) {
          violations.push(`${rel} → ${imp}`)
        }
      }
    }
    expect(violations, `violaciones:\n${violations.join('\n')}`).toEqual([])
  })

  it('ningún archivo de una feature importa OTRA feature vía path relativo profundo (bypass de alias)', () => {
    // El check anterior sólo matchea `@/features/X/Y`. Un import tipo
    // `../../features/X/public` (relativo profundo que sale del slice y
    // vuelve a entrar) bypasea el alias pero viola el boundary. Este
    // regex caza ≥2 niveles hacia arriba aterrizando en `features/`:
    // desde `src/features/<X>/**`, cualquier `../../features/...` cae
    // necesariamente en OTRO slice o en `src/features/` (ambos violan).
    const RELATIVE_CROSS_REGEX = /^(?:\.\.\/){2,}features\//
    const violations: string[] = []
    for (const file of files) {
      const rel = relative(SRC_ROOT, file)
      if (!rel.startsWith('features/')) continue
      for (const imp of importsOf(file)) {
        if (RELATIVE_CROSS_REGEX.test(imp)) {
          violations.push(`${rel} → ${imp}`)
        }
      }
    }
    expect(violations, `violaciones:\n${violations.join('\n')}`).toEqual([])
  })
})
