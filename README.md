# place

Multi-tenant community platform — cada place es una comunidad con su propio subdomain (`mi-place.place.community`) y, opcionalmente, su custom domain (`micomunidad.com`).

**Stack**: Next.js 16 (App Router, RSC + Server Actions) · React 19 · TypeScript estricto · PostgreSQL (Neon serverless) · Drizzle ORM (schema-as-types) · Neon Auth (Better Auth) · next-intl (6 locales) · Tailwind v4 (layout only — colores via CSS custom properties) · Vitest (1135 tests, node + jsdom projects).

**Deploy**: Vercel · Custom domain SSO via Signed Ticket (ADR-0032) · Apex en `place.community`.

> **Para agentes IA**: leé `CLAUDE.md` primero — define el paradigma, las reglas operativas y los TBDs.

---

## Quick start

```bash
# Pre-requisitos: Node ≥22, pnpm, cuenta Neon (free tier OK)

git clone <repo>
cd place
pnpm install
cp .env.example .env.local
# Editá .env.local con tus connection strings de Neon
pnpm db:migrate         # aplica las 24 migrations al branch Neon
pnpm dev                # http://localhost:3000
```

---

## Prerequisites

- **Node** ≥22 (`.nvmrc` lo declara; `nvm install` o `mise install` lo respetan)
- **pnpm** ≥10 (no npm/yarn — el lockfile es pnpm)
- **Neon** account + project. Free tier alcanza para dev. Necesitás:
  - 1 branch `main` (production), 1 branch `test` (para integration tests CI)
  - Connection strings: rol `app_system` (NO-admin, para runtime) + rol `neondb_owner` (admin, para migrations). Ver `docs/stack.md` §"Variables de entorno"

---

## Setup local detallado

1. **Clonar + dependencias**:
   ```bash
   git clone <repo> && cd place
   pnpm install
   ```

2. **Variables de entorno**: copiá `.env.example` a `.env.local` (gitignored). Cada variable tiene comentario inline con dónde sacarla. Mínimo viable para `pnpm dev`:
   - `DATABASE_URL` (rol `app_system`)
   - `DATABASE_URL_MIGRATE` (rol `neondb_owner`)
   - `NEON_AUTH_BASE_URL=http://localhost:3000`
   - `NEON_AUTH_JWKS_URL=http://localhost:3000/api/auth/jwks`
   - `NEON_AUTH_COOKIE_SECRET` (generar: `openssl rand -base64 48`)
   - `NEXT_PUBLIC_APP_URL=http://localhost:3000`
   - `NEXT_PUBLIC_APP_DOMAIN=localhost`

   Los demás (custom domain SSO, Vercel API, AI Gateway, Resend) son opcionales en dev — el código degrada o skipea los slices que dependen de ellos.

3. **Schema DB**:
   ```bash
   pnpm db:migrate           # corre drizzle-kit migrate contra DATABASE_URL_MIGRATE
   ```
   Las migrations viven en `src/db/migrations/` (canon: `data-model.md` §"Migrations & snapshots").

4. **Dev server**:
   ```bash
   pnpm dev                  # http://localhost:3000 con HMR
   ```

5. **Probar multi-tenancy local**: el proxy interno mapea `*.localhost:3000` → zona-place. Editá `/etc/hosts` (o usá `dnsmasq`/`xip.io`) para resolver `mi-place.localhost` → `127.0.0.1`. La page `/` apex muestra la landing; `/{placeSlug}` muestra el Hub del place.

---

## Scripts

| Script | Qué hace |
|--------|----------|
| `pnpm dev` | Dev server Next con HMR |
| `pnpm build` | Build production (incluye `pnpm db:migrate` en deploy via `scripts/maybe-migrate.mjs`, gated a `VERCEL_ENV=production`) |
| `pnpm typecheck` | `tsc --noEmit` — sin emitir, solo verificar tipos |
| `pnpm lint` | ESLint (flat config en `eslint.config.mjs`) |
| `pnpm test` | Vitest suite full (2 projects: `node` para DB integration tests, `ui` para RTL) |
| `pnpm db:generate` | Drizzle-kit generate desde `src/db/schema/` (solo schema changes; custom SQL se escribe a mano — ver `data-model.md`) |
| `pnpm db:migrate` | Aplica migrations pendientes contra `DATABASE_URL_MIGRATE` |
| `pnpm analyze` | Build con `@next/bundle-analyzer` |
| `pnpm lhci` | Lighthouse CI assertion (corre en `lighthouse.yml` workflow) |

---

## Testing

