import type { createNeonAuth } from "@neondatabase/auth/next/server";

// El SDK no exporta `NeonAuthConfig` (lo declara local); lo derivamos de la
// firma de `createNeonAuth` (sí exportada) → el contrato sigue atado al SDK.
type NeonAuthConfig = Parameters<typeof createNeonAuth>[0];

// Config de Neon Auth: env → config validada, PURO (sin red, sin importar el
// runtime del SDK → testeable determinístico en vitest/node). El wiring del
// SDK vive en `./auth.ts`; acá vive sólo el contrato + el test-guard.
//
// El JWT del backend se obtiene con `auth.token()` (endpoint `/token` del
// plugin JWT de Neon Auth/Better Auth). NO `auth.getAccessToken()` (es token
// OAuth de proveedor) NI el token de `signUp`/`getSession` (sesión OPACA, no
// JWT → `ERR_JWS_INVALID`). Verificado en prod 2026-05-19; cierra el TBD de
// ADR-0006 — canónico en ADR-0018 (la afirmación previa de `getAccessToken`
// "verificada 2026-05-18" era incorrecta y quedó superada).
//
// El place es multi-tenant por subdominio (`multi-tenancy.md`): la cookie de
// sesión DEBE llevar `Domain=.<apex>` para viajar a `*.<apex>`. Sin punto
// líder es host-only → la sesión no cruza subdominios y auth rota en silencio
// entre el sitio público y cada place. Por eso `cookies.domain` es
// OBLIGATORIO y se deriva del apex `NEXT_PUBLIC_APP_DOMAIN` con punto líder.
//
// Cookie hardening (audit Phase 2.E, 2026-06-01): el SDK Neon Auth expone UN
// solo flag de cookie configurable —`sameSite`— en su `SessionCookieConfig`
// (junto a `secret`/`domain`/`sessionDataTtl`). `httpOnly` y `secure` NO son
// configurables: el SDK los aplica internamente (session cookies de Better
// Auth son `HttpOnly` por diseño; `Secure` "always applied" per docs del SDK).
// Por eso el único hardening explícito posible acá es `sameSite`. Lo fijamos a
// `"strict"` (= default actual del SDK) por zero-trust sobre defaults: si una
// versión futura cambiara el default, nuestra postura no se altera en silencio.
// `"strict"` es seguro para nuestra topología: los subdominios de `.<apex>`
// son same-site (la cookie viaja por `Domain` compartido, no por sameSite), y
// el cruce a custom domains NO depende de que la cookie viaje cross-site — usa
// el Signed Ticket SSO (ADR-0032: init→issue→redeem siembra sesión local en
// el destino). Ningún flujo depende de envío cross-site de esta cookie.
const APEX_DOMAIN = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} no configurada`);
  return value;
}

export function buildNeonAuthConfig(): NeonAuthConfig {
  const baseUrl = requireEnv("NEON_AUTH_BASE_URL");
  try {
    new URL(baseUrl);
  } catch {
    throw new Error("NEON_AUTH_BASE_URL no es una URL válida");
  }

  const secret = requireEnv("NEON_AUTH_COOKIE_SECRET");
  if (secret.length < 32) {
    throw new Error(
      "NEON_AUTH_COOKIE_SECRET debe tener ≥32 caracteres (openssl rand -base64 32)",
    );
  }

  const appDomain = requireEnv("NEXT_PUBLIC_APP_DOMAIN");
  if (!APEX_DOMAIN.test(appDomain)) {
    throw new Error(
      `NEXT_PUBLIC_APP_DOMAIN debe ser un dominio registrable (ej. "place.community"), recibido: "${appDomain}"`,
    );
  }

  return {
    baseUrl,
    cookies: {
      secret,
      // Punto líder = compartida entre todos los subdominios del apex.
      domain: `.${appDomain}`,
      // Explícito (no default) — ver bloque "Cookie hardening" arriba.
      sameSite: "strict",
    },
  };
}
