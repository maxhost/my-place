import { describe, expect, it } from 'vitest'
import { parseIvooxUrl } from '../parse-url'

/**
 * Ivoox URL pattern:
 *   `www.ivoox.com/<slug>_rf_<id>_1.html` — el id numérico va entre `_rf_`
 *   y `_1.html`. Algunos players viejos usan `_ej_` en vez de `_rf_`.
 */
describe('parseIvooxUrl', () => {
  it('matchea pattern _rf_<id>_1.html', () => {
    expect(parseIvooxUrl('https://www.ivoox.com/episodio-genial_rf_98765432_1.html')).toEqual({
      externalId: '98765432',
    })
  })

  it('matchea pattern _ej_<id>_1.html (formato player viejo)', () => {
    expect(parseIvooxUrl('https://www.ivoox.com/algo_ej_12345_1.html')).toEqual({
      externalId: '12345',
    })
  })

  it('matchea sin www', () => {
    expect(parseIvooxUrl('https://ivoox.com/foo_rf_42_1.html')).toEqual({
      externalId: '42',
    })
  })

  it('rechaza dominio incorrecto', () => {
    expect(parseIvooxUrl('https://example.com/foo_rf_42_1.html')).toBeNull()
  })

  it('rechaza pattern sin id numérico', () => {
    expect(parseIvooxUrl('https://www.ivoox.com/foo_rf_abc_1.html')).toBeNull()
  })

  it('rechaza pattern truncado', () => {
    expect(parseIvooxUrl('https://www.ivoox.com/episodio-suelto.html')).toBeNull()
  })

  it('rechaza string vacío', () => {
    expect(parseIvooxUrl('')).toBeNull()
  })

  it('rechaza URL malformada', () => {
    expect(parseIvooxUrl('not a url')).toBeNull()
  })
})
