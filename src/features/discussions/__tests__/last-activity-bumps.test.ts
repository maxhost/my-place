import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Invariante 20 (`docs/features/discussions/spec.md § 8`):
 *
 * > `Post.lastActivityAt` sólo lo bumpean `createPostAction` y `createCommentAction`.
 * > Ninguna otra acción (reactions, flags, moderación hide/unhide, edits, reads,
 * > soft-delete) lo toca.
 *
 * Romperlo degrada el dot indicator de §13 a ruido. Este test es un "lint declarativo":
 * escanea cada archivo de `server/actions/**` y asegura que `lastActivityAt` sólo
 * aparezca como escritura en los archivos permitidos.
 *
 * Ubicado como test (no como eslint rule) porque es una regla semántica del dominio,
 * no una convención de código — su vida está atada al contrato del dot, no al estilo.
 */

const ACTIONS_DIR = join(__dirname, '..', 'server', 'actions')

// `lastActivityAt:` (en un data/update object) o `lastActivityAt =` (asignación directa).
// No matchea comentarios `// ...lastActivityAt...` ni strings literales.
const WRITE_PATTERN = /(?<!\/\/[^\n]*)\blastActivityAt\s*[:=](?!=)/g

type WriteSite = { file: string; line: number; snippet: string }

/**
 * Archivos donde es lícito bumpear `lastActivityAt`. Tras el split C.H.3 los
 * actions viven en subdirectorios (`posts/create.ts`, etc). Mantenemos
 * tolerancia por legacy flat files durante la transición.
 */
function isAllowedWriteFile(relPath: string): boolean {
  const n = relPath.replace(/\\/g, '/')
  return (
    n.endsWith('/posts/create.ts') ||
    n.endsWith('/posts/create-from-system.ts') ||
    n.endsWith('/comments/create.ts') ||
    n.endsWith('/posts.ts') ||
    n.endsWith('/comments.ts')
  )
}

function listActionFiles(dir: string): string[] {
  const out: string[] = []
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...listActionFiles(full))
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

function findWriteSites(filePath: string, relPath: string): WriteSite[] {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const sites: WriteSite[] = []

  lines.forEach((line, idx) => {
    if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) return
    if (WRITE_PATTERN.test(line)) {
      sites.push({ file: relPath, line: idx + 1, snippet: line.trim() })
    }
    WRITE_PATTERN.lastIndex = 0
  })

  return sites
}

describe('invariante 20: lastActivityAt sólo se bumpea en createPost y createComment', () => {
  const files = listActionFiles(ACTIONS_DIR)
  const sites = files.flatMap((f) => findWriteSites(f, relative(process.cwd(), f)))

  it('ningún archivo fuera de los allowed bumpea lastActivityAt', () => {
    const offenders = sites.filter((s) => !isAllowedWriteFile(s.file))
    expect(
      offenders,
      `Estos archivos escriben \`lastActivityAt\` en violación del invariante 20:\n${offenders
        .map((o) => `  ${o.file}:${o.line}  →  ${o.snippet}`)
        .join(
          '\n',
        )}\nVer docs/features/discussions/spec.md § 8 invariante 20 + § 13 "Contrato binario del dot".`,
    ).toEqual([])
  })

  it('posts/create.ts (o posts.ts legacy) bumpea lastActivityAt al menos una vez', () => {
    const postCreateFiles = files.filter(
      (f) => f.endsWith('/posts/create.ts') || f.endsWith('/posts.ts'),
    )
    expect(
      postCreateFiles.length,
      'debe existir al menos un archivo de create de post',
    ).toBeGreaterThan(0)
    const content = readFileSync(postCreateFiles[0]!, 'utf-8')
    expect(
      content.match(/\blastActivityAt\b/g)?.length ?? 0,
      'createPostAction debe bumpear lastActivityAt al menos una vez',
    ).toBeGreaterThanOrEqual(1)
  })

  it('comments/create.ts (o comments.ts legacy) bumpea lastActivityAt al menos una vez', () => {
    const commentCreateFiles = files.filter(
      (f) => f.endsWith('/comments/create.ts') || f.endsWith('/comments.ts'),
    )
    expect(
      commentCreateFiles.length,
      'debe existir al menos un archivo de create de comment',
    ).toBeGreaterThan(0)
    const content = readFileSync(commentCreateFiles[0]!, 'utf-8')
    expect(
      content.match(/\blastActivityAt\b/g)?.length ?? 0,
      'createCommentAction debe bumpear lastActivityAt al menos una vez',
    ).toBeGreaterThanOrEqual(1)
  })
})
