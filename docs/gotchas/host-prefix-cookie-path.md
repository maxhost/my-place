# El prefijo `__Host-` exige Path=/ y rechaza Domain attribute

> Documentado 2026-05-22 al cerrar ADR-0032 (Feature C — Custom Domain SSO).

## Síntoma

Las cookies `__Host-place_sso_state` o `__Host-place_sso_session` **no persisten** en el browser. El flow de SSO falla con `sso_error=state_invalid` en el primer redeem, incluso cuando el handler emite correctamente el `Set-Cookie` (respuesta 200/302 con el header presente). Inspección con DevTools → Storage → Cookies: la cookie no aparece. El siguiente request no la incluye, el handler ve "cookie ausente" y el flow falla en cadena.

Desorienta porque (a) la respuesta HTTP tiene el `Set-Cookie` correcto, (b) no hay error en consola browser, (c) `curl` también ve el header (pero curl no enforce el prefijo `__Host-`, así que el ida-y-vuelta con curl "funciona" — el bug solo se manifiesta en browser real).

## Causa

El prefijo `__Host-` (RFC 6265 §4.1.3.2) impone **3 reglas que el browser enforce silently**:

1. Atributo `Secure` presente.
2. Atributo `Path=/` exacto (no `/api`, no `/settings`, no `/cualquier-cosa`).
3. **Ausencia** del atributo `Domain` (la cookie debe ser host-only, no apex-shared).

Si el `Set-Cookie` viola cualquiera de las 3, el browser **descarta la cookie sin warning, sin console error, sin nada visible**. La respuesta HTTP "tuvo éxito" desde el punto de vista del server, pero el state nunca se guardó.

Casos típicos donde aparece:
- Alguien copia un `setCookie` call de otro handler (por ejemplo Neon Auth, que usa `Domain=.place.community` para cross-subdomain) y olvida que el prefijo `__Host-` invalida ese atributo.
- Un helper genérico que setea cookies con `Path` dinámico (`/api/auth/sso-redeem`) en vez de `Path=/`.
- Middleware o frameworks que modifican el shape de las cookies sin saberlo (Next.js `cookies().set()` en Server Actions / Route Handlers generalmente respeta lo que escribís, pero verificar tras refactors).

## Detección

Tests S3/S4 (`sso-state.test.ts` y `sso-session.test.ts` del módulo `src/shared/lib/sso/`) verifican el **shape exacto del header `Set-Cookie`**:

```typescript
expect(setCookieHeader).toMatch(/^__Host-place_sso_state=[^;]+;/);
expect(setCookieHeader).toContain('; Path=/;');
expect(setCookieHeader).toContain('; Secure');
expect(setCookieHeader).toContain('; HttpOnly');
expect(setCookieHeader).toContain('; SameSite=Lax');
expect(setCookieHeader).not.toContain('Domain=');
```

Cualquier desviación = el test falla loud antes de que llegue a producción.

## Mitigación operacional

Cuando inspecciones un `Set-Cookie` con `curl -i` o DevTools, verificá los 4 atributos en este orden:

```
Set-Cookie: __Host-place_sso_state=<value>; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=120
```

Reglas duras al escribir helpers nuevos que emiten cookies con prefijo `__Host-`:

- **Siempre** `Path=/` literal. No componer `Path` dinámicamente.
- **Nunca** `Domain=...`. El prefijo `__Host-` es por definición host-only.
- **Siempre** `Secure` (browser lo exige incluso en `localhost` HTTPS — ver gotcha `neon-auth-secure-cookie-https.md` para el caso paralelo de `__Secure-`).
- Cualquier branch de código que setea la cookie debe pasar por el mismo helper (`setStateCookie` / `setLocalSessionCookie` en `src/shared/lib/sso/`), no duplicar el shape manualmente.

## Pointers

- ADR-0032 §3 — decisión canónica sobre cookie attributes (tabla con TTL, atributos, propósito de cada cookie SSO).
- `src/shared/lib/sso/sso-state.ts` — helpers que escriben la state cookie (`setStateCookie`, `clearStateCookie`).
- `src/shared/lib/sso/sso-session.ts` — helpers que escriben la session cookie (`setLocalSessionCookie`).
- Gotcha paralelo: `neon-auth-secure-cookie-https.md` — cookies con prefijo `__Secure-` (regla más laxa: sólo exige `Secure` + HTTPS, sin restricción de `Path`/`Domain`).
- RFC 6265 §4.1.3.2 — definición canónica del prefijo `__Host-`.
