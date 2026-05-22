# 0001 — Auth: OIDC IdP propio, identidad separada y custom domains

- **Fecha:** 2026-05-15
- **Estado:** Aceptada
- **Alcance:** auth, multi-tenancy, modelo de datos

> **Refinada por ADR-0026 + ADR-0028 (2026-05-21):**
> - **Verificación V1** = lazy poll en page-load del Server Component (`/settings/domain` invoca Vercel Domains API cuando `place_domain.verified_at IS NULL`) + safety-net cron `*/15` opcional V1.1. **NO** es el polling continuo que el §Decisión #4 sugiere; ese modelo se difirió por costo/complejidad. Detalle: ADR-0026.
> - **Lifecycle archived libera dominio** (partial unique index `(domain) WHERE archived_at IS NULL` en `place_domain`). Detalle: ADR-0026.
> - **`place_domain.oauth_client_id` queda NULL en V1** — el provisioning OIDC del §Decisión #3 se delega a Feature C (callback handler en custom domain + SSO silencioso). ADR-0027 (futura) cubrirá el provisioning retroactivo cuando Feature C entre.
> - **Layout del slice**: `src/features/custom-domain/` (slice propio promovido en S4 del plan Feature A). Detalle: ADR-0028.

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

Place es multi-tenant por subdomain (`{slug}.place.community`) y cada place podrá configurar su propio dominio (`community.empresa.com`). Auth provider decidido: **Neon Auth** (sobre Better Auth). Un custom domain es un registrable domain distinto del apex, así que **no puede compartir la cookie de sesión apex**. A la vez, la ontología (`docs/ontologia/miembros.md`) define el inbox de DMs como **universal, no situado**. Esto generó tres decisiones acopladas.

## Decisión

**1. Place es su propio OIDC Identity Provider** (plugin OIDC Provider de Better Auth) — modelo "Sign in with Google" pero el IdP somos nosotros. Dos mundos de sesión:

- `*.place.community` (subdomains + inbox): una sola cookie cross-subdomain `Domain=place.community`. No son RPs.
- Custom domains: cada uno es un Relying Party OIDC. SSO silencioso vía auth code, sin compartir cookies cross-domain.

**2. Identidad de producto separada de la de login.** `app_user` vive separada de la tabla `user` de Better Auth, con link 1:1 vía `app_user.auth_user_id UNIQUE`. La fila `app_user` se crea en un hook transaccional al signup.

**3. Un OIDC client confidencial por custom domain**, provisionado por el backend en el flujo de verificación del dominio (`place_domain.oauth_client_id`), revocado al archivar el dominio.

**4. Verificación de dominio delegada a Vercel Domains API.** Alta y verificación 100% programáticas (`POST /v10/projects/{project}/domains` + polling); Vercel es la única fuente de verdad de verificación + SSL; `place_domain.verified_at` espeja ese estado.

## Alternativas rechazadas

- **Identidad: extender la tabla `user` de Better Auth** (additional fields). Más simple e idiomático, pero acopla el modelo de dominio al schema de la librería y hace que el derecho al olvido (anonimización a 365 días) pelee con el ciclo de vida que gestiona Better Auth. Rechazada por los dos requisitos duros del producto: derecho al olvido estructurado y aislamiento del modelo de dominio.
- **OIDC: un client compartido con redirect URIs dinámicas.** Un solo `client_id/secret` = blast radius total si se filtra, sin audit ni revocación por tenant, lista de redirect URIs sin techo. Rechazada por seguridad.
- **OIDC: Dynamic Client Registration abierto (RFC 7591).** Registro público sin gating = riesgo; nuestros dominios son controlados. Rechazada.
- **Verificación: challenge DNS TXT propio.** Duplica la verificación que Vercel ya exige para emitir SSL → doble config DNS para el cliente, estado duplicado que puede divergir. Rechazada por redundante (el dominio no es funcional sin el SSL de Vercel de todas formas).

## Consecuencias

- Costo asumido: hook transaccional de signup (crear `app_user`), join extra en lookups de identidad, y una fila de client + secret por custom domain (automatizado en el flujo de verificación). Todo deuda resuelta-una-vez, no recurrente.
- El inbox universal se preserva: vive en `app.place.community`, alcanzable por la cookie compartida del apex o por SSO silencioso desde un custom domain.
- TBD acotado restante (no afecta la topología): firma de ID tokens RS256 vs EdDSA, se fija al implementar auth.

## Detalle operativo canónico

- Topología y flujo SSO: `docs/architecture.md` § "Sesión y SSO".
- Schema e invariantes: `docs/data-model.md` (§ "Auth y OIDC").
- Alta/verificación de custom domains: `docs/multi-tenancy.md` § "Dominios propios".
