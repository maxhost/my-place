# 0047 — Observability stack: Sentry (Vercel-native integration) + wrapper `log.*`

- **Fecha:** 2026-05-28
- **Estado:** Aceptada
- **Alcance:** Tech debt Phase 0.E1 (de `docs/tech-debt-pre-v1.3.md`). Decisión del stack de observability (error tracking + structured logging) para V1, dependencia, env vars, wrapper canonical, ubicación de archivos init de Sentry, y la convención del API `log.*` que reemplaza el patrón ad-hoc `console.*` distribuido en 26 callsites (12 archivos) post-V1.2.
- **Habilita:** error tracking real en producción (uncaught + manual via `log.error`) con stack traces source-mapped, dedupe por fingerprint, breadcrumbs, y request context auto-attached. Cierra el gap de "los `console.error` en paths fail-safe son invisibles en Vercel logs después de 24h" — la deuda histórica que dejó al equipo dependiendo de `feeling` para issues como Bug D (SSO chain warm-up, Phase 4 backlog) en lugar de datos de incidencia.
- **Refina:** ningún ADR previa (observability NO estaba decidida — era TBD implícito post-reset). Cierra esa lacuna.
- **No supersede:** ninguna ADR previa.

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

### El gap detectado

Audit post-V1.2 cierre (commit `3be5eec`, 2026-05-28) confirmó:

- **26 callsites de `console.*` en 12 archivos de `src/`** (excluyendo tests). 25 son `console.error`, 1 es `console.warn` (rate-limit startup, Phase 0.D).
- **Cero callsites de `console.log` debug spam** — hygiene del codebase ya está limpia. Los `console.error` son intencionales en patrón "fail-safe to null + log error" (lookups RSC) o en catch blocks de Server Actions cross-domain (SSO chain, invite flow, custom-domain registration).
- **Cero error tracking en producción** — los logs de Vercel rotan (24h en plan Hobby) y no agrupan por fingerprint. Un error que ocurre 1×/día en un edge case nunca emerge a la consciencia operativa.
- **Cero source maps uploaded** — los stack traces que el browser/Vercel logs muestran tienen los nombres minificados de `.next/static/chunks/abc123.js:1:45678`, ininterpretables.
- **Sin instrumentation hook** — `src/instrumentation.ts` no existe. Sin él no hay forma de hookear inicialización server-side (Next 16 instrumentation API es el seam canónico).

### Threat model V1

Los errores que QUEREMOS atrapar en V1:
- **Server Action throws** uncaught en Hub (lectura DB, mutación) — hoy retorna 500 sin contexto al user.
- **Route handler throws** en `/api/auth/sso-init`, `/api/auth/sso-issue`, `/api/auth/sso-redeem` — la cadena SSO cross-domain tiene 3 hops + JWT crypto, los errors son opacos sin breadcrumbs.
- **RSC throws** en page tree (lookup DB falla durante render). Hoy se manifiestan como 500 página + nada en stderr Vercel después de 24h.
- **Client errors** en boundary `error.tsx` (per-segment) y en `global-error.tsx` (root) — Server-rendered React errors que crashean re-hidratación.
- **Fail-safe paths intencionales** (los 12 archivos con `console.error`) — NO son crashes pero SÍ son señales de problemas que deberían visibilizar (e.g. DB schema drift en `place-locale-lookup`, malformed Zod input en `invitation-preview-lookup`).

Lo que NO querer atrapar V1:
- **`log.info` para audit trail** — no tenemos casos de uso V1. Aparece en V1.3+ con audit logs de admin actions (membership transfers, place ownership changes).
- **APM / distributed tracing** — diferible. El threat model V1 es "errores agrupados con contexto", no "P99 latency de Server Action X". Cuando aparezca el caso de uso, Sentry Performance se activa con un flag.
- **Uptime monitoring / status page** — diferible V2. Vercel uptime nativo cubre infraestructura; status page externo es valor cuando hay usuarios externos esperándolo.

### Escala de tráfico V1

Pre-launch + early-launch:
- **Errores estimados V1**: <100/día (mayoría rate-limited tras Phase 0.D + edge cases de SSO).
- **Free tier de Sentry**: 5k errors/mes = 166/día. Cubre V1-V2 con margen 1.6× sobre estimación conservadora.
- **Cost si V1.3 explota a 10k errors/mes**: $26/mes Team plan (50k errors). Negligible vs. el costo de operar sin observability.

## Decisión

**Stack: Sentry como único provider de observability V1.**

Composición concreta:

1. **`@sentry/nextjs` SDK** (latest, Next 16 compatible) — wrappers oficiales de Next.js para client + server (Node.js) + edge runtime.

2. **Vercel Marketplace install** — la integración oficial Sentry × Vercel sincroniza `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` a env vars Vercel (Prod + Preview scopes) automáticamente. El user instala desde Vercel dashboard (~5min); este repo NO commitea ninguno de esos secrets.

3. **Archivos init (Next 16 convention)**:
   - `src/instrumentation.ts` — `register()` hook que dispatcha por runtime (`process.env.NEXT_RUNTIME === "nodejs" → import sentry.server.config`, `=== "edge" → import sentry.edge.config`). Es el hook canónico Next 16 para inicialización server-side cold start.
   - `src/instrumentation-client.ts` — init client-side. Sentry SDK detecta este archivo automáticamente y lo wrapea durante build.
   - `sentry.server.config.ts` (raíz repo) — `Sentry.init({...})` para runtime Node.js. Sentry SDK convention.
   - `sentry.edge.config.ts` (raíz repo) — `Sentry.init({...})` para runtime Edge. Sentry SDK convention.
   - `src/app/global-error.tsx` — Next 16 root error boundary. Captura errores que crashearon el render del root layout. Llama `Sentry.captureException(error)` en `useEffect` mount.

4. **Wrapper `src/shared/lib/observability/log.ts`** — API minimal:
   ```ts
   log.info(meta: LogMeta, message: string): void
   log.warn(meta: LogMeta, message: string): void
   log.error(err: unknown, meta: LogMeta, message: string): void
   ```
   Mapping:
   - `log.info` → SOLO `console.info` structured JSON (NO Sentry — evitar quota burn; V1 sin caso de uso real para info → Sentry).
   - `log.warn` → `console.warn` + `Sentry.captureMessage(message, { level: "warning", extra: meta })`.
   - `log.error` → `console.error` + `Sentry.captureException(err, { extra: { message, ...meta } })`.
   - Sentry calls envueltos en `try/catch` — un blip de la SDK NUNCA debe romper el caller path (defense-in-depth; el contrato del SDK ya garantiza no-throw, pero la app es más importante que el logger).

5. **`next.config.ts` wrap con `withSentryConfig`** — habilita upload automático de source maps durante build (sólo en CI con `SENTRY_AUTH_TOKEN` presente; en dev local sin token, skip silencioso).

6. **Behavior por entorno (mismo patrón que rate-limit Phase 0.D)**:
   - **Production (`NODE_ENV === "production"` o `VERCEL_ENV === "production"`) sin `SENTRY_DSN`** → la SDK init es no-op (Sentry SDK behavior). NO crashea, pero todo `captureException` es silent drop. Riesgo aceptado V1: el primer deploy SIN env var sincronizada se ve normal pero perdemos visibilidad. Mitigación: documentar en `.env.example` + `docs/stack.md` que la integración Vercel-side debe completarse pre-deploy. (NO aplicamos fail-loud-prod aquí como en rate-limit porque Sentry no es un control de seguridad — perder observability es un degradado de operations, no una brecha. Ver §"Alternativas rechazadas" — γ.)
   - **Dev/local sin `SENTRY_DSN`** → SDK init no-op. Los `log.*` siguen funcionando vía `console.*` para developer feedback.
   - **Cualquier entorno con DSN** → enforce normal: errores van a dashboard Sentry con stack trace source-mapped + breadcrumbs + tags.

7. **Convention para los 26 callsites (E2 de Phase 0.E)**:
   - `console.error("[ctx] msg", err)` → `log.error(err, { scope: "ctx", ...meta }, "msg")`.
   - JSDoc references a `console.error` en los archivos afectados se actualizan a `log.error`.
   - El único `console.warn` (rate-limit startup) → `log.warn({ scope: "rate-limit" }, "Upstash creds missing — skipping in dev")`.

### Por qué Sentry (vs alternativas)

