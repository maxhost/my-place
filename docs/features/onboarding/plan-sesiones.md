# Onboarding · plan de sesiones

Plan de implementación de la tanda de registro, dividido en sesiones según `CLAUDE.md` (≤5 archivos / no mezclar capas / TDD en el core / sesiones focalizadas). **Corregido y consistente con ADR-0005 §10.**

> **Corrección importante.** Un split verbal previo decía "routing diferido". **ADR-0005 §10 mete el routing host-based EN el alcance** de esta tanda (estructura `(marketing)`/`(app)`, middleware host-based, wildcard DNS/Vercel) — explícitamente rechaza diferirlo ("Diferir el routing por subdominio … se decidió incluirlo para que el resultado del onboarding sea funcional end-to-end", ADR-0005 §Alternativas rechazadas). Este plan **incluye** el routing como sesión propia. El resultado del onboarding deja el place servible en `{slug}.place.community`.

## Principios del split

- Una sesión = una responsabilidad. Backend y frontend en sesiones separadas. No mezclar capas.
- TDD obligatorio en el core: tests primero, ver fallar, implementar, ver pasar (`CLAUDE.md`). Detalle de casos en `tests.md`.
- DB de test = branch Neon efímero (Postgres con branching, `stack.md`; ver `tests.md`).
- `/compact` al 60% de contexto; si una sesión empieza a tocar >5 archivos o cruzar capas, se subdivide antes de continuar.
- Cada sesión cierra con: tests + typecheck en verde, y reporte de archivos tocados con líneas (`CLAUDE.md` § Después de implementar).

## Dependencias (orden)

```
S1 (infra datos+auth) ──> S2 (dominio: creación place + invitación + RLS) ──┬──> S4 (frontend wizard)
                      └─> S3 (routing host-based + (marketing)/(app)) ───────┘
S2 ──> S5 (capa LLM)  [S5 puede ir en paralelo a S3/S4 una vez cerrado S2]
S6 (aceptación de invitación UI) — OPCIONAL, al cierre; depende de S2 (diseño/vía privilegiada) y S3 (routing del host del link)
```

S1 es fundacional (auth + datos + RLS base); todo lo demás depende de él. S3 y S4 dependen de S2 (necesitan el servicio de creación). S5 depende solo de S2. S6 es opcional/al cierre.

---

## S1 — Infra de datos + auth (fundacional)

**Responsabilidad:** capa de datos Drizzle sobre Neon + Neon Auth integrado + RLS base + `ensureAppUser`. Es el fundamento (ADR-0006 Contexto: "si el usuario no se autentica … las RLS y todas las features se construyen sobre arena").

**Capa:** infra/backend. **No** mezcla frontend.

**Alcance:**
- Cliente Drizzle con driver `neon-serverless` (tx interactiva). Rol Postgres custom no-admin (`pgRole().existing()`); `neondb_owner` solo migraciones. Connection strings en `.env.local` (nunca git).
- Schema Drizzle de `public` (core de `data-model.md`: `app_user`, `place`, `place_domain`, `membership`, `place_ownership`, `invitation`, enums `billing_mode`/`place_subscription_status`). `neon_auth` NO se versiona (library-owned).
- **RLS base (S1)**: policies owner-only de §5 del README sobre `app_user`, `place`, `membership`, `place_ownership`, `invitation`, vía `pgPolicy`/`crudPolicy` + predicados custom, declaradas al rol custom.
- Integración Neon Auth: `createNeonAuth({ cookies: { domain: ".place.community", secret } })`, route handler first-party `app/api/auth/[...path]/route.ts`, verificación JWT con `jose`+JWKS, inyección de claims (`set_config('request.jwt.claims', …, true)`) en la tx.
- `ensureAppUser(authUserId)` como primitivo idempotente de `shared/lib` (dedupeable vía `React.cache`).
- `shared/config/reserved-slugs.ts` (lista canónica de `multi-tenancy.md`).
- Test guard de build: falla si la cookie de sesión se emite sin `Domain` apex.

**Verificación al cerrar:**
- **Empírico en branch Neon**: `auth.user_id()` existe y lee los claims inyectados; el `INSERT` inicial del owner pasa la RLS base (orden de inserción / `WITH CHECK`).
- Probe de cookie apex: **YA verificado empíricamente (2026-05-16)** sobre branch Neon de prueba — `cookies.domain` emite `Domain=.<apex>`; sin él, host-only. No re-hacer; S1 solo cablea `createNeonAuth({cookies:{domain}})` + el test-guard de build. Setup dev HTTPS por el prefijo `__Secure-` (gotcha).
- Tests TDD: RLS con rol no-admin + claims inyectados (aislamiento entre places, deny cross-place); `ensureAppUser` idempotente.
- `pnpm test` + `pnpm typecheck` verdes.

