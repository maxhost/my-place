import { describe, expect, it } from 'vitest'
import { parseYoutubeUrl } from '../parse-url'

/**
 * Tests del parser de URLs de YouTube. El parser acepta solo VIDEOS:
 * - youtube.com/watch?v=<id>
 * - youtu.be/<id>
 *
 * Rechaza shorts/playlists/channels (out of scope MVP — ver ADR
 * `docs/decisions/2026-05-06-tiptap-to-lexical.md` § "Plugins de embed").
 */
describe('parseYoutubeUrl', () => {
  it('matchea youtube.com/watch?v=<id>', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      videoId: 'dQw4w9WgXcQ',
    })
  })

  it('matchea youtube.com/watch?v=<id> con extra params', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=RD')).toEqual({
      videoId: 'dQw4w9WgXcQ',
    })
  })

  it('matchea youtu.be/<id>', () => {
    expect(parseYoutubeUrl('https://youtu.be/dQw4w9WgXcQ')).toEqual({ videoId: 'dQw4w9WgXcQ' })
  })

  it('matchea youtu.be/<id>?t=42', () => {
    expect(parseYoutubeUrl('https://youtu.be/dQw4w9WgXcQ?t=42')).toEqual({
      videoId: 'dQw4w9WgXcQ',
    })
  })

  it('rechaza URLs sin protocolo', () => {
    expect(parseYoutubeUrl('youtube.com/watch?v=abc')).toBeNull()
  })

  it('rechaza dominio que no es youtube', () => {
    expect(parseYoutubeUrl('https://vimeo.com/12345')).toBeNull()
  })

  it('rechaza watch sin v= param', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/watch?list=RD')).toBeNull()
  })

  it('rechaza string vacío', () => {
    expect(parseYoutubeUrl('')).toBeNull()
  })

  it('rechaza URLs malformadas', () => {
    expect(parseYoutubeUrl('not a url')).toBeNull()
  })

  it('rechaza shorts (out of scope MVP)', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/shorts/abc123')).toBeNull()
  })
})
