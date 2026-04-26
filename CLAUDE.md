# Place

Place es un lugar digital pequeño e íntimo para hasta 150 personas. Es **cozytech**: un espacio tranquilo donde entrás, te ponés al día de lo que pasa, participás si querés, y salís. Como entrar a un pub conocido — no como abrir una red social.

**No es:** un feed con scroll infinito, una app que compite por atención, un producto con notificaciones agresivas, un sistema con métricas de engagement, ni una plataforma con gamificación.

**Es:** un lugar con miembros, conversaciones, eventos y memoria compartida. Donde cada place tiene su identidad visual propia y su propio ritmo.

## Documentos de referencia

Para entender el producto y el proyecto en profundidad, leer en este orden:

- `docs/blueprint.md` — visión de producto y modelo mental
- `docs/architecture.md` — decisiones técnicas, stack, paradigma, schema
- `docs/ontologia/` — documentos canónicos de cada objeto (discusiones, eventos, miembros)
- `docs/features/` — especificaciones detalladas por feature
- `docs/mockups/` — referencia visual viva del producto

## Principios no negociables del producto

Estos principios definen el DNA de Place. Violarlos es violar qué es el producto.

### Sobre la experiencia

- **Nada parpadea, nada grita, nada demanda atención.** La información está disponible para el que mire, nunca se impone.
- **Sin métricas vanidosas.** No se muestran contadores que no aporten al lugar ("47 eventos en memoria", "el más consultado esta semana").
- **Sin urgencia artificial.** Nada de "EN 2 DÍAS", "ÚLTIMA CHANCE", countdowns o similar.
- **Sin gamificación.** No hay streaks, badges, puntos, niveles, rankings, achievements.
- **Sin push notifications agresivas.** El MVP no tiene push notifications. Sumar notificaciones requiere decisión de producto, no técnica.
- **Sin infinite scroll.** Los feeds interminables son el paradigma opuesto.
- **Presencia silenciosa.** Quién está se comunica visualmente (burbuja con borde verde), nunca con texto ansioso ni animaciones.
- **Customización activa, no algorítmica.** El admin del place configura colores. El orden y la personalización son decisión humana, no del algoritmo.

### Sobre la identidad de los miembros

- **Los miembros se manifiestan por lo que hacen**, no por lo que declaran. Sin bios, sin "about me", sin selección curada de identidad.
- **La identidad es contextual.** Lo que sos en un place no viaja a otro. Solo nombre, avatar y handle opcional son universales.
- **Derecho al olvido estructurado.** El contenido que alguien crea queda en el place; su rastro personal se borra al salir; su nombre se desliga del contenido tras 365 días.
- **Sin perfil público fuera de places.** No existe `/user/max`. Si no compartís un place conmigo, no me podés ver.

### Sobre los lugares

- **Máximo 150 miembros por place.** Es un invariante del dominio, no una validación UI. Intentar superarlo falla en el modelo.
- **Cada place tiene identidad visual propia**, configurable por el admin. El producto provee defaults; cada place los personaliza dentro de límites que protegen usabilidad.
- **Cada place tiene su propio horario.** Fuera del horario el place no está accesible: ningún miembro ve contenido (foro, eventos, threads, miembros). Admin/owner mantiene acceso solo a `/settings/*` para poder configurar el horario. El gate vive a nivel del place (`[placeSlug]/(gated)/layout.tsx`), no por feature.
- **Mínimo 1 owner siempre.** Un place no puede quedar sin owner. Transferir ownership requiere que el receptor sea miembro actual.
- **Slug del place es inmutable una vez creado.**

### Sobre la comunicación

- **Las discusiones son turnos editoriales, no chat.** Mensajes largos, pensados, sin presión de respuesta inmediata.
- **Los audios son efímeros.** Se escuchan durante 24 horas, después queda solo la transcripción como texto.
- **Los lectores son parte de la conversación.** Leer es una forma visible de presencia, no lurking invisible.
- **Los temas dormidos no mueren.** Cualquier mensaje reactiva un tema de hace meses al estado vivo.

## Paradigma arquitectónico

**Modular Monolith con Vertical Slices.** El detalle técnico vive en `docs/architecture.md`. La regla de comportamiento es esta:

- Cada feature en `src/features/` es una rebanada vertical autónoma con su propia UI, lógica, datos y tests.
- Las features solo se comunican entre sí a través de una interfaz pública explícita (`public.ts`).
- `shared/` nunca importa de `features/`.
- Una feature nunca importa directamente de otra feature — solo de su `public.ts`.

Si rompés esta regla, rompés el paradigma entero y perdés la capacidad de agregar/quitar features sin efectos colaterales.

## Reglas de vibecoding

Cómo trabajamos con Claude Code en este proyecto.

