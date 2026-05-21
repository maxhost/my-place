# Tests del Custom Domain V1 — TDD plan

> _Creado 2026-05-21_. Compañía del [spec del custom-domain](./spec.md) + [plan-sesiones](./plan-sesiones.md). Detalla los tests que cubren genuinamente el comportamiento de la Feature A (registro · verificación lazy · archivado). Cada test responde a "¿qué dejaría de funcionar si esto no estuviera?"

## Mandato TDD (CLAUDE.md §"Durante la implementación")

**Tests primero, verificar que fallan, implementar, verificar que pasan. Sin excepciones en core (slice + actions + validators).**

## Canon "Server Actions sin tests directos"

Confirmado en `src/features/place-settings/actions/update-default-locale.ts:13`:

> "Su correctitud es de tipo/build + smoke vivo en producción, NO vitest (arrastra `next/headers` + Neon Auth + DB real — canon de seam-split, idéntico a `createPlaceAction`, `logoutAction`, `signUpAccountAction`)."

Por eso las 3 Server Actions del custom-domain (`register-custom-domain.ts`, `archive-custom-domain.ts`, `get-custom-domain-status.ts`) **NO tienen tests directos con vitest**. La cobertura del comportamiento de esas acciones vive en piezas puras compuestas:

- `validateCustomDomain` — S2, tests propios.
- `isReservedDomain` — S2, tests propios.
- Vercel wrapper (`addDomain`/`getDomainStatus`/`removeDomain`) — S2, tests propios con mock `fetch`.
- `mapPgErrorToActionError` — S3, pure helper testeado en isolation.
- UI `<DomainSection>` con `vi.fn()` para actions — S4.
- Smoke vivo en dev local + preview — S5.

---

## S1 — Schema partial unique index

### `src/db/__tests__/schema.test.ts` (modificado)

**Por qué importa:** la migration 0008 reemplaza el UNIQUE global por un partial unique `(domain) WHERE archived_at IS NULL`. Bug = dominio archivado bloquea reuso (UX rota); o UNIQUE no se aplica (data corruption: dos owners pueden tener el mismo dominio activo).

**Test agregado** (≥1):
- [ ] `place_domain_domain_active_unq` existe en el schema introspect Y permite reuso post-archive: INSERT (place_a, "foo.com") → UPDATE archived_at → INSERT (place_b, "foo.com") debe succeed.

### `src/db/__tests__/rls.test.ts` (modificado)

**Por qué importa:** verificar que el caso real (2 owners distintos, mismo dominio post-archive) no rompe RLS ni UNIQUE.

**Test agregado** (≥1):
- [ ] INSERT post-archive del mismo dominio con 2 owners distintos no falla con UNIQUE (`inRlsTx` con dos JWTs).

**Total S1: ≥2 tests nuevos.**

---

## S2 — Foundations `shared/lib/`

### `src/shared/lib/__tests__/custom-domain.test.ts` (nuevo)

**Por qué importa:** `validateCustomDomain` es SoT compartido client+server. Si rompe, todo el flow de registro acepta basura o rechaza válidos.

**Casos cubiertos** (≥15):

**Válidos:**
- [ ] `mi-marca.com` → `{ok: true, normalized: "mi-marca.com"}`.
- [ ] `comunidad.empresa.co.uk` → ok.
- [ ] `Mi-Marca.COM` → ok, normalizado a lowercase.
- [ ] Hostname con label de 63 chars (boundary) → ok.

**Inválidos por formato (RFC 1123):**
- [ ] `-foo.com` (leading hyphen) → `{ok: false, reason: "invalid_format"}`.
- [ ] `foo-.com` (trailing hyphen) → invalid.
- [ ] `foo` (sin TLD) → invalid.
- [ ] `.com` (label vacío) → invalid.
- [ ] `foo..com` (doble punto) → invalid.
- [ ] Label > 63 chars → invalid.
- [ ] Hostname > 253 chars → invalid.

**Inválidos por IDN (V1 rechaza):**
- [ ] `münchen.de` → `{ok: false, reason: "idn_not_supported"}`.
- [ ] `xn--mnchen-3ya.de` (punycode explícito) → ídem (rechazado V1).

**Inválidos por wildcards:**
- [ ] `*.foo.com` → invalid.

**Inválidos por reservados (delegación a `isReservedDomain`):**
- [ ] `place.community` → `{ok: false, reason: "reserved"}`.
- [ ] `mi-place.vercel.app` → reserved.

**Inválidos por IP literal:**
- [ ] `192.168.1.1` → invalid.
- [ ] `::1` → invalid.

