import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Invariante 20 (`docs/features/discussions/spec.md § 8`):
 *
 * > `Post.lastActivityAt` sólo lo bumpean `createPostAction` y `createCommentAction`.
 * > Ninguna otra acción (reactions, flags, moderación hide/unhide, edits, reads,
 * > soft-delete) lo toca.
 *
 * Romperlo degrada el dot indicator de §13 a ruido. Este test es un "lint declarativo":
 * escanea cada archivo de `server/actions/` y asegura que `lastActivityAt` sólo
 * aparezca como escritura en los 2 actions permitidos.
 *
 * Ubicado como test (no como eslint rule) porque es una regla semántica del dominio,
 * no una convención de código — su vida está atada al contrato del dot, no al estilo.
 */

const ACTIONS_DIR = join(__dirname, '..', 'server', 'actions')

// `lastActivityAt:` (en un data/update object) o `lastActivityAt =` (asignación directa).
// No matchea comentarios `// ...lastActivityAt...` ni strings literales.
const WRITE_PATTERN = /(?<!\/\/[^\n]*)\blastActivityAt\s*[:=](?!=)/g

type WriteSite = { file: string; line: number; snippet: string }

function findWriteSites(filePath: string, relPath: string): WriteSite[] {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const sites: WriteSite[] = []

  lines.forEach((line, idx) => {
    // Saltear líneas que son comentarios de línea completa
    if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) return
    if (WRITE_PATTERN.test(line)) {
      sites.push({ file: relPath, line: idx + 1, snippet: line.trim() })
    }
    // Reset regex state (flag /g mantiene lastIndex entre llamadas)
    WRITE_PATTERN.lastIndex = 0
  })

  return sites
}

function scanActionsDir(): WriteSite[] {
  const files = readdirSync(ACTIONS_DIR).filter((f) => f.endsWith('.ts'))
  return files.flatMap((f) =>
    findWriteSites(join(ACTIONS_DIR, f), relative(process.cwd(), join(ACTIONS_DIR, f))),
  )
}

describe('invariante 20: lastActivityAt sólo se bumpea en createPost y createComment', () => {
  it('ninguna action fuera de createPost/createComment escribe `lastActivityAt`', () => {
    const sites = scanActionsDir()
    const offenders = sites.filter(
      (s) => !s.file.endsWith('posts.ts') && !s.file.endsWith('comments.ts'),
    )

    expect(
      offenders,
      `Estas actions escriben \`lastActivityAt\` en violación del invariante 20:\n${offenders
        .map((o) => `  ${o.file}:${o.line}  →  ${o.snippet}`)
        .join(
          '\n',
        )}\nVer docs/features/discussions/spec.md § 8 invariante 20 + § 13 "Contrato binario del dot".`,
    ).toEqual([])
  })

  it('posts.ts escribe `lastActivityAt` sólo dentro de createPostAction (no en edit/hide/unhide/delete)', () => {
    const filePath = join(ACTIONS_DIR, 'posts.ts')
    const content = readFileSync(filePath, 'utf-8')

    // Encontrar el bloque createPostAction (entre su firma y la siguiente `export async function`)
    const createStart = content.indexOf('export async function createPostAction')
    expect(createStart, 'createPostAction debe existir').toBeGreaterThan(-1)
    const nextExport = content.indexOf('export async function', createStart + 1)
    const createBlock =
      nextExport === -1 ? content.slice(createStart) : content.slice(createStart, nextExport)
    const outsideBlock =
      (nextExport === -1 ? '' : content.slice(nextExport)) + content.slice(0, createStart)

    expect(
      createBlock.match(/\blastActivityAt\b/g)?.length ?? 0,
      'createPostAction debe bumpear lastActivityAt al menos una vez',
    ).toBeGreaterThanOrEqual(1)

    expect(
      outsideBlock.match(/\blastActivityAt\s*[:=](?!=)/g) ?? [],
      'Ninguna otra action en posts.ts (edit/hide/unhide/delete) debe escribir lastActivityAt',
    ).toEqual([])
  })

  it('comments.ts escribe `lastActivityAt` sólo dentro de createCommentAction (no en edit/delete)', () => {
    const filePath = join(ACTIONS_DIR, 'comments.ts')
    const content = readFileSync(filePath, 'utf-8')

    const createStart = content.indexOf('export async function createCommentAction')
    expect(createStart, 'createCommentAction debe existir').toBeGreaterThan(-1)
    const nextExport = content.indexOf('export async function', createStart + 1)
    const createBlock =
      nextExport === -1 ? content.slice(createStart) : content.slice(createStart, nextExport)
    const outsideBlock =
      (nextExport === -1 ? '' : content.slice(nextExport)) + content.slice(0, createStart)

    expect(
      createBlock.match(/\blastActivityAt\b/g)?.length ?? 0,
      'createCommentAction debe bumpear lastActivityAt al menos una vez',
    ).toBeGreaterThanOrEqual(1)

    expect(
      outsideBlock.match(/\blastActivityAt\s*[:=](?!=)/g) ?? [],
      'Ninguna otra action en comments.ts (edit/delete) debe escribir lastActivityAt',
    ).toEqual([])
  })
})
