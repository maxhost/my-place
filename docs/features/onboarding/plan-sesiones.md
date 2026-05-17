# Onboarding · plan de sesiones

Plan de implementación de la tanda de registro, **reescrito 2026-05-17** sobre la doc ya coordinada (ADR-0001, 0004–0010; auditoría de coherencia aplicada). Reemplaza el plan previo (S1 era demasiado grande y precedía a ADR-0008/0010).

## Disciplina de trabajo (obligatoria, toda sesión)

- **Una sesión = una responsabilidad.** ≤5 archivos núcleo, no mezclar capas (backend/frontend/routing en sesiones separadas). Si una sesión empieza a exceder esto → subdividir antes de seguir (`CLAUDE.md`).
- **Commit ANTES de empezar cada sesión.** Punto de rollback: si la sesión sale mal, `git reset` al commit previo. El commit previo es el cierre verde de la sesión anterior.
- **`/compact` ANTES de pasar a la siguiente** sesión → entrar con ventana de contexto libre. Cada sesión está pensada para entrar entera en una ventana.
- **TDD obligatorio en el core** (`CLAUDE.md`): test primero → ver fallar → implementar → ver pasar. Casos en `tests.md`.
- **Cierre de sesión:** `pnpm test` + `pnpm typecheck` en verde, reporte de archivos+líneas tocados, doc actualizada si cambió una decisión. Recién ahí se commitea y se compacta.
- **Sin código de auth/RLS bajo el rol admin.** Tests de RLS corren bajo `app_system`, nunca `neondb_owner` (falso verde por `BYPASSRLS`).
- **Verificación browser/cookies/subdominios/custom-domain = preview de Vercel** (dominio real + dominios de prueba), NO localhost (gotcha `__Secure-`). Tests de lógica/RLS = Vitest local contra branch `test` de Neon. Sin mkcert.

## Branches Neon (decidido)

`production` (intocable) · `dev` (una; solo schema consolidado; ahí se escriben migraciones) · `test` (una; se resetea/re-migra entre corridas). dev→prod = aplicar los **mismos archivos de migración** Drizzle a `production` (no se mueven branches).

## Mapa de sesiones y dependencias

```
S0 Harness+entorno ─> S1 Schema ─> S2 RLS ─> S3 Auth wiring ─┬─> S4 Saga creación ─┬─> S7 Wizard place-first ─> S8 Vía "Acceso"
                                                              ├─> S5 Invitación fn  │
                                   S1 ─> S6 Routing host-based ┘ (S4 para servir)   └─> S9 Capa LLM
```

Diferido a sesión propia POSTERIOR (no en esta tanda): UI `/invite/{token}`, directorio, gate de horario.

---

## S0 — Harness de tests + entorno (prerequisito, sin código de producto)

**Capa:** infra/tooling. **Responsabilidad:** dejar el terreno listo para TDD.

- Vitest (unit/integration, jsdom) + scripts `test`/`typecheck`. Playwright queda para E2E posterior.
- Branches Neon `dev` y `test` (vía MCP). Rol **`app_system`** (no-admin, sin `BYPASSRLS`) creado en `dev` y `test` con sus GRANT (CRUD sujeto a RLS + `EXECUTE` de funciones privilegiadas + `USAGE public`; sin DDL, sin `neon_auth`). String admin (`neondb_owner`) solo para migraciones.
- Deps: `drizzle-orm`, `drizzle-kit`, `@neondatabase/serverless`, `jose`, `vitest`. `.env.local` (string `app_system` para runtime/test; string admin separado para migraciones — nunca en git).
- Estrategia de DB de test: branch `test` reseteado (re-migrado/truncado) entre corridas; documentar el comando.
- Verificación empírica mínima en un branch: `auth.user_id()` existe y `set_config('request.jwt.claims',…)` lo alimenta.
- **Cierre:** un test trivial corre bajo `app_system` contra `test`; `pnpm test`+`typecheck` verdes.

