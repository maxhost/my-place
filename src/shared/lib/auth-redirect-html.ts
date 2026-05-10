import { NextResponse } from 'next/server'

/**
 * Construye un `NextResponse` 200 OK con HTML meta-refresh + script fallback
 * en lugar de un redirect HTTP (307/303).
 *
 * **Por qué:** browsers (especialmente Safari iOS con ITP) descartan
 * `Set-Cookie` headers en respuestas a redirects cuando consideran el flow
 * cross-site. Documentado en
 * https://github.com/vercel/next.js/discussions/48434 y
 * https://github.com/supabase/ssr/issues/36 — el síntoma típico es el primer
 * login deja solo `sb-*-auth-token-code-verifier` sin la `auth-token` real.
 *
 * Workaround canónico: emitir una respuesta 200 OK normal con `Set-Cookie`
 * (que el browser SÍ procesa) y un body HTML que dispara navegación
 * client-side via `<meta http-equiv="refresh">` + `<script location.replace>`.
 * El browser:
 *   1. Recibe response 200 + Set-Cookie → almacena cookies inmediatamente.
 *   2. Renderiza el HTML → meta refresh / script ejecuta navegación → siguiente
 *      request va con las cookies aplicadas.
 *
 * El cookieStore de `next/headers` (usado por `createSupabaseServer()`) sigue
 * funcionando — sus Set-Cookie se aplican al response 200 igual que a un
 * redirect, pero ahora SIN race con Safari ITP.
 *
 * El JS escapa correctamente la URL para evitar XSS aunque `target` sea una
 * URL parseada (defense in depth contra `</script>` injection).
 */
export function htmlRedirect(target: URL): NextResponse {
  const url = target.toString()
  const escapedAttr = escapeHtmlAttr(url)
  // escapedJs preservado por si reintroducimos auto-redirect controlado por
  // user interaction en el futuro.
  void escapeJsString
  void url
  // **User interaction requerida (Safari iOS ITP cross-app):** Safari iOS
  // rechaza `Set-Cookie` en el initial load cuando el user llega desde un
  // app externo (Mail.app email click) PORQUE trata el flow como
  // "potentially tracking". Mostrar un button visible que requiere CLICK
  // del user antes de navegar fuerza first-party intent — Safari coopera
  // y acepta cookies. Sin auto-redirect (meta refresh / window.replace
  // automático).
  //
  // Ver supabase/ssr#36 + Safari ITP docs.
  const html = `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Continuar a Place</title>
    <style>
      body { font-family: -apple-system, system-ui, sans-serif; color: #333; padding: 3rem 1.5rem; text-align: center; max-width: 28rem; margin: 0 auto; line-height: 1.5; }
      a.btn { display: inline-block; margin-top: 1.5rem; padding: 0.875rem 2rem; background: #111; color: #fff; text-decoration: none; border-radius: 999px; font-size: 1rem; font-weight: 500; }
      a.btn:active { background: #444; }
      p { color: #666; }
    </style>
  </head>
  <body>
    <p>Click el botón para continuar a Place.</p>
    <a class="btn" href="${escapedAttr}">Continuar →</a>
  </body>
</html>`

  return new NextResponse(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      pragma: 'no-cache',
    },
  })
}

const HTML_ATTR_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ATTR_ESCAPES[c] ?? c)
}

/**
 * Escapa una string para uso seguro dentro de un literal JS de doble
 * comilla embebido en HTML. Cubre quote, backslash, control chars, line
 * terminators (incluido U+2028 / U+2029), y `<` / `>` (para evitar
 * `</script>` injection y comments `<!--`).
 *
 * Implementación per-character con switch para evitar regex con literales
 * Unicode (que rompen algunos transformers de TS/Vite).
 */
function escapeJsString(s: string): string {
  let out = ''
  for (const c of s) {
    const code = c.charCodeAt(0)
    if (c === '\\') out += '\\\\'
    else if (c === '"') out += '\\"'
    else if (c === '\n') out += '\\n'
    else if (c === '\r') out += '\\r'
    else if (c === '<') out += '\\u003c'
    else if (c === '>') out += '\\u003e'
    else if (code === 0x2028) out += '\\u2028'
    else if (code === 0x2029) out += '\\u2029'
    else out += c
  }
  return out
}
