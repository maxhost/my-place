# Gotchas

Problemas operativos sutiles descubiertos durante el desarrollo. Cada entry describe un comportamiento contraintuitivo o una convención que **rompe silenciosamente** si se viola, sin signal claro en el código o en los logs.

**Cuándo leer:** antes de tocar áreas como CSP, RLS, Vercel Cron, Supabase pooler/Realtime, Resend, env vars del logger, Prisma connection settings, o E2E/CI.

**Cuándo agregar:** cuando descubrís un comportamiento que (a) no es derivable del código, (b) tiene un síntoma confuso, y (c) volvería a morder a alguien en el futuro. Crear `docs/gotchas/<topic-slug>.md` con título + síntoma + fix + (opcional) por qué. Sumar acá una línea.

## Build, runtime y deploy

- [CSP estricta + Zod 4 jitless](csp-strict-zod-jitless.md) — sin `z.config({ jitless: true })` el JIT de Zod throwea bajo CSP de prod.
- [Vercel Cron usa GET, no POST](vercel-cron-get-only.md) — `vercel.json` sin method/headers/body, no reintenta 5xx, puede duplicar eventos.
- [`CRON_SECRET` obligatorio en prod](cron-secret-prod.md) — mínimo 32 chars, validado en `env.ts`, comparación timing-safe.

## Database (Prisma + Supabase)

- [DATABASE_URL/DIRECT_URL requiere reiniciar dev server](database-url-prisma-cache.md) — PrismaClient cacheado en `globalThis`.
- [`connection_limit=1` serializa queries en dev](prisma-connection-limit.md) — serverless-safe pero rompe `Promise.all` local.
- [Supabase connection string: copiar literal del dashboard](supabase-connection-string.md) — el hostname del pooler no es derivable.

## Realtime y RLS

- [Supabase Realtime: "Allow public access to channels" OFF](supabase-realtime-private-channels.md) — checklist obligatorio antes del primer deploy con private channels.
- [RLS harness usa DIRECT_URL session mode](rls-harness-direct-url.md) — `SET LOCAL request.jwt.claims` no persiste en transaction pooler.
- [Supabase Realtime: `channel(topic)` dedupea — presence + broadcast en mismo topic colisionan](supabase-channel-topic-collision.md) — usar suffix dedicado (`post:<id>:presence`) cuando varias features comparten dominio.

## Tests (E2E + CI)

- [E2E/RLS corren contra Cloud con prefijos reservados](e2e-rls-cloud-prefixes.md) — `usr_e2e_*` / `place_e2e_*` / emails `e2e-*@e2e.place.local`.
- [Endpoint `/api/test/sign-in` doble gate 404](test-signin-endpoint.md) — 404 en prod + 404 sin `x-test-secret` (evita enumeración).
- [E2E local en puerto 3001](e2e-port-3001.md) — evita colisión con otros dev servers; cookies cross-subdomain OK.
- [CI crea branch Supabase efímera por run](ci-supabase-branch.md) — Management API + GH Secrets requeridos.

## Email

- [Resend: dominio del `From` debe estar verificado](resend-domain-verification.md) — DNS (SPF + DKIM + DMARC) por ambiente; dev local cae a `FakeMailer`.
- [Supabase Auth manda magic links via SMTP de Resend](supabase-smtp-resend.md) — config separada del `EMAIL_FROM` del app; al cambiar dominio hay que actualizar dos lugares.

## Arquitectura del repo

- [Slice con `server-only` + bundle cliente requiere `public.server.ts`](public-server-split.md) — split obligatorio cuando un Server Component se renderiza bajo un Client Component.
- [Excepción al cap de 1500 líneas en `discussions`](discussions-size-exception.md) — única excepción autorizada; otros slices requieren ADR propio.

## Convenciones de código

- [`logger.ts` lee `process.env` directo, no via `serverEnv`](logger-env-direct-read.md) — deliberado, no unificar (rompe ~7 test files).
- [RHF `register` + `onChange` custom requiere `setValue`](rhf-register-onchange.md) — el spread de RHF se sobreescribe; usar `setValue(name, v, { shouldDirty: true })`.

## Dominio

- [`quotedSnapshot.authorLabel` es inmutable](quoted-snapshot-author-label.md) — asimetría histórica intencional con erasure 365d.
