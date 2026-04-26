import { describe, expect, it } from 'vitest'
import { AuthApiError } from '@supabase/supabase-js'
import { isStaleSessionError } from './refresh-token-error'

describe('isStaleSessionError', () => {
  it('detecta refresh_token_already_used por code', () => {
    const err = new AuthApiError(
      'Invalid Refresh Token: Already Used',
      400,
      'refresh_token_already_used',
    )
    expect(isStaleSessionError(err)).toBe(true)
  })

  it('detecta refresh_token_not_found por code', () => {
    const err = new AuthApiError('Refresh Token Not Found', 400, 'refresh_token_not_found')
    expect(isStaleSessionError(err)).toBe(true)
  })

  it('detecta session_not_found por code', () => {
    const err = new AuthApiError('Session not found', 404, 'session_not_found')
    expect(isStaleSessionError(err)).toBe(true)
  })

  it('detecta session_expired por code', () => {
    const err = new AuthApiError('Session expired', 401, 'session_expired')
    expect(isStaleSessionError(err)).toBe(true)
  })

  it('fallback por mensaje cuando code está ausente (legacy)', () => {
    const err = new AuthApiError('Invalid Refresh Token: Already Used', 400, undefined)
    expect(isStaleSessionError(err)).toBe(true)
  })

  it('fallback por mensaje "refresh token not found"', () => {
    const err = new AuthApiError('Refresh Token Not Found', 400, undefined)
    expect(isStaleSessionError(err)).toBe(true)
  })

  it('false para otros AuthApiError', () => {
    const err = new AuthApiError('Invalid credentials', 400, 'invalid_credentials')
    expect(isStaleSessionError(err)).toBe(false)
  })

  it('false para errores genéricos (no AuthApiError)', () => {
    expect(isStaleSessionError(new Error('refresh token already used'))).toBe(false)
    expect(isStaleSessionError(null)).toBe(false)
    expect(isStaleSessionError(undefined)).toBe(false)
    expect(isStaleSessionError('refresh token already used')).toBe(false)
  })
})
