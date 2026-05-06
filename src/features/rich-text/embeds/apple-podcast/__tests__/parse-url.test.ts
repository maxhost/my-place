import { describe, expect, it } from 'vitest'
import { parseApplePodcastUrl } from '../parse-url'

/**
 * Apple Podcasts URL pattern:
 *   `podcasts.apple.com/<region>/podcast/<showSlug>/id<showId>[?i=<episodeId>]`
 *
 * Region es código ISO de 2 letras. ShowSlug es slug humano. ShowId es
 * numérico precedido de "id". `i=` opcional identifica el episodio.
 */
describe('parseApplePodcastUrl', () => {
  it('matchea show sin episodio', () => {
    expect(
      parseApplePodcastUrl('https://podcasts.apple.com/us/podcast/the-daily/id1200361736'),
    ).toEqual({
      region: 'us',
      showSlug: 'the-daily',
      showId: '1200361736',
      episodeId: undefined,
    })
  })

  it('matchea show con episodio (?i=)', () => {
    expect(
      parseApplePodcastUrl(
        'https://podcasts.apple.com/ar/podcast/the-daily/id1200361736?i=1000567890',
      ),
    ).toEqual({
      region: 'ar',
      showSlug: 'the-daily',
      showId: '1200361736',
      episodeId: '1000567890',
    })
  })

  it('matchea showSlug con guiones múltiples', () => {
    expect(
      parseApplePodcastUrl('https://podcasts.apple.com/es/podcast/un-titulo-largo/id12345'),
    ).toEqual({
      region: 'es',
      showSlug: 'un-titulo-largo',
      showId: '12345',
      episodeId: undefined,
    })
  })

  it('rechaza dominio incorrecto', () => {
    expect(parseApplePodcastUrl('https://apple.com/us/podcast/the-daily/id1200361736')).toBeNull()
  })

  it('rechaza path sin /podcast/', () => {
    expect(parseApplePodcastUrl('https://podcasts.apple.com/us/show/abc/id123')).toBeNull()
  })

  it('rechaza id sin prefijo "id"', () => {
    expect(
      parseApplePodcastUrl('https://podcasts.apple.com/us/podcast/the-daily/1200361736'),
    ).toBeNull()
  })

  it('rechaza string vacío', () => {
    expect(parseApplePodcastUrl('')).toBeNull()
  })

  it('rechaza URL malformada', () => {
    expect(parseApplePodcastUrl('not a url')).toBeNull()
  })
})