- **Vercel-native integration**: setup en ~5min vía Marketplace (env vars auto-sync), wrappers oficiales para Next.js (client + server + edge), source maps automáticos. La fricción de operación es mínima — crítico para que la observability se *use* y no se abandone.
- **Error grouping por fingerprint**: dedupea variantes del mismo error (e.g. mismo stack + diferentes `req.url`) en una "issue" agrupada. Sin esto el dashboard es ruido. Sentry es industry standard precisamente por la calidad del grouping.
- **Breadcrumbs**: cada `log.info` (vía `Sentry.addBreadcrumb` future) o cada navegación cliente o cada fetch deja una huella. Cuando un error explota, ves los 30 últimos eventos como cintas de eventos. Crítico para debugging Server Actions que fallan en branches específicos.
- **Source maps**: stack traces de prod son legibles. Sin esto, `at Object.<anonymous> (.next/server/chunks/abc.js:1:54321)` es opaco; con esto, ves el archivo TS original con línea exacta.
- **SDK Next.js 16 maduro**: la integración oficial cubre RSC, Server Actions, Edge middleware (`proxy.ts`), client-side hydration errors, todo desde una sola instalación. No estamos pre-alpha en compatibilidad.
- **Free tier suficiente para V1-V2**: 5k errors/mes cubre ~10× el estimado conservador (100/día = 3k/mes).
- **Future eject path low-cost**: el wrapper `log.*` aísla los call sites de la API Sentry. Si en V3+ migramos a OpenTelemetry / DataDog / etc., los 26 callsites siguen siendo `log.*` — sólo cambiamos la implementación del wrapper. Reversibilidad arquitectónica baja.

## Alternativas rechazadas

- **α — BetterStack (ex-Logtail) solo**. Logs + uptime + status page all-in-one. Excelente UX para queries SQL-like sobre logs structured (`log.info`-heavy patterns). **Rechazada porque**: el caso de uso V1 NO es log search (cero callsites informativos), es error grouping. BetterStack error tracking es más débil que Sentry: no breadcrumbs, no replay, no agrupación inteligente por fingerprint. Pagaríamos $25/mes por features que no usamos (uptime — diferible V2) y aceptaríamos una primitiva de error tracking peor. Reconsiderar V2 si aparece need de log volume + uptime monitoring externo.

- **β — Axiom solo**. Event-based log store con free tier brutal (500GB logs/mes ingest, 30 días retention). Integración Vercel Log Drains nativa (intercepta stdout de Vercel sin código). **Rechazada porque**: es store + query layer, no error tracker. Para hacer "ver los errores más frecuentes agrupados con stack trace" hay que armar dashboards custom + queries — DIY observability. No tiene primitive Sentry-like de "issue grouping" out-of-the-box. Sentido si el bottleneck fuera "tenemos demasiados logs y no podemos guardarlos todos" — no es nuestro caso V1.

- **γ — Híbrido Sentry + Axiom desde el día 1**. Sentry para errores, Axiom para logs structured. Best-of-both en theory. **Rechazada porque**: doble setup, doble dashboard, doble cognitive overhead. Para 26 callsites (todos `error/warn`, cero `info`) es overkill. Si Phase 2.* trae need de log volumes altos (audit logs admin actions, member activity tracking, etc.) agregamos Axiom vía Vercel Log Drain SIN tocar código — Sentry sigue catching errors, Axiom ingiere todo stdout sin overlap. Decisión activable en demanda, no requiere arquitectura pre-built.

- **δ — Fail-loud prod sin SENTRY_DSN (igual que rate-limit)**. Throw en `sentry.server.config.ts` si DSN missing en prod. **Rechazada porque**: Sentry NO es control de seguridad. Sin rate limit, atacantes pueden brute-forcear login (impacta CIA — confidentiality + integrity). Sin Sentry, perdemos visibilidad operacional pero NO comprometemos al usuario. El trade-off costo/beneficio de bloquear deploys por observability missing es desproporcionado. Mitigación al riesgo "primer deploy sin DSN sincronizada" → documentación explícita + checklist Phase 0 closure.

- **ε — DIY logger sin provider externo** (Winston/Pino → stdout, parseado por Vercel Logs UI). **Rechazada porque**: Vercel Logs rotan 24h en plan Hobby, no agrupan por fingerprint, no upload source maps. Para casos como Bug D (SSO chain warm-up cold ~2.7s) jamás tendríamos el dato porque sucede 1×/día → invisible al rotar logs. La promesa "Sentry mismo es DIY-able" subestima el valor del grouping inteligente que es lo que hace que el dashboard sea actionable vs noise.

- **ζ — DataDog APM / OpenTelemetry desde el día 1**. Stack enterprise con full distributed tracing. **Rechazada porque**: ~$15-31/host/mes solo APM, sin contar logs/metrics. V1 no justifica el costo. OpenTelemetry sin backend no tiene UI propio. Reconsiderar V2+ cuando aparezca multi-service architecture (hoy somos un monolito) o auditoria SOC2 lo exija.

## Consecuencias

### Positivas