### Antes de implementar

- **Diagnosticar antes de implementar.** Leer archivos relevantes, reportar estado actual, identificar patrones existentes. Nunca asumir paths, tipos, o convenciones — verificar.
- **Leer la ontología antes de tocar una feature del core.** Discusiones, eventos y miembros tienen documentos canónicos. La implementación los respeta, no los reinterpreta.
- **Spec antes de código.** Features nuevas requieren especificación en `docs/features/` antes de implementarse. La spec describe comportamiento esperado, no implementación.
- **Triple review antes de ejecutar.** Todo prompt se revisa tres veces contra `docs/architecture.md` y `CLAUDE.md` antes de ejecutar.

### Durante la implementación

- **TDD obligatorio.** Tests primero, verificar que fallan, implementar, verificar que pasan. Sin excepciones en el core.
- **Un prompt = una responsabilidad.** Si una tarea toca más de 5 archivos o mezcla backend con frontend, dividir en sesiones separadas.
- **Sesiones focalizadas y cortas.** Backend y frontend en sesiones separadas cuando sea posible. Usar `/compact` al 70% del contexto.
- **Sin libertad para decisiones arquitectónicas.** Las decisiones están en `docs/architecture.md`. Si algo no está claro, pausar y consultar, no improvisar.
- **Nunca asumir el estado del código.** Siempre leer el archivo antes de modificarlo, porque puede haber cambiado desde la última vez que se revisó.

### Después de implementar

- **Cada sesión se auto-verifica.** Correr tests, typecheck, reportar líneas de archivos tocados.
- **Documentar decisiones arquitectónicas.** Cambios que afectan paradigma o estructura se registran en `docs/architecture.md` o `docs/decisions/`.
- **Gotchas compartidos.** Problemas sutiles descubiertos durante el desarrollo se anotan en la sección Gotchas más abajo, para que el contexto persista entre sesiones.

## Límites de tamaño

Acotar el tamaño hace que el código sea auditable por humanos y por agentes. No son cosméticos.

- **Archivos:** máximo 300 líneas
- **Funciones:** máximo 60 líneas
- **Feature completa:** máximo 1500 líneas
- **Servicio/módulo:** máximo 800 líneas

Si algo supera estos límites, se divide antes de continuar.

## Idioma

- **UI del producto, documentación interna, comentarios, mensajes de commit:** español.
- **Código (nombres de variables, funciones, tipos, clases):** inglés.
- **Issues, PRs, discusiones de arquitectura:** español.

## Estilo de código

- **Estado inmutable en React.** Patrón de copia explícita. No mutar in-place.
- **Server Components por default, Client Components solo cuando hacen falta.**
- **Tipos estrictos.** Sin `any`, sin type assertions innecesarios, sin `@ts-ignore` excepto con justificación escrita.
- **Validación con Zod** para todo input externo (forms, API, webhooks).
- **Tailwind solo para layout y spacing.** Los colores del place viven como CSS custom properties configurables por el admin, no como clases Tailwind hardcoded.

## Gotchas

Problemas descubiertos durante el desarrollo. Se actualizan a medida que aparecen.

