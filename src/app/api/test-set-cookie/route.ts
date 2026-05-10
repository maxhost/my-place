import { NextResponse, type NextRequest } from 'next/server'

/**
 * DEBUG TEMPORAL — endpoint de test para verificar si Safari iOS acepta
 * cookies con `Domain=<apex>` setteadas desde `www.<apex>`. Setea 3 cookies
 * con Domains distintos.
 *
 * Query param `?html=1` retorna HTML con meta refresh (mismo patrón que
 * htmlRedirect del callback). Sin query, retorna JSON.
 */
export function GET(req: NextRequest) {
  const apex = 'place.community'
  const wantsHtml = new URL(req.url).searchParams.get('html') === '1'

  const ts = Date.now()
  const message = `Cookies test setteadas (apex/host-only/subdomain). ts=${ts}`

  let res: NextResponse

  if (wantsHtml) {
    // Mismo formato que htmlRedirect — verifica si Safari procesa Set-Cookie
    // en response HTML con meta refresh igual que en JSON.
    const html = `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0;url=https://www.place.community/api/debug-cookies" />
    <title>Test cookie HTML refresh</title>
  </head>
  <body>
    <p>${message}</p>
    <p>Redirigiendo a /api/debug-cookies en 1s…</p>
    <script>
      setTimeout(function() {
        window.location.replace("https://www.place.community/api/debug-cookies");
      }, 1000);
    </script>
  </body>
</html>`
    res = new NextResponse(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  } else {
    res = NextResponse.json(
      { ts: new Date().toISOString(), host: req.headers.get('host'), message },
      { headers: { 'cache-control': 'no-store' } },
    )
  }

  res.cookies.set('test-cookie-apex', `apex-${ts}`, {
    domain: apex,
    path: '/',
    maxAge: 60 * 5,
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
  })

  res.cookies.set('test-cookie-host', `host-${ts}`, {
    path: '/',
    maxAge: 60 * 5,
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
  })

  res.cookies.set('test-cookie-subdomain', `sub-${ts}`, {
    domain: `app.${apex}`,
    path: '/',
    maxAge: 60 * 5,
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
  })

  return res
}