**Riesgo a vigilar:** cache de sesión (~300s) vs `exp` del JWT (README §9.1).

---

## S2 — Dominio: servicio de creación de place + invitación + RLS aplicada

**Responsabilidad:** la saga de creación (Server Action) + el diseño cerrado de invitación (vía privilegiada `SECURITY DEFINER`) + verificación de que la RLS base no rompe el alta ni la aceptación.

**Capa:** dominio/backend. **No** frontend.

**Alcance:**
- Server Action de signup que orquesta la saga (README §3): `auth.signUp.email()` → tx upsert `app_user`+handle random → tx `place`+`place_ownership`+`membership` con invariantes (reserved-slug, slug único, máx 150, mín 1 owner), `theme_config` Zod-validado, `opening_hours` default 09:00–20:00 tz-owner, billing trial (`OWNER_PAYS`/`ACTIVE`/`trial_ends_at=now()+30d`), `enabled_features=[]`.
- Manejo de falla parcial e idempotencia (cuenta sin place = estado "creá tu place", no error fatal; reintento no duplica).
- Generación de handle random no-usado (ADR-0002).
- Validación Zod del payload del submit (slug, colores, descripción, datos de cuenta, timezone).
- Vía privilegiada server-side de aceptación de invitación (`SECURITY DEFINER` o rol controlado de un solo propósito): valida token (existe/no expirado/no usado), email-match estricto con `invitation.email`, `ensureAppUser`, crea `membership` (máx 150, `UNIQUE(user_id,place_id)`), marca `accepted_at`. (El servicio/función; la UI es S6.)

**Verificación al cerrar:**
- Tests TDD: saga happy path; falla parcial (paso 3 falla → cuenta queda, place no); idempotencia (reintento); invariantes (slug reservado/duplicado rechazado, máx 150, mín 1 owner); shapes Zod; vía privilegiada de invitación (token inválido/expirado/usado, email mismatch → rechazo; éxito crea membership y marca accepted_at; RLS owner-only sobre `invitation` no rompe ni creación-por-owner ni aceptación-por-vía-privilegiada).
- `pnpm test` + `pnpm typecheck` verdes.

---

## S3 — Routing host-based + `(marketing)` / `(app)`

**Responsabilidad:** estructura de rutas y middleware host-based (ADR-0005 §10, `multi-tenancy.md`). **En alcance — NO diferido.**

**Capa:** routing/app shell. Sin lógica de dominio (delega a S2) ni UI de wizard (es S4).

**Alcance:**
- Estructura `src/app/(marketing)/` (apex `place.community` → landing/onboarding) y `src/app/(app)/` (`{slug}.place.community` → place; `app.` → inbox). Migrar la landing actual (`src/app/[locale]/`) a `(marketing)` sin romperla.
- `src/middleware.ts` host-based: apex → marketing/onboarding; `{slug}.place.community` → `(app)/[placeSlug]/…`; `app.` → `(app)/inbox/…`. **Integra** el middleware i18n actual (no lo duplica).
- Wildcard DNS/Vercel: `*.place.community → CNAME → cname.vercel-dns.com`; wildcard domain en el proyecto Vercel; Function Region `iad1` (co-locar con Neon `us-east-1`).
- Resolución de place por hostname → slug (custom domains: solo verificados; fuera de alcance de S1 más allá de no romper la resolución).
- El place creado en S2 queda servible en `{slug}.place.community` (página mínima/placeholder del place; el contenido del place es feature futura).

**Verificación al cerrar:**
- Tests: middleware rutea apex/subdominio/`app.` correctamente; landing sigue funcionando bajo `(marketing)`; un slug inexistente → 404; URLs públicas son subdominio (no `placeSlug` en el path — regla de memoria del proyecto).
- `pnpm test` + `pnpm typecheck` verdes; build de la landing intacto (`cross-env NODE_ENV=production`, gotcha de `CLAUDE.md`).

---

## S4 — Frontend del wizard

**Responsabilidad:** la UI del wizard de 3 pasos (README §2), estado client-side, llamada al Server Action de S2.

**Capa:** frontend. Consume el Server Action de S2 y el routing de S3; no implementa lógica de dominio.

