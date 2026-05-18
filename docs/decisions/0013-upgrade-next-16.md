# 0013 — Cambio de stack: Next.js 15 → 16

- **Fecha:** 2026-05-17
- **Estado:** Aceptada
- **Alcance:** stack (framework), arquitectura (auth wiring — prerequisito de S4)
- **Cierra:** el bloqueo de S4 detectado al diagnosticar (el SDK de auth exige Next ≥16). No supersede ninguna ADR; ajusta `docs/stack.md` ("Next.js 15" → "Next.js 16").

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

Al arrancar S4 (auth wiring, plan `docs/features/onboarding/plan-sesiones.md`) se diagnosticó el terreno antes de implementar (disciplina `CLAUDE.md`). Hallazgo bloqueante, evidencia reproducible del registro npm (no hipótesis):

- El proyecto está pineado a **Next 15.5.18** (`package.json`; `docs/stack.md` "Next.js 15"). `node -p "require('next/package.json').version"` → `15.5.18`.
- El SDK que el plan de S4 manda usar — `@neondatabase/auth` (`createNeonAuth`, route handler `app/api/auth/[...path]`, `auth.getSession()`) — declara `peerDependencies.next` = **`>=16.0.0`** en **todas** sus versiones publicadas (`0.1.0-beta.21` … `0.4.1-beta`; las más viejas incluso `>=16.0.6`). npm nunca reescribe manifests publicados → la "verificación empírica 2026-05-16" de `architecture.md` §56 / `stack.md` §36 se hizo en un probe con Next 16, no contra este repo.
- Sin Next 16 no hay forma soportada de cablear auth, que es **el fundamento** (ADR-0006). El upgrade es prerequisito duro de S4, no parte de S4 (responsabilidad distinta, `CLAUDE.md` "una sesión = una responsabilidad").

Diagnóstico de superficie del upgrade (verificado, no asumido):

- **Next 16.2.6** es el último. Peer `react: ^19.0.0` → `react@19.1.0`/`react-dom@19.1.0` ya satisfacen: **React no se toca**.
- **`next-intl@4.12.0`** (instalado) declara peer `next: … || ^16.0.0`: **ya compatible, sin cambios**.
- **`@next/bundle-analyzer ^16.2.6`**: ya alineado a 16.
- **`eslint-config-next`**: 15.5.18 → 16.2.6 (acompaña a `next`).
- **`src/middleware.ts` → `src/proxy.ts`**: Next 16 renombra el archivo de middleware (el comentario del propio `middleware.ts` ya lo anticipaba). La factory `createMiddleware(routing)` de next-intl y el `matcher` se conservan; solo cambia el nombre del archivo.
- Gotcha vigente sin cambios: `build` usa `cross-env NODE_ENV=production next build` (error falso de `<Html>` con `NODE_ENV=development`).
- Next 16 requiere Node ≥20.9 (deja de soportar Node 18). Vercel corre Node 24.

## Decisión

**Subir el stack a Next.js 16.2.6 como sesión propia, prerequisito de S4.**

1. `package.json`: `next` `15.5.18 → 16.2.6`, `eslint-config-next` `15.5.18 → 16.2.6`. **React, next-intl y bundle-analyzer no se tocan** (ya compatibles/alineados).
2. Renombrar `src/middleware.ts` → `src/proxy.ts` (convención Next 16); conservar `createMiddleware(routing)` y el `matcher`. Actualizar el comentario.
3. Fijar la versión de Node: `.nvmrc` + `engines` en `package.json` (Next 16 exige ≥20.9; Vercel usa 24) — cierra el TBD de `stack.md` §"Versión de Node".
4. **Cierre verde obligatorio:** `pnpm build` (landing intacta, gotcha `NODE_ENV`), `pnpm typecheck`, `pnpm test`, `pnpm lint` en verde antes de commitear. Upgrade controlado y reviewable (superficie chica), **no** codemod interactivo masivo.
5. Actualizar `docs/stack.md` (Next 16 + Node fijado) y `docs/features/onboarding/plan-sesiones.md` (insertar este upgrade como prerequisito explícito de S4, que se retoma después).

## Alternativas rechazadas

- **Forzar `@neondatabase/auth` en Next 15 con `--legacy-peer-deps`/overrides.** Correr el SDK de auth (el fundamento, ADR-0006) fuera de su rango soportado, en beta, es exactamente el tipo de gap que el proyecto no acepta (production-minded). Rechazada.
- **Pinear una versión vieja del SDK compatible con Next 15.** No existe: todas las versiones publicadas exigen Next ≥16. Inviable.
- **Meter el upgrade dentro de S4.** Viola "una sesión = una responsabilidad" (toca landing/i18n/middleware/build, no auth). Es decisión de stack → ADR propia + sesión propia. Rechazada.
- **Diferir auth / saltear S4.** Auth es el fundamento de RLS y de toda la tanda de registro (ADR-0006); diferirlo bloquea S5–S10. Rechazada.

## Consecuencias

- `docs/stack.md`: "Next.js 15 con App Router" → "Next.js 16 con App Router"; cierra el TBD de versión de Node (`.nvmrc` + `engines`).
- `docs/features/onboarding/plan-sesiones.md`: nueva fila/nota de prerequisito de S4 (upgrade Next 16) antes de retomar el auth wiring.
- `architecture.md` §56 / `stack.md` §36: la nota "verificado 2026-05-16 con `@neondatabase/auth@0.4.x`" se lee ahora con el contexto de que el repo recién queda en Next 16 con esta ADR (la ADR es histórica; la nota previa no se reescribe).
- El archivo de middleware pasa a llamarse `src/proxy.ts` — futuras referencias (S7 routing host-based) deben usar ese nombre.
- Sin cambios de React/next-intl → riesgo de regresión acotado a Next-core (build de landing, middleware, config TS). El cierre verde lo cubre.

## Detalle operativo canónico

- Stack y versiones: `docs/stack.md`.
- Plan de sesiones y dependencia con S4: `docs/features/onboarding/plan-sesiones.md`.
- Por qué S4 necesita el SDK: ADR-0006 (modelo rol/JWT, provisión `app_user`), `docs/multi-tenancy.md` §RLS.
