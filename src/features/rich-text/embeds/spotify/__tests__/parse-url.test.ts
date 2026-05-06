import { describe, expect, it } from 'vitest'
import { parseSpotifyUrl } from '../parse-url'

/**
 * Spotify acepta `track | episode | show | playlist | album` por kind.
 * Path: `open.spotify.com/<kind>/<id>` con id alfanumérico de longitud
 * variable (típicamente 22 caracteres base62, pero no enforced).
 */
describe('parseSpotifyUrl', () => {
  it('matchea track', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toEqual({
      kind: 'track',
      externalId: '4uLU6hMCjMI75M1A2tKUQC',
    })
  })

  it('matchea episode', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/episode/abc123')).toEqual({
      kind: 'episode',
      externalId: 'abc123',
    })
  })

  it('matchea show', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/show/xyz789')).toEqual({
      kind: 'show',
      externalId: 'xyz789',
    })
  })

  it('matchea playlist con query params (si=...)', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/playlist/37i9dQZF1?si=abc')).toEqual({
      kind: 'playlist',
      externalId: '37i9dQZF1',
    })
  })

  it('matchea album con locale prefix /intl-es/', () => {
    expect(
      parseSpotifyUrl('https://open.spotify.com/intl-es/album/4aawyAB9vmqN3uQ7FjRGTy'),
    ).toEqual({ kind: 'album', externalId: '4aawyAB9vmqN3uQ7FjRGTy' })
  })

  it('rechaza kind no soportado', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/artist/abc')).toBeNull()
  })

  it('rechaza dominio incorrecto', () => {
    expect(parseSpotifyUrl('https://spotify.com/track/abc')).toBeNull()
  })

  it('rechaza URL sin id', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/track/')).toBeNull()
  })

  it('rechaza string vacío', () => {
    expect(parseSpotifyUrl('')).toBeNull()
  })

  it('rechaza URL malformada', () => {
    expect(parseSpotifyUrl('not a url')).toBeNull()
  })
})
