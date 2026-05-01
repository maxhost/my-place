import { describe, expect, it } from 'vitest'
import { ValidationError } from '@/shared/errors/domain-error'
import { parseEmbedUrl } from '../domain/embed-parser'

describe('parseEmbedUrl', () => {
  describe('YouTube', () => {
    it('detecta youtu.be/<id> → embed canonical con si param', () => {
      const r = parseEmbedUrl('https://youtu.be/abc123XYZ_-')
      expect(r.provider).toBe('youtube')
      expect(r.metadata.videoId).toBe('abc123XYZ_-')
      expect(r.canonicalUrl).toMatch(
        /^https:\/\/www\.youtube\.com\/embed\/abc123XYZ_-\?si=[a-z0-9]{16}$/,
      )
    })

    it('detecta youtube.com/watch?v=<id> → embed canonical con si param', () => {
      const r = parseEmbedUrl('https://www.youtube.com/watch?v=abc123XYZ&t=10')
      expect(r.provider).toBe('youtube')
      expect(r.metadata.videoId).toBe('abc123XYZ')
      expect(r.canonicalUrl).toMatch(
        /^https:\/\/www\.youtube\.com\/embed\/abc123XYZ\?si=[a-z0-9]{16}$/,
      )
    })

    it('detecta youtube.com/shorts/<id>', () => {
      const r = parseEmbedUrl('https://www.youtube.com/shorts/abc123XYZ')
      expect(r.provider).toBe('youtube')
      expect(r.metadata.videoId).toBe('abc123XYZ')
      expect(r.canonicalUrl).toMatch(
        /^https:\/\/www\.youtube\.com\/embed\/abc123XYZ\?si=[a-z0-9]{16}$/,
      )
    })

    it('si param es determinístico para el mismo videoId', () => {
      const a = parseEmbedUrl('https://youtu.be/abc123XYZ')
      const b = parseEmbedUrl('https://www.youtube.com/watch?v=abc123XYZ')
      expect(a.canonicalUrl).toBe(b.canonicalUrl)
    })

    it('youtube.com sin v param → generic fallback', () => {
      const r = parseEmbedUrl('https://www.youtube.com/feed/library')
      expect(r.provider).toBe('generic')
    })
  })

  describe('Vimeo', () => {
    it('detecta vimeo.com/<id>', () => {
      const r = parseEmbedUrl('https://vimeo.com/123456789')
      expect(r.provider).toBe('vimeo')
      expect(r.metadata.videoId).toBe('123456789')
      expect(r.canonicalUrl).toBe('https://player.vimeo.com/video/123456789')
    })

    it('detecta player.vimeo.com/video/<id>', () => {
      const r = parseEmbedUrl('https://player.vimeo.com/video/987654321')
      expect(r.provider).toBe('vimeo')
      expect(r.metadata.videoId).toBe('987654321')
    })
  })

  describe('Google Docs / Sheets', () => {
    it('detecta docs.google.com/document/d/<id>', () => {
      const r = parseEmbedUrl('https://docs.google.com/document/d/abcDEF_-123/edit')
      expect(r.provider).toBe('gdoc')
      expect(r.metadata.documentId).toBe('abcDEF_-123')
      expect(r.canonicalUrl).toContain('/preview')
    })

    it('detecta docs.google.com/spreadsheets/d/<id>', () => {
      const r = parseEmbedUrl('https://docs.google.com/spreadsheets/d/sheetID123/edit')
      expect(r.provider).toBe('gsheet')
      expect(r.metadata.documentId).toBe('sheetID123')
    })
  })

  describe('Drive / Dropbox', () => {
    it('detecta drive.google.com', () => {
      const r = parseEmbedUrl('https://drive.google.com/file/d/abc/view')
      expect(r.provider).toBe('drive')
      expect(r.canonicalUrl).toBe('https://drive.google.com/file/d/abc/view')
    })

    it('detecta dropbox.com', () => {
      const r = parseEmbedUrl('https://www.dropbox.com/s/xyz/file.pdf')
      expect(r.provider).toBe('dropbox')
    })
  })

  describe('Generic fallback', () => {
    it('cualquier https unknown → generic', () => {
      const r = parseEmbedUrl('https://example.com/article')
      expect(r.provider).toBe('generic')
      expect(r.canonicalUrl).toBe('https://example.com/article')
    })

    it('http (no https) también acepta como generic', () => {
      const r = parseEmbedUrl('http://example.com/foo')
      expect(r.provider).toBe('generic')
    })
  })

  describe('Validación', () => {
    it('rechaza URL vacía', () => {
      expect(() => parseEmbedUrl('')).toThrow(ValidationError)
      expect(() => parseEmbedUrl('   ')).toThrow(ValidationError)
    })

    it('rechaza javascript:', () => {
      expect(() => parseEmbedUrl('javascript:alert(1)')).toThrow(ValidationError)
    })

    it('rechaza data:', () => {
      expect(() => parseEmbedUrl('data:text/html,<script>')).toThrow(ValidationError)
    })

    it('rechaza ftp:', () => {
      expect(() => parseEmbedUrl('ftp://example.com')).toThrow(ValidationError)
    })

    it('rechaza URL malformada', () => {
      expect(() => parseEmbedUrl('not a url')).toThrow(ValidationError)
    })
  })
})
