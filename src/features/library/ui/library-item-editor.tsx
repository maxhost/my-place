'use client'

import { useEffect } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { EmbedNodeExtension } from './embed-node/extension'
import { EmbedToolbar } from './embed-toolbar'

// Tipo loose — la validación estructural ocurre en el server Zod
// (`richTextDocumentSchema`). TipTap espera `JSONContent` pero su shape
// recursivo + duplicación de prosemirror-model en node_modules globales
// rompe el match estricto.
type RichTextDoc = { type: 'doc'; content?: unknown[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] } as any

type Props = {
  content: RichTextDoc | null
  onChange: (doc: RichTextDoc) => void
  ariaLabel?: string
}

/**
 * Editor TipTap del item de biblioteca (R.7.8). Mismo motor que el
 * editor de discusiones (StarterKit + Link) + el `EmbedNodeExtension`
 * que permite intercalar videos/docs/links como bloques atómicos en
 * el cuerpo. La toolbar arriba ofrece formato básico + botón
 * "Insertar contenido" que abre el modal del embed.
 *
 * Mention NO se incluye acá v1 — el dueño curado de un item rara
 * vez @menciona miembros como en una discusión. Se puede sumar en
 * R.7.X+ si producto pide.
 *
 * Server re-valida via `richTextDocumentSchema` (extendido con
 * embed node en R.7.7), así que cualquier nodo fuera de la
 * allowlist se rechaza.
 */
export function LibraryItemEditor({
  content,
  onChange,
  ariaLabel = 'Escribir el contenido del recurso',
}: Props): React.ReactNode {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        horizontalRule: false,
        strike: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        protocols: ['https', 'mailto'],
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      // Cast por incompatibilidad de tipos cuando hay duplicación de
      // @tiptap/core en node_modules globales vs proyecto. Runtime OK.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      EmbedNodeExtension as any,
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content: (content ?? EMPTY_DOC) as any,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        class:
          'prose-place min-h-[14rem] w-full max-w-none rounded border border-border bg-surface p-3 text-text focus:border-bg focus:outline-none',
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getJSON() as RichTextDoc)
    },
  })

  // Sincroniza `content` externo (reset post-submit, edición con initial).
  useEffect(() => {
    if (!editor) return
    const current = editor.getJSON() as RichTextDoc
    const next = content ?? EMPTY_DOC
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      // Cast amplio por incompatibilidad TipTap JSONContent vs RichTextDoc
      // bajo prosemirror-model duplicado.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor.commands.setContent(next as any, { emitUpdate: false })
    }
  }, [editor, content])

  return (
    <div className="flex flex-col gap-2">
      {editor ? <Toolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor }): React.ReactNode {
  return (
    <div
      role="toolbar"
      aria-label="Formato"
      className="flex flex-wrap items-center gap-1 overflow-x-auto rounded border border-border bg-surface p-1"
    >
      <ToolbarButton
        label="Negrita"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <span className="font-bold">B</span>
      </ToolbarButton>
      <ToolbarButton
        label="Itálica"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <span className="italic">I</span>
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        label="Título nivel 2"
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        label="Título nivel 3"
        active={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        label="Lista con viñetas"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        • ul
      </ToolbarButton>
      <ToolbarButton
        label="Lista numerada"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1. ol
      </ToolbarButton>
      <ToolbarButton
        label="Cita"
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        ❝
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        label="Agregar enlace"
        onClick={() => {
          const previous = editor.getAttributes('link').href as string | undefined
          const input = window.prompt('Pegá el enlace (https:// o mailto:)', previous ?? '')
          if (input === null) return
          const trimmed = input.trim()
          if (trimmed === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run()
            return
          }
          try {
            const url = new URL(trimmed)
            if (url.protocol !== 'https:' && url.protocol !== 'mailto:') return
            editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
          } catch {
            // URL inválida — no-op.
          }
        }}
      >
        enlace
      </ToolbarButton>
      <Divider />
      <EmbedToolbar editor={editor} />
    </div>
  )
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded px-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-bg ${
        active ? 'bg-accent text-bg' : 'hover:bg-accent/30 text-muted'
      }`}
    >
      {children}
    </button>
  )
}

function Divider(): React.ReactNode {
  return <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-border" />
}
