# `PLACE_SSO_SIGNING_KEY` jamás aparece en logs/stdout/error messages

> Documentado 2026-05-22 al cerrar ADR-0032 (Feature C — Custom Domain SSO).

## Síntoma

La signing key ES256 (ECDSA P-256 PKCS8 PEM private key) aparece en Vercel runtime logs, en stdout durante un error path, o en un commit accidental. **Blast radius total**: un atacante con acceso al PEM puede mintear tickets SSO arbitrarios + impersonate a cualquier owner en cualquier custom domain verified.

Indicadores de que pasó:
- Una línea en Vercel logs con la substring `-----BEGIN EC PRIVATE KEY-----` o `-----BEGIN PRIVATE KEY-----`.
- Un `console.error(error)` cuyo `error.message` o `error.cause` incluye el contenido de `process.env.PLACE_SSO_SIGNING_KEY`.
- Un PR/commit con el PEM hardcoded (el pre-commit hook `.gitignore` no cubre esto si el archivo no matcha `*.env`).

## Causa

Code paths típicos que filtran la key:

- **Logging genérico del request**: `console.log(request)` o `console.log({ headers, env })` que arrastra `process.env` completo.
- **Stack traces con env embedded**: `catch (error) { console.error(error) }` donde `error` tiene un campo (e.g. `error.config`, `error.options`) con el key como propiedad. Algunos APM SDKs y debug helpers serializan `process.env` por default.
- **Debugging temporal olvidado**: `console.log(process.env.PLACE_SSO_SIGNING_KEY)` agregado para debuggear, no removido antes de mergear.
- **`console.log(process.env)`** completo (peor caso — filtra **todos** los secrets, no sólo este).
- **Integración con third-party libs** que loggean `process.env` por default (Sentry, Datadog, etc. — verificar config de redaction).

## Detección

Tests S2 (`sso-keys.test.ts` del módulo `src/shared/lib/sso/`) mockean `console.log` / `console.error` y fallan si el output contiene patterns de signing key:

```typescript
const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
try { await someFunctionThatThrows(); } catch {}
expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('-----BEGIN'));
expect(spy).not.toHaveBeenCalledWith(expect.stringMatching(/"kty"\s*:\s*"EC"/));
```

Patterns que el assertion debe rechazar:
- `-----BEGIN` (PEM header — cubre `EC PRIVATE KEY`, `PRIVATE KEY`, `PKCS8`, etc.).
- `"kty":"EC"` (JWK serializado).
- Strings base64 contiguos de 100+ chars (heurístico para PEM body).

## Mitigación operacional

**Reglas duras**:

- **NUNCA** `console.log(process.env)`.
- **NUNCA** `console.log(process.env.PLACE_SSO_SIGNING_KEY)` ni siquiera temporal durante debugging. Si necesitás verificar que la env var está seteada, loggear `process.env.PLACE_SSO_SIGNING_KEY ? '[set]' : '[missing]'`.
- **Logging estructurado del flow SSO** (ADR-0032 §9) loggea sólo `{ event, code, host, jti, timestamp }`. **NUNCA**: signing key, ticket raw (contiene `sub`), session token raw, state cookie value completo.
- **Reviewers de PR** rechazan cualquier `console.log` que tome objetos no-trivial (request, error completo, env objects) sin sanitización explícita.
- Cualquier helper nuevo que toque la key (`loadSigningKey`, `signSsoTicket`) debe tener test que verifica que no se loggea en error paths.

**Si se sospecha leak** (e.g. signing key apareció en un Vercel log, en un screenshot, en un PR):

1. **Rotar key inmediatamente** (procedure canónica en ADR-0032 §10):
   ```bash
   openssl ecparam -name prime256v1 -genkey -noout -out tmp.pem
   openssl pkcs8 -topk8 -nocrypt -in tmp.pem -out signing-pkcs8.pem
   ```
2. Update Vercel env `PLACE_SSO_SIGNING_KEY` + `PLACE_SSO_SIGNING_KEY_KID` (production + preview).
3. Trigger redeploy. Downtime ≤60s (TTL del ticket).
4. **Después** de rotar: limpiar logs/historial Git/screenshots. Rotación es prioridad sobre limpieza (CLAUDE.md § "Seguridad de secrets").

**Rotación operacional 90d**: documentada en ADR-0032 §10. **Calendarizar como tarea recurrente** (no esperar a sospecha de leak; rotar profilácticamente cada 90 días). V2 multi-key rotation zero-downtime queda diferido.

## Pointers

- ADR-0032 §9 — logging estructurado canónico del flow SSO (qué loggear, qué nunca loggear).
- ADR-0032 §10 — env vars `PLACE_SSO_SIGNING_KEY` + `PLACE_SSO_SIGNING_KEY_KID` + procedure de rotación 90d.
- `src/shared/lib/sso/sso-keys.ts` — `loadSigningKey()` + `loadPublicJwks()`. Jamás loggea el contenido del key; tests S2 lo verifican.
- `CLAUDE.md` § "Seguridad de secrets" — regla general: nunca exponer API keys/passwords/service-role tokens en GitHub; rotar inmediatamente ante leak.
- Gotcha paralelo: `host-prefix-cookie-path.md` — la otra mitad del modelo de seguridad SSO (cookies host-only que transportan el resultado del signing).