**Alcance:**
- Paso 1: nombre + slug con preview de URL + chequeo de disponibilidad en vivo (contra unicidad global + `reserved-slugs.ts` — vía un endpoint/action de solo-lectura; el dura corre en la saga).
- Paso 2: descripción "para quién" + selector de los 3 tokens de color con preview, default Papel, guardrail de contraste (auto-ajustar + avisar); zona de asistencia LLM (consume S5; degrada elegante si LLM no disponible).
- Paso 3: nombre completo + email + password + aceptar términos (links a `/terminos`, `/privacidad`); captura del timezone del browser (README §8, punto a confirmar).
- Estado 100% client-side hasta el submit (Zustand mínimo / RHF + Zod); submit único → Server Action de la saga.
- Estado post-falla-parcial: "creá tu place" (cuenta existe, place no) — pantalla de reintento.
- i18n bajo `[locale]`; tono cozytech (nada grita, sin contadores/urgencia).

**Verificación al cerrar:**
- Tests de componentes: validaciones de cada paso; preview de slug; guardrail de contraste avisa; submit llama al action; estado de reintento.
- `react-best-practices` aplicable (TSX). `pnpm test` + `pnpm typecheck` verdes.
- Revisión contra `producto.md` (principios no negociables) y continuidad visual con la landing.

---

## S5 — Capa LLM (asistencia propose-only)

**Responsabilidad:** integración con Vercel AI Gateway para proponer paleta + borrador de descripción (ADR-0005 §5 ajustado por ADR-0007). Puede ir en paralelo a S3/S4 una vez cerrado S2.

**Capa:** servicio/backend (más una isla cliente mínima en S4 que la consume).

**Alcance:**
- Cliente AI Gateway (`AI_GATEWAY_API_KEY`, string `"provider/model"`, modelo chico/rápido — concreto a fijar acá, TBD acotado ADR-0005).
- Salida estructurada validada por **Zod**: `{ palette: {accent,bg,ink}, descriptionDraft: string }`. **Sin horario** (ADR-0007 §1).
- Propose-only: la salida es propuesta editable; nada se auto-aplica (ADR-0005 §6, `producto.md`). El guardrail de contraste se aplica también a la paleta propuesta por el LLM (README §2 paso 2).
- Degradación elegante: si el LLM falla/no responde, el wizard sigue con el default Papel y edición manual.

**Verificación al cerrar:**
- Tests: el parser Zod rechaza salida malformada; nunca se persiste sin confirmación; la salida no incluye horario; guardrail aplicado a paleta propuesta.
- `pnpm test` + `pnpm typecheck` verdes.

---

## S6 — (Opcional, al cierre) UI de aceptación de invitación

**Responsabilidad:** la pantalla `/invite/{token}` + Server Action que invoca la vía privilegiada de S2. **Punto a confirmar con el humano** si entra en esta tanda o se difiere a una sesión propia inmediatamente posterior (README §10.3).

**Capa:** frontend + thin server action (la lógica de dominio ya está en S2).

**Alcance:**
- Ruta `/invite/{token}` servida en el host del link (`{slug}.place.community/invite/{token}` o custom domain verificado).
- Si no hay cuenta: alta de cuenta (email DEBE coincidir con `invitation.email`, estricto) + `membership`, **sin** crear place.
- Si hay cuenta: aceptar (mismo email-match estricto) + `membership`.
- Errores claros: token inválido/expirado/usado, email mismatch, place lleno (máx 150), ya es miembro.

**Verificación al cerrar:**
- Tests E2E del flujo de aceptación (token válido/ inválido / email mismatch / place lleno).
- `pnpm test` + `pnpm typecheck` verdes.

---

## Resumen

| Sesión | Responsabilidad | Capa | Depende de |
|---|---|---|---|
| S1 | Infra datos+auth: Drizzle/Neon, Neon Auth, RLS base, `ensureAppUser`, reserved-slugs | infra/backend | — |
| S2 | Dominio: saga de creación + vía privilegiada de invitación + RLS aplicada | dominio/backend | S1 |
| S3 | Routing host-based + `(marketing)`/`(app)` + wildcard DNS/Vercel (**en alcance**) | routing/app shell | S1 (S2 para servir el place) |
| S4 | Frontend del wizard de 3 pasos | frontend | S2, S3 |
| S5 | Capa LLM propose-only (paleta + descripción, sin horario) | servicio/backend | S2 |
| S6 | (Opcional, al cierre) UI de aceptación de invitación | frontend + thin action | S2, S3 |

Cada sesión cierra en verde (test + typecheck) y reporta archivos+líneas tocados antes de pasar a la siguiente.
</content>
