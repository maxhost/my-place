import { describe, it, expect } from 'vitest'
import { htmlRedirect } from '../auth-redirect-html'

describe('htmlRedirect', () => {
  it('retorna 200 OK con content-type html', () => {
    const res = htmlRedirect(new URL('https://www.place.community/inbox'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('emite cache-control no-store (no cachear el redirect)', () => {
    const res = htmlRedirect(new URL('https://www.place.community/inbox'))
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('body contiene anchor button con la URL destino (user interaction requerida)', async () => {
    const res = htmlRedirect(new URL('https://www.place.community/inbox'))
    const body = await res.text()
    expect(body).toContain('href="https://www.place.community/inbox"')
    expect(body).toContain('Continuar')
  })

  it('NO usa auto-redirect (Safari iOS ITP rechaza Set-Cookie sin user click)', async () => {
    const res = htmlRedirect(new URL('https://www.place.community/inbox'))
    const body = await res.text()
    expect(body).not.toContain('window.location.replace')
    expect(body).not.toContain('http-equiv="refresh"')
  })

  it('escape HTML en attributes (defense in depth contra URL maliciosa)', async () => {
    const url = new URL('https://www.place.community/path')
    const dangerous = `https://www.place.community/?evil="><script>alert(1)</script>`
    const dangerousUrl = Object.create(url) as URL
    Object.defineProperty(dangerousUrl, 'toString', { value: () => dangerous })
    const res = htmlRedirect(dangerousUrl)
    const body = await res.text()
    expect(body).not.toContain('"><script>alert')
    expect(body).toContain('&quot;&gt;&lt;script&gt;')
  })
})