- **Cambiar `DATABASE_URL` / `DIRECT_URL` requiere reiniciar el dev server.** Next reloca `.env.local` en hot reload, pero el `PrismaClient` vive cacheado en `globalThis` (ver `src/db/client.ts`), así que sigue usando la URL vieja hasta que matás el proceso. Síntoma: cambiás el hostname del pooler, guardás, y `/api/health` sigue tirando el mismo error de conexión.
- **`connection_limit=1` en `DATABASE_URL` es serverless-safe pero serializa queries en dev local.** El default del `.env.example` viene con `?pgbouncer=true&connection_limit=1`. Es intencional para Vercel: cada lambda invocation maneja una sola conexión, multiplexada por el pooler Supavisor. En dev local (no serverless), ese cap **anula la paralelización**: aunque uses `Promise.all` para disparar queries concurrentes, Prisma las ejecuta una por una sobre la única conexión. Síntoma: una page con 8 queries via `Promise.all` tarda igual que 8 secuenciales (~200ms RTT × 8 = 1.6s solo en network). Fix dev: editar `.env.local` y subir a `?pgbouncer=true&connection_limit=10`. **NO** cambiar el `.env.example` ni el valor en prod sin entender la implicación de saturar el pooler. Reiniciar el dev server después del cambio (mismo gotcha del PrismaClient cacheado, justo arriba).
- **Supabase connection string: copiar literal del dashboard.** El hostname del pooler varía entre proyectos (`aws-0-<region>` vs `aws-1-<region>` vs otros) y no es derivable del project ref ni de la región. Siempre ir a Dashboard → Connect → ORMs y pegar el URI exacto, nunca construirlo a mano.
- **Excepción autorizada al cap de 1500 líneas:** el slice `discussions` supera el cap por la densidad inherente del dominio (6 entidades + TipTap AST). Rationale y puntos de revisión (C.F, C.G, posible split de `flags/`) en `docs/decisions/2026-04-20-discussions-size-exception.md`. La excepción no aplica a otros slices sin su propio registro.
- **Resend: el dominio del `From` debe estar verificado en el dashboard.** Si `EMAIL_FROM` apunta a un dominio no verificado, Resend responde `400 validation_error: "The <from> domain is not verified"` y el caller lo recibe como `InvitationEmailFailedError`. La UI muestra el mensaje del error, pero no hay warning a nivel app — verificar DNS (SPF + DKIM + DMARC) en Resend → Domains antes del primer send en cada ambiente (dev cloud, staging, prod). En dev local sin `RESEND_API_KEY`, el mailer cae a `FakeMailer` — loguea el URL a stdout + guarda el payload en memoria. Esto es intencional (dev sin cuenta Resend), no silenciar. Plan completo y ADR: `docs/plans/2026-04-20-members-email-resend.md`, `docs/decisions/2026-04-20-mailer-resend-primary.md`.
- **Slice con queries `server-only` + componentes que viajan al bundle cliente requieren split `public.ts` + `public.server.ts`.** Cuando un Server Component del slice (ej: `CommentItem`) se renderiza bajo un Client Component (ej: `LoadMoreComments`), Next traza todo el `public.ts` al bundle cliente; si `public.ts` re-exporta un módulo con `import 'server-only'`, el build falla con "You're importing a component that needs 'server-only'". Fix: dividir la superficie pública en dos archivos — `public.ts` con lo client-safe (tipos, Server Actions `'use server'`, componentes `'use client'`, schemas, mappers puros) y `public.server.ts` con `import 'server-only'` + re-exports de queries Prisma. Server Components/pages importan de ambos; Client Components sólo del primero. `tests/boundaries.test.ts` acepta `public.server` como entry válido. Caso real: `features/flags/` en C.G. Ver `docs/decisions/2026-04-21-flags-subslice-split.md` § "Boundary client vs server".
- **Supabase Realtime: "Allow public access to channels" debe estar OFF en cada ambiente.** Dashboard → Realtime → Settings → toggle `Allow public access to channels` → OFF. Con ON, un cliente puede abrir un canal sin `{ config: { private: true } }` y bypassear las policies de `realtime.messages`; con OFF, Supabase rechaza cualquier canal no-private y las policies siempre aplican. Nuestro código ya abre todos los canales con `private: true` (ver `thread-presence.tsx`), así que desactivar public access no rompe nada — enforcea la postura robusta. Checklist obligatorio antes del primer deploy con private channels (C.F en adelante). Confirmar con un user sin membership intentando `supabase.channel('post:<id>', {config:{private:true}}).subscribe()` — debe devolver `CHANNEL_ERROR`. Nota: este toggle antes se llamaba "Enable Realtime Authorization" con semántica inversa; Supabase lo renombró y lo movió a Realtime → Settings (no a Project Settings → Realtime).
- **Tests E2E/RLS corren contra `my-place` Cloud (mismo DB que dev). Prefijos reservados `usr_e2e_*` / `place_e2e_*` / emails `/^e2e-.*@e2e\.place\.local$/`.** El seed `tests/fixtures/e2e-seed.ts` es aditivo y wipe FK-safe **sólo** de IDs con prefijo E2E. Crear data manual con esos prefijos pisa el seed. Helper `resetContent(placeKey)` tiene guard defensivo: throw si el placeId no matchea `/^place_e2e_/`. Dev place `the-company` queda intocado entre runs. Ver ADR `docs/decisions/2026-04-22-e2e-rls-testing-cloud-branches.md`.
- **RLS harness usa `DIRECT_URL` (session mode, puerto 5432 del pooler).** `SET LOCAL request.jwt.claims` no persiste en transaction pooler (puerto 6543); el harness lo re-afirma en su header. Cada caso abre tx → seedea como `postgres` super → `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims', …, true)` → ejecuta queries bajo RLS → `ROLLBACK`. Sin firma de JWTs. Patrón oficial Supabase para testing de RLS. Ver `tests/rls/harness.ts`.
- **Endpoint `/api/test/sign-in` devuelve 404 en prod y 404 sin header `x-test-secret` correcto.** Gate doble en el handler: `NODE_ENV === 'production'` → 404 sin leer body; header `x-test-secret !== E2E_TEST_SECRET` → 404 (no 401 — evita enumeración). No eliminar el gate. Test unit cubre 3 paths (`src/app/api/test/sign-in/__tests__/route.test.ts`).
- **E2E local corre en puerto 3001, no 3000.** Para evitar colisión con dev servers de otros proyectos del host. `playwright.config.ts` setea `reuseExistingServer: false` + `pnpm dev --port 3001` + override de `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_APP_DOMAIN` en `webServer.env`. Cookies cross-subdomain siguen OK (`cookie-domain.ts` strippea puerto antes de setear `Domain=lvh.me`).
- **CI `e2e` job crea una branch Supabase efímera por run.** `scripts/ci/branch-helpers.sh` wraps la Management API: `create → poll ACTIVE → fetch env → migrate → seed → test:rls → test:e2e → delete (always())`. Requiere en GH Secrets: `SUPABASE_ACCESS_TOKEN` (scope projects:write,branches:write), `SUPABASE_PROJECT_REF`, `E2E_TEST_SECRET`. `concurrency.cancel-in-progress` evita branches leaked por pushes rápidos. Falla con mensaje explícito si un secret falta — no degrada silenciosamente.
- **`logger.ts` lee `process.env.LOG_LEVEL` y `process.env.NODE_ENV` DIRECTO — no vía `serverEnv`.** Es deliberado. `LOG_LEVEL` está declarado en el schema Zod de `shared/config/env.ts` para que Zod valide su valor (enum pino levels), pero el `logger.ts` NO accede a `serverEnv.LOG_LEVEL`. Razón: el logger se importa desde muchos paths (tests, actions, middleware) — migrar al Proxy `serverEnv` fuerza parse eager del env en cualquier test que importe el logger indirecto, rompiendo decenas de test files que no mockean env completo. Se intentó en 2026-04-21 y se revirtió. **No unificar.** La validación Zod se dispara igual cuando otro código accede a `serverEnv`. Si alguien intenta "limpiar" esto, va a romper ~7 test files con `[env] server env invalid` en cascada.
- **Vercel Cron usa GET (no POST) — `vercel.json` no soporta method/headers/body.** El patrón correcto es `export async function GET(req: NextRequest)` en el route handler. Vercel inyecta `Authorization: Bearer <CRON_SECRET>` automáticamente si el env var está configurada. **Vercel NO reintenta 5xx** — si el cron falla, se pierde hasta el próximo schedule. Mitigación: segundo cron de audit (ej: `/api/cron/erasure-audit` semanal) que cuente backlog y loguee warn. También: **Vercel puede duplicar eventos** — los handlers deben ser idempotentes + usar advisory lock Postgres (`pg_try_advisory_lock`) si la concurrencia importa. `runtime = 'nodejs'` + `maxDuration = 300` explícitos en el route (default puede romperse en upgrades de Next). Ver ADR `docs/decisions/2026-04-24-erasure-365d.md` (primer cron del repo, precedente para futuros). **Instant Rollback de Vercel NO actualiza crons** — si se rollbackea un deploy que cambió `vercel.json`, los schedules viejos siguen.
- **`CRON_SECRET` es obligatorio en producción (validado en `env.ts:assertProductionMailerConfig`).** Mínimo 32 chars (`openssl rand -hex 32`). En dev es opcional; sin él, el endpoint `/api/cron/erasure` retorna 401 a cualquier request (incluso con header correcto). Rotación: runbook de doble-secret 7 días documentado en ADR. Comparación timing-safe con `crypto.timingSafeEqual` (no `===`).
- **`quotedSnapshot.authorLabel` es inmutable — asimetría histórica intencional.** Cuando un comment cita a otro, `buildQuoteSnapshot` congela `authorLabel` al momento de citar (vive en `Comment.quotedSnapshot JSONB`). Si luego el author del comment citado deja el place y pasa por erasure 365d → su `authorSnapshot.displayName` se renombra a "ex-miembro", pero el `quotedSnapshot.authorLabel` en los comments que lo citaron **sigue mostrando el nombre original**. Esto es deliberado: el snapshot de la cita es un snapshot histórico del momento de la cita. No se retro-anonimiza porque implicaría scan + UPDATE de cada cita que referencie al ex-miembro, y rompería la semántica "snapshot congelado" del sistema de citas. Documentado en `docs/decisions/2026-04-24-erasure-365d.md` § "Alternativas descartadas".

## Qué hacer cuando tengas dudas

Si en algún momento de la implementación pensás que vale la pena desviarte de estos principios, del paradigma, o de una decisión en `docs/architecture.md`:

1. Pausá. No implementes la desviación.
2. Consultame el motivo.
3. Si acordamos la desviación, la registramos en `docs/decisions/` con fecha y razón.
4. Recién ahí implementás.

Nunca tomes una decisión arquitectónica solo durante una sesión de código.
