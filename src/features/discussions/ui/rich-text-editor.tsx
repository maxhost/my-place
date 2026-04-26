'use client'

import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Mention from '@tiptap/extension-mention'
import { useEffect } from 'react'
import type { RichTextDocument } from '../domain/types'

/**
 * Editor TipTap filtrado a la allowlist de `docs/features/discussions/spec.md § 14`:
 *   paragraph, heading (2,3), bulletList, orderedList, listItem, blockquote,
 *   codeBlock, inline code, bold, italic, link (https/mailto, target=_blank),
 *   mention (read-only en C.E — sin picker).
 *
 * Nodos/marks fuera de la allowlist (horizontalRule, strike, etc.) se desactivan
 * en `StarterKit.configure`. El server re-valida con Zod, así que cualquier
 * nodo que se cuele igual lo rechaza.
 */

const EMPTY_DOC: RichTextDocument = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

type Props = {
  content: RichTextDocument | null
  onChange: (doc: RichTextDocument) => void
  ariaLabel?: string
  minHeightClassName?: string
}

export function RichTextEditor({
  content,
  onChange,
  ariaLabel = 'Escribir texto',
  minHeightClassName = 'min-h-[8rem]',
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
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
      Mention.configure({
        HTMLAttributes: { class: 'place-mention' },
        renderHTML: ({ options, node }) => {
          const label = (node.attrs as { label?: string; id?: string }).label ?? node.attrs.id
          return ['span', { class: options.HTMLAttributes.class ?? 'place-mention' }, `@${label}`]
        },
      }),
    ],
    content: content ?? EMPTY_DOC,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        class: `prose-place ${minHeightClassName} w-full max-w-none rounded border border-border bg-surface p-3 text-text focus:border-bg focus:outline-none`,
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getJSON() as RichTextDocument)
    },
  })

  // Sincroniza `content` externo (ej: reset post-submit, editar con initial value).
  useEffect(() => {
    if (!editor) return
    const current = editor.getJSON() as RichTextDocument
    const next = content ?? EMPTY_DOC
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      editor.commands.setContent(next, { emitUpdate: false })
    }
  }, [editor, content])

  return (
    <div className="flex flex-col gap-2">
      {editor ? <EditorToolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  )
}

function EditorToolbar({ editor }: { editor: Editor }): React.ReactNode {
  return (
    <div
      role="toolbar"
      aria-label="Formato de texto"
      className="flex flex-wrap gap-1 overflow-x-auto rounded border border-border bg-surface p-1"
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
      <ToolbarButton
        label="Código inline"
        active={editor.isActive('code')}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <span className="font-mono">{'</>'}</span>
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
      <ToolbarButton
        label="Bloque de código"
        active={editor.isActive('codeBlock')}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        code
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
            // URL inválida — no-op silencioso; copy de error se deja al submit.
          }
        }}
      >
        enlace
      </ToolbarButton>
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