### `src/shared/lib/__tests__/reserved-domains.test.ts` (nuevo)

**Por qué importa:** la blocklist impide vincular dominios que rompen el modelo (apex de Place, subdomains canónicos, proveedores PaaS).

**Casos cubiertos** (≥6, uno por bucket):
- [ ] Apex reservado: `place.community` → `isReservedDomain` true.
- [ ] Suffix `.place.community`: `cualquiera.place.community` → true.
- [ ] Suffix `.vercel.app`: `mi-app.vercel.app` → true.
- [ ] Suffix `.netlify.app` / `.github.io` / `.ngrok.io` → true.
- [ ] IP literal v4: `10.0.0.1` → true.
- [ ] IP literal v6: `::1` → true.
- [ ] Casing: `PLACE.COMMUNITY` → true (case-insensitive).

### `src/shared/lib/vercel/__tests__/domains.test.ts` (nuevo)

**Por qué importa:** wrapper es la única integración externa de la feature. Mock `fetch` para no salir a red en tests.

**Mocks usados:**
- `vi.stubGlobal("fetch", vi.fn())` en cada test.
- `vi.stubEnv("VERCEL_API_TOKEN", "test-token-mock")` + `vi.stubEnv("VERCEL_PROJECT_ID", "prj_test_mock")` en `beforeEach`.
- `vi.unstubAllEnvs()` + `vi.unstubAllGlobals()` en `afterEach`.

**Casos cubiertos** (≥7, uno por response shape):
- [ ] 200 valid + `verified: true` → `{ok: true, data: {...}}` parsed por Zod.
- [ ] 200 valid + `verified: false` con DNS records → `{ok: true, data: {verified: false, dnsRecords: [...]}}`.
- [ ] 200 partial (campos opcionales ausentes) → Zod schema permite, no falla.
- [ ] 404 (domain no existe) → `{ok: false, reason: "not_configured"}`.
- [ ] 409 (domain already in use por otro proyecto Vercel) → `{ok: false, reason: "domain_already_in_use"}`.
- [ ] 422 (validation error) → `{ok: false, reason: "vercel_error"}`.
- [ ] 429 (rate limit) → `{ok: false, reason: "rate_limited"}`.
- [ ] 500 (server error) → `{ok: false, reason: "vercel_error"}`.
- [ ] Network error (`fetch` rechaza) → `{ok: false, reason: "network"}`.
- [ ] Response malformed (no parsea Zod) → `{ok: false, reason: "vercel_error"}` (no crash).

**Total S2: ≥15 + ≥6 + ≥7 = ≥28 tests nuevos.**

---

## S3 — Server Actions (canon: NO tests directos)

### `src/features/place-settings/types/__tests__/custom-domain.test.ts` (nuevo)

**Por qué importa:** `mapPgErrorToActionError` es la pieza pura del Server Action que mapea Postgres error codes a enum semántico. Bug = UNIQUE violation aterriza como 500 genérico (UX rota).

**Casos cubiertos** (≥4):
- [ ] Error con `code === "23505"` → `"domain_taken"`.
- [ ] Error con código distinto (e.g. `"23502"`) → `"generic"`.
- [ ] Error sin propiedad `code` (e.g. `new Error("boom")`) → `"generic"`.
- [ ] Error null/undefined → `"generic"`.

### Server Actions sin tests directos

**Las 3 Server Actions del slice NO tienen tests vitest directos** (canon del proyecto, `update-default-locale.ts:13`):

- `src/features/place-settings/actions/register-custom-domain.ts`.
- `src/features/place-settings/actions/archive-custom-domain.ts`.
- `src/features/place-settings/actions/get-custom-domain-status.ts`.

**Su correctitud se valida vía:**
- `pnpm typecheck` — zod schemas + signatures + types.
- `pnpm build` — wiring funciona en prod build.
- Smoke vivo en S5 (dev local + preview deploy con `VERCEL_API_TOKEN` real).

**Total S3: ≥4 tests nuevos (solo `mapPgErrorToActionError`).**

---

## S4 — UI `<DomainSection>` + page sub-ruta

### `src/features/place-settings/__tests__/domain-section.test.tsx` (nuevo)

**Por qué importa:** Client Component con 4 estados, form, confirm dialog, copy-to-clipboard, auto-refresh. Cubre el UX end-to-end del owner.

**Mocks usados:**
- `vi.fn()` para `registerAction` + `archiveAction` (seam-split — inyectadas como props).
- `vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn() } })` para copy-to-clipboard.
- `vi.useFakeTimers()` + `vi.advanceTimersByTime(30_000)` para auto-refresh.
- Mock `useRouter` → `{ refresh: vi.fn() }`.

