import { describe, expect, it } from 'vitest'
import { assertNever } from '../assert-never'

describe('assertNever', () => {
  it('throws con el valor inesperado en el mensaje', () => {
    // Cast a `never` para simular la rama default de un switch que no debería
    // alcanzarse — el caller del helper en producción usa el typing de TS para
    // garantizar exhaustividad.
    expect(() => assertNever('unexpected' as never)).toThrow(/Unexpected value/)
    expect(() => assertNever('unexpected' as never)).toThrow(/"unexpected"/)
  })

  it('serializa objetos en el mensaje', () => {
    expect(() => assertNever({ kind: 'X' } as never)).toThrow(/"kind":"X"/)
  })
})
