import { describe, expect, it } from 'vitest'
import { ORIGIN_ZONE_HREF, ORIGIN_ZONES, originQuery, parseOriginZone } from '../back-origin'

describe('parseOriginZone', () => {
  it('acepta cada zona válida del enum', () => {
    for (const zone of ORIGIN_ZONES) {
      expect(parseOriginZone(zone)).toBe(zone)
    }
  })

  it('retorna null para input desconocido', () => {
    expect(parseOriginZone('threads')).toBeNull()
    expect(parseOriginZone('home')).toBeNull()
    expect(parseOriginZone('')).toBeNull()
  })

  it('retorna null para undefined / null / no-string', () => {
    expect(parseOriginZone(undefined)).toBeNull()
    expect(parseOriginZone(null)).toBeNull()
  })
})

describe('originQuery', () => {
  it('arma `?from=<zone>` para zonas válidas', () => {
    expect(originQuery('conversations')).toBe('?from=conversations')
    expect(originQuery('events')).toBe('?from=events')
    expect(originQuery('library')).toBe('?from=library')
  })

  it('retorna string vacío si zone es null', () => {
    expect(originQuery(null)).toBe('')
  })
})

describe('ORIGIN_ZONE_HREF', () => {
  it('mapea cada zona a su URL canónica sin placeSlug', () => {
    expect(ORIGIN_ZONE_HREF.conversations).toBe('/conversations')
    expect(ORIGIN_ZONE_HREF.events).toBe('/events')
    expect(ORIGIN_ZONE_HREF.library).toBe('/library')
  })
})