**Casos cubiertos** (≥11):

- [ ] Render en estado `none` con form vacío (input + submit "Vincular dominio").
- [ ] Render en estado `pending` con DNS records table + copia SLA propagación + botón "Remover".
- [ ] Render en estado `verified` con badge "Verificado, SSL activo" + dominio + botón "Remover".
- [ ] Render en estado `error` con notice + form re-enableable.
- [ ] Submit con dominio válido (`comunidad.mi-marca.com`) llama `registerAction` con dominio normalizado (lowercase, trim).
- [ ] Submit con dominio reservado (`place.community`) muestra validation error client-side; NO llama `registerAction`.
- [ ] Submit con IDN (`münchen.de`) muestra validation error "Por ahora aceptamos solo dominios ASCII"; NO llama action.
- [ ] Confirm dialog flow: click "Remover" abre dialog con texto "{slug}.place.community sigue funcionando"; "Cancelar" cierra sin llamar action; "Confirmar" llama `archiveAction`.
- [ ] Copy-to-clipboard en celda DNS (type/name/value) llama `navigator.clipboard.writeText` con el valor exacto (spy).
- [ ] Auto-refresh en estado `pending`: `vi.advanceTimersByTime(30_000)` → `router.refresh()` invocado.
- [ ] Action error response (`{status: "error", reason: "domain_taken"}`) → notice "Ese dominio ya está vinculado a otro lugar de Place" + form re-enableable.

**Total S4: ≥11 tests nuevos.**

---

## Manual smoke checklist (S5)

A correr en dev local antes del push final autorizado:

- [ ] `pnpm dev` levanta sin error.
- [ ] Navegar a `mi-slug.localhost:3000/settings` → click "Dominio" → page `/settings/domain` carga con form vacío.
- [ ] Input `foo` → submit → error "Dominio inválido" (formato).
- [ ] Input `place.community` → submit → error "Dominio reservado".
- [ ] Input `münchen.de` → submit → error "Solo aceptamos dominios ASCII".
- [ ] Input `comunidad.test.com` (válido) → submit → row insertado en DB; UI muestra pending + DNS records (de Vercel API real o mock según `.env.local`).
- [ ] Refresh manual del page → lazy poll a Vercel; si no verificado, sigue pending.
- [ ] Botón "Remover" → confirm dialog → confirm → row archived; UI vuelve a form vacío.
- [ ] Re-submit del mismo dominio post-archive → succeeds (partial unique permite reusar).
- [ ] Idioma: cambiar locale del place → labels del page renderean en nuevo idioma.

---

## Lo que NO probamos (decisión)

- **RLS owner-only de `place_domain`** — ya cubierto en `src/db/__tests__/rls.test.ts` desde ADR-0012. Se hereda sin trabajo nuevo. Si la policy cambia, esos tests fallan — feedback loop OK.
- **Migration 0008 idempotencia** — empíricamente al correr `pnpm db:migrate` dos veces (segunda corrida no rompe). No vitest test.
- **Vercel API real** — los tests de S2 usan mock `fetch`. La integración real se valida en smoke S5 con `VERCEL_API_TOKEN` real.
- **Server Actions con vitest** — canon proyecto (`update-default-locale.ts:13`). Validación vía typecheck + build + smoke vivo.
- **Cron handler S6** — diferible; cuando se implemente tendrá su propio test con mock auth + mock Vercel + mock DB.
- **Performance** — no se mide en vitest. Lazy poll incrementa latencia ~200-500ms en `verified_at IS NULL`; aceptable per ADR-0026.

---

## Coverage acumulado

V1 esperado (sin S6):

- ≥2 tests para schema partial unique (S1 — schema + rls).
- ≥15 tests para `validateCustomDomain` (S2).
- ≥6 tests para `reserved-domains` (S2).
- ≥7 tests para `vercel/domains` (S2 — response shapes con mock fetch + vi.stubEnv).
- ≥4 tests para `mapPgErrorToActionError` (S3 — canon "pieza pura del Server Action").
- ≥11 tests para `DomainSection` (S4 — 4 estados + submit happy + submit invalid local + IDN reject + confirm dialog flow + copy-to-clipboard + auto-refresh fake timers + error notice).
- Tests existentes (locale-section, nav-place-layout, schema, rls) sin regresiones.
- **Server Actions NO tienen tests directos** (canon `update-default-locale.ts:13`).

**Total esperado: 301 + ~45 ≈ 346 tests verde** al cierre de S5.