## S1 — Schema `public` + migraciones (backend, schema)

**Responsabilidad:** expresar el core de `data-model.md` en Drizzle. **Sin RLS** (es S2) y sin auth.

- Schema Drizzle: `app_user`, `place`, `place_domain`, `membership`, `place_ownership`, `invitation` + enums `billing_mode`/`place_subscription_status`; `gen_random_uuid()` PK; shapes JSON (`theme_config`, `opening_hours`) tipados. `neon_auth` NO se versiona.
- `shared/config/reserved-slugs.ts` (lista de `multi-tenancy.md`).
- Migración generada (`drizzle-kit`); aplicar a `dev` y `test`.
- **Cierre:** migración aplica limpia e idempotente; schema == `data-model.md`; tests de migración verdes.

## S2 — RLS por-operación (backend, seguridad — núcleo crítico)

**Responsabilidad:** las policies de ADR-0010. Es el punto que si falla, nada sirve.

- `app_user` (todas): propia fila. `place`/`membership`/`place_ownership` INSERT: autenticado + `WITH CHECK` self-only; SELECT/UPDATE/DELETE: owner-only. `invitation`: 100% owner-only. Declaradas a `app_system`.
- Verificación empírica de `auth.user_id()` + inyección de claims en tx.
- **TDD (bloqueante):** aislamiento entre places (deny cross-place); `WITH CHECK` self-only rechaza INSERT a nombre de otro / en place ajeno; `app_user` solo propia fila; `invitation` no escaneable por no-owner; todo bajo `app_system`, nunca admin.
- **Cierre:** tests RLS verdes.

## S3 — Auth wiring (backend/infra)

**Responsabilidad:** Neon Auth ↔ Postgres (identidad → RLS).

- `createNeonAuth({ cookies:{ domain, secret } })`, route handler first-party `app/api/auth/[...path]`, helper `getAuthenticatedDb` (verifica `session.access_token` con `jose`+JWKS → `set_config('request.jwt.claims',…,true)` en tx, driver `neon-serverless`).
- `ensureAppUser(authUserId)` primitivo idempotente en `shared/lib` (dedupe `React.cache`).
- Test-guard de build: falla si la cookie de sesión se emite sin `Domain` apex.
- **TDD:** `ensureAppUser` idempotente; sesión→claims→RLS end-to-end (lógica, contra `test`); test-guard dispara. Verificación cookie/cross-subdomain → preview Vercel (anotado, no localhost).
- **Cierre:** verdes.

## S4 — Saga de creación de place (backend/dominio)

**Responsabilidad:** el Server Action de creación, **dos modos** (ADR-0008).

- Modo place-first (CTA): `signUp` → `app_user`+handle → tx place+ownership+membership. Modo authed (Acceso→"Crear mi place"): identidad+`app_user` ya existen (`ensureAppUser`) → solo tx de place. Falla parcial/idempotencia (cuenta sin place = estado "creá tu place").
- Invariantes (reserved-slug, slug único, máx 150, mín 1 owner), `theme_config` (paleta acotada + guardrail contraste server-side), `opening_hours` default 09–20 tz-owner, billing trial, `enabled_features=[]`. Zod del payload.
- **TDD:** happy path ambos modos; falla parcial; idempotencia; invariantes; Zod; guardrail.
- **Cierre:** verdes.

## S5 — Invitación: función `SECURITY DEFINER` + RLS (backend/dominio)

**Responsabilidad:** el mecanismo token-link de ADR-0010 (sin UI).

- Función `SECURITY DEFINER` (dueño = rol privilegiado; `EXECUTE` solo `app_system`): validar token (existe/no vencido/no usado) + email-match estricto + `ensureAppUser` + `membership` (máx 150, `UNIQUE`) + **test-and-set atómico** de `accepted_at`. Owner crea/revoca invitaciones (base owner-only).
- **TDD:** token inválido/expirado/usado; email mismatch; **doble aceptación simultánea → una gana**; éxito; `invitation` no escaneable por el invitado.
- **Cierre:** verdes.

