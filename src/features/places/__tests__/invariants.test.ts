import { describe, it, expect } from 'vitest'
import { assertSlugFormat, assertSlugNotReserved } from '../domain/invariants'
import { ValidationError } from '@/shared/errors/domain-error'

describe('assertSlugFormat', () => {
  const invalid = [
    'ab', // too short
    'a'.repeat(31), // too long
    'AB', // uppercase
    'a_b', // underscore
    'a.b', // dot
    'a b', // space
    '-abc', // leading dash
    'abc-', // trailing dash
    'a--b', // double dash
    '', // empty
    'hola!',
  ]

  for (const slug of invalid) {
    it(`rechaza "${slug}"`, () => {
      expect(() => assertSlugFormat(slug)).toThrow(ValidationError)
    })
  }

  const valid = ['abc', 'my-place', 'the-company', 'a-b-c', 'pub-123', '123-abc', 'a'.repeat(30)]
  for (const slug of valid) {
    it(`acepta "${slug}"`, () => {
      expect(() => assertSlugFormat(slug)).not.toThrow()
    })
  }
})

describe('assertSlugNotReserved', () => {
  it.each(['app', 'www', 'api', 'admin'])('rechaza reserved "%s"', (slug) => {
    expect(() => assertSlugNotReserved(slug)).toThrow(ValidationError)
  })

  it('acepta slug no reservado', () => {
    expect(() => assertSlugNotReserved('my-place')).not.toThrow()
  })
})