**Suite vitest**: 1135 tests en 113 archivos. Dos projects (per `vitest.config.ts`):
- **`node`**: integration tests en `src/**/*.test.ts` + `src/db/__tests__/*.test.ts`. Conectan a Neon test branch via `DATABASE_URL_TEST` + `DATABASE_URL_TEST_MIGRATE`. Aíslan per-test con SAVEPOINT + ROLLBACK (`src/db/__tests__/db-test-pool.ts`).
- **`ui`**: tests RTL en `src/**/*.test.tsx`, jsdom environment.

```bash
pnpm test                    # full suite (~8min cold Neon, ~5min warm)
pnpm test --project=node     # solo integration
pnpm test --project=ui       # solo UI
pnpm test src/features/invitations  # filter por path
```

**CI**: `.github/workflows/tests.yml` corre la suite full en cada PR a `main`. Requiere GH secrets `DATABASE_URL_TEST` + `DATABASE_URL_TEST_MIGRATE` (setup instructions en header del workflow).

**Smoke E2E**: actualmente manual (HARs via browser DevTools). Playwright pendiente Phase 2.A (ver `docs/tech-debt-pre-v1.3.md`).

---

## Deploy

**Production**: push a `main` del remote `maxhost` (canónico para Vercel webhook). El deploy auto:
1. Ejecuta `scripts/maybe-migrate.mjs` → `pnpm db:migrate` contra branch `production` de Neon (gated a `VERCEL_ENV=production` per ADR-0017).
2. `cross-env NODE_ENV=production next build`.
3. Vercel sube el output.

**Preview**: push a cualquier branch → Vercel build preview (NO corre migrations — la branch preview Neon se aprovisiona fuera del flujo de deploy).

**Custom domains**: registro programático via Vercel Domains API (`src/shared/lib/vercel/domains.ts`), verificación lazy (ADR-0026). El owner agrega un dominio en `/settings/domain`, configura DNS, el slice resuelve.

**Rollback**: tags `baseline/feature-*-done` marcan estados estables. `git reset --hard <tag>` + push force (con cuidado: avisar primero, no a main si hay tráfico).

---

## Mapa de docs

| Doc | Para qué |
|-----|----------|
| `CLAUDE.md` | **Reglas operativas del proyecto** — paradigma, gotchas críticos, idioma, estilo. Lectura obligatoria para humanos y agentes IA. |
| `docs/producto.md` | Visión + principios de experiencia/diseño (canónico antes de tocar UI). |
| `docs/architecture.md` | Decisiones técnicas estructurales, índice arquitectónico. |
| `docs/stack.md` | Stack técnico detallado + estado de TBDs (storage/realtime/pagos). |
| `docs/data-model.md` | Schema SQL del core + invariantes + convención migrations & snapshots. |
| `docs/multi-tenancy.md` | Routing por subdomain + DNS + middleware + slug inmutable. |
| `docs/ontologia/` | Documentos canónicos de cada objeto del core (miembros, conversaciones, eventos, library). |
| `docs/landingpage/` | Arquitectura + contenido de la landing pública. |
| `docs/features/<slug>/` | Spec + plan-sesiones + tests por feature en construcción. |
| `docs/decisions/` | ADRs históricas con fecha + alternativas rechazadas + consecuencias. Índice en `decisions/README.md`. |
| `docs/gotchas/` | Bugs canónicos no derivables del código que volverían a morder. |
| `docs/tech-debt-pre-v1.3.md` | Tracker de cierre de deuda técnica pre-V1.3 (sesiones + save points + status). |

---

## Arquitectura en 30 segundos

**Modular Monolith con Vertical Slices**:
- Cada feature en `src/features/<slice>/` es autónoma con su propia UI, lógica, datos y tests.
- Las features se comunican entre sí SOLO via `public.ts` (interfaz pública explícita).
- `src/shared/` (componentes/lib/types reutilizables) NUNCA importa de `src/features/`.
- Una feature NUNCA importa directamente de otra — solo de su `public.ts`.

Si tocás esto, leé `CLAUDE.md` §"Paradigma arquitectónico" + `docs/architecture.md`. No improvisar.

---

## Contribuir

- **Issues + PRs en español** (idioma del proyecto). Código en inglés (variables, funciones, types).
- **TDD obligatorio**: tests primero, verificar que fallan, implementar, verificar que pasan.
- **Una PR = una responsabilidad**. Si toca >5 archivos o cruza backend ↔ frontend, dividir en PRs.
- **Pre-commit**: lefthook está armado para correr typecheck + lint sobre archivos staged (pendiente Phase 1.D, hasta entonces correr manual antes de commit).
- **NUNCA `git add -A` ni `git add .`** — siempre por path explícito (anti-leak de secrets).

---

## Soporte

Ante duda: leé el doc canónico que corresponda (mapa arriba) ANTES de improvisar. Si el doc no existe o está desactualizado, **se documenta antes de codear** (canon `CLAUDE.md` §"Documentación primero").
