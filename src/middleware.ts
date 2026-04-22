import { NextResponse, type NextRequest } from 'next/server'
import { resolveHost, type HostResolution } from '@/shared/lib/host'
import { REQUEST_ID_HEADER, getOrCreateRequestId } from '@/shared/lib/request-id'
import { updateSession } from '@/shared/lib/supabase/middleware'

/**
 * Paths que sirven como-is en cualquier subdomain (no se rewritean a /inbox/*
 * ni a /[slug]/*, y no pasan por el gate de auth). Son las rutas de autenticación
 * compartidas: el cookie de sesión cruza subdominios vía `domain=<apex>`.
 */
const AUTH_PATHS = ['/login', '/logout', '/auth/callback']

function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/**
 * Middleware principal: refresca la sesión Supabase, inyecta request-id,
 * aplica gates de autenticación y hace rewrite a la ruta correcta según subdomain.
 *
 * Ver `docs/multi-tenancy.md` y `docs/features/auth/spec.md`.
 */
export async function middleware(req: NextRequest) {
  const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN
  if (!appDomain) {
    return new NextResponse('NEXT_PUBLIC_APP_DOMAIN no configurado', { status: 500 })
  }

  const requestId = getOrCreateRequestId(req.headers)
  const hostname = req.headers.get('host') ?? ''
  const resolution = resolveHost(hostname, appDomain)

  const { response: sessionResponse, user } = await updateSession(req)

  const pathname = req.nextUrl.pathname
  const isAuth = isAuthPath(pathname)

  if (!isAuth) {
    const redirect = gate(req, resolution, user)
    if (redirect) {
      redirect.headers.set(REQUEST_ID_HEADER, requestId)
      return redirect
    }
  }

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set(REQUEST_ID_HEADER, requestId)

  const routed = isAuth
    ? passthrough(requestHeaders, sessionResponse)
    : route(req.nextUrl.clone(), resolution, requestHeaders, sessionResponse)
  routed.headers.set(REQUEST_ID_HEADER, requestId)
  return routed
}

function passthrough(requestHeaders: Headers, sessionResponse: NextResponse): NextResponse {
  const res = NextResponse.next({ request: { headers: requestHeaders } })
  for (const cookie of sessionResponse.cookies.getAll()) res.cookies.set(cookie)
  return res
}

/**
 * Gate de autenticación por tipo de host.
 * Retorna un 307 a `/login?next=<currentPath>` en el MISMO host cuando
 * la ruta está protegida y no hay sesión.
 *
 * El redirect es intencionalmente relativo y local al subdomain: las cookies
 * de sesión cruzan subdominios vía `domain=<apex>`, así que `/login` funciona
 * idénticamente en cualquier host (ver `AUTH_PATHS` arriba).
 */
function gate(
  req: NextRequest,
  resolution: HostResolution,
  user: { id: string } | null,
): NextResponse | null {
  if (user) return null
  if (resolution.kind === 'marketing') return null
  if (resolution.kind === 'reserved') return null

  const proto = req.nextUrl.protocol
  const realHost = req.headers.get('host') ?? req.nextUrl.host
  const originalUrl = `${proto}//${realHost}${req.nextUrl.pathname}${req.nextUrl.search}`

  const loginUrl = req.nextUrl.clone()
  loginUrl.pathname = '/login'
  loginUrl.search = ''
  loginUrl.searchParams.set('next', originalUrl)
  return NextResponse.redirect(loginUrl)
}

function route(
  url: NextRequest['nextUrl'],
  resolution: HostResolution,
  requestHeaders: Headers,
  sessionResponse: NextResponse,
): NextResponse {
  const init = { request: { headers: requestHeaders } }
  const copyCookies = (dest: NextResponse) => {
    for (const cookie of sessionResponse.cookies.getAll()) {
      dest.cookies.set(cookie)
    }
    return dest
  }

  switch (resolution.kind) {
    case 'marketing': {
      if (!url.pathname.startsWith('/(marketing)')) {
        url.pathname = `/${url.pathname.replace(/^\/+/, '')}`.replace(/\/+$/, '') || '/'
      }
      return copyCookies(NextResponse.next(init))
    }
    case 'inbox': {
      const rest = url.pathname === '/' ? '' : url.pathname
      url.pathname = `/inbox${rest}`
      return copyCookies(NextResponse.rewrite(url, init))
    }
    case 'place': {
      const rest = url.pathname === '/' ? '' : url.pathname
      url.pathname = `/${resolution.slug}${rest}`
      return copyCookies(NextResponse.rewrite(url, init))
    }
    case 'reserved': {
      url.pathname = '/not-found'
      return copyCookies(NextResponse.rewrite(url, init))
    }
  }
}

export const config = {
  matcher: [
    '/((?!_next/|api/|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff|woff2|ttf)$).*)',
  ],
}