- **Visibilidad operacional de día 1 V1.3**: cada Server Action / route handler / RSC error en producción tiene stack trace source-mapped + context (URL, method, user agent) + breadcrumbs (últimos 30 eventos). Debugging tiempo medio post-incident baja de "horas grepeando Vercel logs" a "minutos en Sentry issue".
- **Decisiones data-driven sobre Phase 4 backlog**: Bug D (SSO warm-up) tendrá datos concretos de incidencia post-deploy en lugar de "feeling". Si emerge como top issue, prioridad V1.3; si es <5/día, deferible V1.4.
- **Source maps en builds CI**: stack traces de prod son legibles sin tocar source maps repo (el SDK los upload a Sentry, no expone al cliente).
- **Reversibilidad arquitectónica**: el wrapper `log.*` aísla 26 callsites de la API Sentry. Future migrate a otro provider toca 1 archivo (wrapper), no 26.

### Negativas

- **Vendor lock-in al SDK Sentry**: si en V3+ migramos a OpenTelemetry, hay que migrar `@sentry/nextjs` config + perder breadcrumbs/replay específicos de Sentry. Mitigado por el wrapper (los callsites están abstractos) pero la infra de instrumentation (next.config wrap + 4 archivos init) requiere rework.
- **Latency added per request**: Sentry SDK queue-based, ~5-10ms overhead per error (transparente a UX porque no bloquea). Acceptable.
- **Build time +30-60s** por upload de source maps. Sólo CI; dev local no afectado.
- **Costo escalando**: si V1.3 explota a >50k errors/mes (Team plan tope), salto a $80/mes Business. Probable si producto crece — preferible negociar Sentry o eject a self-hosted GlitchTip (Sentry-compatible OSS).
- **Operational risk de "DSN no sincronizada"**: el primer deploy sin la integración Vercel × Sentry completada se ve normal pero pierde visibilidad. Mitigado en `.env.example` con instrucciones step-by-step + nota explícita en `docs/stack.md` que la integración debe completarse pre-deploy. Verificable post-deploy con un error de prueba (`throw new Error("sentry smoke test")` en una page protegida con feature flag, removido inmediatamente).

### Operacionales

- **Sentry user provisioning**: el user instala vía Vercel Marketplace (~5min). Sin esto, deploy va con SDK no-op (silent). Documentado en `.env.example` + `docs/stack.md` §"Variables de entorno" como bloqueante pre-deploy de Phase 0.
- **Source maps repo policy**: Sentry SDK uploadea source maps al Sentry server durante build CI, pero NO los expone públicamente vía Next.js (la opción `hideSourceMaps: true` en `withSentryConfig` los elimina del bundle estático). Source maps NO van al repo público.
- **Rotación SENTRY_AUTH_TOKEN**: el token tiene scope `project:releases` solo (no `project:read`). Rotation Q+1 cuando se establezca cadencia ops. Documentado V1.3+.

## Implementación V1

Cambios concretos al cerrar Phase 0.E1:

1. `pnpm add @sentry/nextjs` (latest, current=^9.x para Next 16).
2. `src/instrumentation.ts` — `register()` dispatch por runtime.
3. `src/instrumentation-client.ts` — `Sentry.init({...})` client-side.
4. `sentry.server.config.ts` (raíz) — `Sentry.init({...})` Node.js runtime.
5. `sentry.edge.config.ts` (raíz) — `Sentry.init({...})` Edge runtime.
6. `src/shared/lib/observability/log.ts` — wrapper + tests (`__tests__/log.test.ts` con mock de `@sentry/nextjs`).
7. `src/app/global-error.tsx` — root error boundary + `Sentry.captureException`.
8. `next.config.ts` — wrap con `withSentryConfig`.
9. `.env.example` — agregadas `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN` + `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` con setup instructions.
10. `docs/stack.md` — fila "Observability" en tabla stack + entrada §Variables de entorno con behavior por entorno.

Phase 0.E2 (siguiente sub-sesión, mismo session window):
- Migrar 26 callsites de `console.*` → `log.*` en 12 archivos.

## Pointers

- `docs/tech-debt-pre-v1.3.md` §Sesión 0.E — origen + acceptance criteria.
- `docs/stack.md` §Variables de entorno — env vars y bloqueante pre-deploy.
- `src/shared/lib/observability/log.ts` — wrapper canonical.
- `src/instrumentation.ts` + `sentry.server.config.ts` + `sentry.edge.config.ts` + `src/instrumentation-client.ts` — init Sentry.
- `src/app/global-error.tsx` — root error boundary.
- ADR Phase 2.I (Strict CSP nonce-based, pendiente) — deberá agregar Sentry ingest endpoint a `connect-src` directive (`https://*.ingest.sentry.io` o el host del Sentry instance específico).
