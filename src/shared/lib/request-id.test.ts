import { describe, it, expect } from 'vitest'
import {
  REQUEST_ID_HEADER,
  generateRequestId,
  getOrCreateRequestId,
  createRequestLogger,
} from './request-id'

describe('request-id', () => {
  it('generateRequestId produce UUIDs distintos', () => {
    const a = generateRequestId()
    const b = generateRequestId()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('getOrCreateRequestId devuelve el header existente si es seguro', () => {
    const headers = new Headers({ [REQUEST_ID_HEADER]: 'abc-123_ok' })
    expect(getOrCreateRequestId(headers)).toBe('abc-123_ok')
  })

  it('getOrCreateRequestId descarta headers no safe y genera uno nuevo', () => {
    const headers = new Headers({ [REQUEST_ID_HEADER]: 'x y z; drop table' })
    const id = getOrCreateRequestId(headers)
    expect(id).not.toBe('x y z; drop table')
    expect(id).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('getOrCreateRequestId genera uno nuevo si no hay header', () => {
    const id = getOrCreateRequestId(new Headers())
    expect(id).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('createRequestLogger bindea el requestId en cada log', () => {
    const child = createRequestLogger('req-42')
    expect(child.bindings().requestId).toBe('req-42')
  })
})