## S6 — Routing host-based + `(marketing)`/`(app)` (routing/app-shell)

**Responsabilidad:** estructura de rutas y middleware por host (ADR-0005 §10). Sin dominio (delega a S4) ni UI de wizard (S7).

- `src/app/(marketing)/` (apex) y `(app)/` (`{slug}.` place; `app.` inbox). Migrar la landing actual a `(marketing)` sin romperla. `src/middleware.ts` host-based **integrando** i18n. Wildcard DNS/Vercel; Function Region `iad1`. Place servible en `{slug}.place.community` (placeholder).
- **Tests:** rutea apex/subdominio/`app.`; landing intacta; slug inexistente→404; URLs públicas = subdominio (regla de memoria).
- **Cierre:** verdes; build de landing intacto (`cross-env NODE_ENV=production`).

## S7 — Frontend wizard place-first (frontend)

**Responsabilidad:** UI del wizard 3 pasos (CTA). Consume S4/S6.

- Paso 1 nombre+slug (preview + disponibilidad en vivo, no autoritativa). Paso 2 descripción+paleta acotada (preview, default Papel, guardrail avisa) — sin LLM aún (S9). Paso 3 cuenta + T&C + timezone del browser (fallback fijo). Estado client-side hasta submit. Estado "creá tu place" post-falla.
- **Cierre:** tests de componentes; revisión `producto.md` (cozytech) + continuidad visual con landing; `react-best-practices`.

## S8 — Vía "Acceso": login form + account-first + modo authed (frontend + thin)

**Responsabilidad:** la segunda vía (ADR-0008). Consume S3/S4/S7.

- Item "Acceso" en el menú de la landing. Form login/signup account-first → "Crear mi place" (reusa wizard SIN paso de cuenta; saga modo authed) / "Unirme" = solo directorio → **deshabilitado/"próximamente"**. Invitaciones NO desde acá (van por su token-link).
- **Cierre:** tests del form + ramificación; modo authed no re-pide cuenta.

## S9 — Capa LLM propose-only (servicio + isla mínima)

**Responsabilidad:** asistencia LLM (ADR-0005 §5 / ADR-0007). Paralelizable tras S4.

- Cliente Vercel AI Gateway (`AI_GATEWAY_API_KEY`, modelo chico — fijar acá). Salida Zod `{ palette:{accent,bg,ink}, descriptionDraft }` — **sin horario**. Propose-only (nada se auto-aplica); guardrail de contraste también sobre la paleta propuesta. Degradación elegante si el LLM falla.
- **Cierre:** parser Zod rechaza malformado; nunca persiste sin confirmación; sin horario; guardrail aplicado.

---

## Resumen

| Sesión | Responsabilidad | Capa | Depende de |
|---|---|---|---|
| S0 | Harness + entorno (Vitest, branches, rol `app_system`) | infra | — |
| S1 | Schema `public` + migraciones | backend/schema | S0 |
| S2 | RLS por-operación (núcleo crítico) | backend/seguridad | S1 |
| S3 | Auth wiring (Neon Auth↔RLS, `ensureAppUser`) | backend/infra | S2 |
| S4 | Saga de creación (dos modos) | backend/dominio | S3 |
| S5 | Invitación: función `SECURITY DEFINER` | backend/dominio | S3 |
| S6 | Routing host-based + `(marketing)`/`(app)` | routing/app-shell | S1 (S4 para servir) |
| S7 | Wizard place-first | frontend | S4, S6 |
| S8 | Vía "Acceso" + modo authed | frontend | S7 |
| S9 | Capa LLM propose-only | servicio | S4 |

Diferido a sesión propia posterior: UI `/invite/{token}`, directorio, gate de horario.

Cada sesión: **commit antes de empezar** → trabajo TDD → **cierre verde** (test+typecheck+reporte) → commit → **`/compact`** → siguiente.
