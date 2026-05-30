# 0048 — Storage stack: Cloudflare R2 (S3-compatible) + wrapper `storage/blob.ts` + 2 buckets (public/private)

- **Fecha:** 2026-05-30
- **Estado:** Aceptada
- **Alcance:** Tech debt Phase 1.G (de `docs/tech-debt-pre-v1.3.md`). Decisión del provider de blob storage para V1.3+, modelo de buckets, env vars, wrapper canonical (3 funciones), SDK choice, custom domain del bucket público, y patrón de URLs públicas vs presigned. NO incluye consumers (ningún consumer en código todavía — sólo platform-ready para desbloquear V1.3 §ε logo del place + V1.4+ avatares + V2 library + V2 fotos events).
- **Habilita:** ADR-0046 §ε (place logo deferred — V1.3 puede ahora agregar `place.logo_url` columna + UI upload sin re-elegir storage), avatar uploads (`app_user.avatar_url` existe en schema desde migration 0001 — falta UI), V2 library docs (ontologia/library.md), V2 event photos (ontologia/eventos.md §"marcador finalizado/memoria"), V2 imágenes en mensajes de discusión.
- **Refina:** `docs/stack.md` línea 17 fila "Storage = TBD" — pasa a "RESUELTO Cloudflare R2"; `docs/features/README.md` línea 82 fila "Storage = TBD" pasa a "Plataforma".
- **No supersede:** ninguna ADR previa (storage NO estaba decidido — era TBD explícito post-reset).

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

### El gap detectado

Storage es uno de los 3 TBDs estructurales declarados en `docs/stack.md` línea 5 ("Storage, Realtime y Pagos siguen TBD — se deciden antes de implementarse"). V1.3 lo necesita inmediato porque:

- **ADR-0046 §ε** (V1.2 cierre) defirió "logo del place en branding apex" explícitamente esperando este cierre — el invite cross-domain renderea texto-only el placeName por falta de columna `logo_url` + storage backend.
- **`app_user.avatar_url`** existe como columna desde migration 0001 (esquema canónico de identidad ADR-0006 §"capa universal") pero NUNCA tuvo UI de upload — falta storage.
- **Ontología library + eventos + mensajes**: cada una eventualmente serve assets binarios (PDFs, fotos, imágenes de mensaje). Decidir storage en V1.3 evita acumular deuda invisible que estallaría al construir cada feature.

### Threat model y volume projection

**V1 (50 places early-adopters)**:
- Logos: ~50 × 100KB = 5MB
- Avatares: ~500 users × 50KB = 25MB
- **Total ~30MB**. Free tier de cualquier provider cubre 10×.

**V1.5 product-market-fit (500 places × 1GB cada uno con library + fotos)**: 500GB storage + ~5TB egress/mes (avatares cargados en cada page de members + logos en cada Hub view).

**V2 escala (5000 places × 2GB cada uno)**: 10TB storage + ~50TB egress/mes.

### Modelo de negocio (decisión del owner explícita)

El owner del producto cobra por GB adicional a partir de 2GB free per community. Storage cost es **unit economics** — no preferencia operativa. El delta entre storage cost del provider y el precio per GB define el margen. Egress cost adicional rompe la previsibilidad del modelo (page-views generan egress no controlable por el owner del place).

### Lock-in y migración

Migrar storage post-launch es **muy costoso**: URLs en DB apuntan al provider viejo → re-upload completo de TODO el contenido + URL rewriter en código + cache invalidation + período de doble-billing + riesgo de broken links durante cutover. A 10TB en provider lock-in propietario el costo de migración solo en bandwidth out puede superar **$1,000 one-shot** (e.g. Vercel Blob al sobrepasar el Pro plan 1TB free egress es $0.15/GB).

Esto hace que la decisión deba optimizar **lock-in bajo** desde el día 1: provider con S3-compatible API permite eject futuro drop-in sin reescribir wrapper.

## Decisión

**Stack: Cloudflare R2 + wrapper `src/shared/lib/storage/blob.ts` + 2 buckets desde el día 1 + custom domain `media.place.community` + AWS SDK v3 client-s3.**

Composición concreta:

1. **Provider: Cloudflare R2** (S3-compatible blob storage de Cloudflare).
   - Free tier: 10GB storage + 1M Class A ops + 10M Class B ops/mes.
   - Paid: $0.015/GB-month storage. **Zero egress fee** (key advantage).
   - SLA 99.9%. Single global region ("auto" en SDK).

2. **2 buckets desde el día 1**:
   - **`R2_PUBLIC_BUCKET`** (e.g. `place-media-public`): logos del place + avatares de miembros. Contenido público por design (no auth gate). URLs directas via custom domain CDN-cacheado.
   - **`R2_PRIVATE_BUCKET`** (e.g. `place-media-private`): library docs + event photos + cualquier asset auth-gated futuro. URLs presigned con TTL (default 1h) emitidas por Server Action que valida acceso.
   - Justificación de la separación física (no un sólo bucket con convención de keys): lifecycle policies pueden diferir (e.g. event photos auto-archive futuro), CORS policies pueden diferir, audit/observability separadas, y al migrar a otro provider en V3+ los 2 lifecycles separados ya están encapsulados.

3. **Custom domain `media.place.community` para el bucket público**:
   - DNS CNAME del subdomain a R2 (configurado en R2 dashboard).
   - URLs limpias: `https://media.place.community/place/{placeId}/logo.png` (no expone hash de cuenta R2 ni el dominio `r2.cloudflarestorage.com`).
   - CDN Cloudflare automático (caching, image optimization opcional V2 con Image Resizing).
   - Migrable a otro CDN futuro sin cambiar URLs en DB (sólo cambia el DNS target).

4. **SDK: `@aws-sdk/client-s3` v3** (`^3.1057.0`) + `@aws-sdk/s3-request-presigner` (presigned URLs).
   - Battle-tested, tree-shakeable (importás solo PutObjectCommand / GetObjectCommand / DeleteObjectCommand → ~30KB efectivo server bundle, cero impact en client bundle).
   - S3-compatible API portable: future eject a AWS S3 / Backblaze B2 / MinIO / etc. cambia solo el `endpoint` config, NO el código de las commands.
   - Documentación abundante, ecosistema maduro.

5. **Wrapper `src/shared/lib/storage/blob.ts`** — API minimal:
   ```ts
   uploadBlob(input: { bucket, key, body, contentType }): Promise<{ key, publicUrl? }>
   getBlobUrl(input: { bucket, key, ttlSeconds? }): Promise<string>
   deleteBlob(input: { bucket, key }): Promise<void>
   ```
   - Los 3 funcs aceptan input object (no positional) para extensibilidad sin breaking changes.
   - `uploadBlob` retorna `publicUrl` SOLO si `bucket === "public"` — el caller persiste `key` siempre, persiste `publicUrl` solo cuando aplicable (avoid stale URLs si V3+ cambia custom domain).
   - `getBlobUrl` para `public` retorna URL directa (sin red); para `private` retorna presigned URL via `getSignedUrl` con TTL configurable (default 1h).
   - `deleteBlob` no distingue existencia (S3 standard: delete idempotent → success silencioso si key no existía).
   - **NO valida** tamaño/mime — cada consumer V1.3+ pone sus propias guard rails (logo place: max 2MB png/jpg/webp; avatar: max 1MB; library: TBD).

6. **Behavior por entorno (mismo patrón que rate-limit Phase 0.D)**:
   - **Production (`NODE_ENV === "production"`) sin creds R2** → throw al primer call de cualquier operación. NO permitimos uploads silenciosos sin storage configurado. Crash bloquea el flow → operador NOTA + setea creds + retry. Fail-loud-prod aplica acá porque storage SÍ es operacionalmente crítico (uploads sin éxito = user pierde su contribución, distinto de Sentry que es observabilidad pasiva).
   - **Dev/local sin creds** → `ensureConfig` retorna `"skipped"` + log.warn 1×. Cada call de upload/get/delete throwsa con mensaje claro indicando setear `.env.local`. Local sigue levantando sin R2 account (developer ergonomics) pero las operaciones storage NO pueden mockearse silenciosamente — esto evita que un dev assume que "uploadeó algo" cuando no se guardó nada.

7. **Singleton + lazy init**:
   - `S3Client` mantiene un connection pool interno; crear uno por request mata el cold-start. Lazy init en el primer call + cache en módulo-scope. El cliente es 1, compartido entre operaciones de los 2 buckets (R2 multiplexa por `Bucket` field del command, no por client).

8. **Convention de keys**: `place/{placeId}/{kind}/{filename}` (e.g. `place/abc-123/logo.png`, `place/abc-123/avatars/{userId}.jpg`, `place/abc-123/library/doc-2024.pdf`).
   - Permite agregación trivial de storage usage por place (key prefix scan) para el modelo "2GB free + paid por GB extra" — base para billing futuro V1.3+.
   - El placeId es la primary key — namespace garantizado único entre places.

### Por qué R2 (vs alternativas)

- **Egress zero**: para community platform con assets imagen-heavy (avatares en cada member list page, logos en cada Hub render), el egress crece linealmente con tráfico y NO con storage. A V1.5 (500 places + 5TB egress/mo) el ahorro vs Vercel Blob es ~$600/mes; a V2 (5000 places + 50TB) son ~$7,500/mes. **Single decision driver de mayor impacto**.
- **Storage cost 35% menor** ($0.015 vs $0.023 GB-month): directa al margen "2GB free per community" del modelo de negocio.
- **S3-compatible API → lock-in bajo**: eject path a AWS S3 / Backblaze B2 / MinIO drop-in si Cloudflare cambia pricing brutalmente o R2 se deprecia. Cost de migración aún existe (bandwidth + cutover) pero la complejidad código es trivial.
- **Free tier 10× más generoso que Vercel Blob** (10GB vs 1GB): V1 entero cabe en free tier de R2.
- **Custom domain + CDN nativo**: Cloudflare CDN es industry leader para image delivery (V2 puede agregar Cloudflare Image Resizing on-the-fly sin mover assets).

### Trade-offs aceptados

- **Provisioning manual** (~30min one-time): vs ~10min de Vercel Marketplace integration. Setup steps documentados en `.env.example` (Cloudflare account + R2 enabled + 2 buckets + API token + CNAME + 6 env vars manual en Vercel). El costo se paga UNA vez; los savings recurrentes lo cubren al primer mes a escala V1.5.
- **Vendor extra en el dashboard** (Cloudflare separado de Vercel): cognitive overhead operativo bajo (R2 dashboard simple, billing transparente).
- **`@aws-sdk/client-s3` v3 ~30KB en bundle server**: cero impact en client bundle (server-only). El SDK Vercel Blob es ~5KB efectivos — diferencia despreciable a costo cognitivo.
- **Observability via wrapper `log.*`** (no logs Vercel automáticos para R2 ops): el wrapper ya loggea fail-loud-prod con Sentry vía `log.warn`/`log.error`. Suficiente V1.

## Alternativas rechazadas

- **α — Vercel Blob (Vercel-native blob storage, GA 2025)**. Mismo vendor que hosting; Marketplace integration auto-sync env vars (mismo patrón Sentry/Upstash); SDK `@vercel/blob` ergonómico; integración con plan billing único Vercel. **Rechazada porque**: el egress NO es zero — cuenta contra el bandwidth quota del plan Vercel (Pro: 1TB/mo free, después $0.15/GB). A V1.5 (5TB egress) son ~$600/mes incrementales sólo en bandwidth; a V2 (50TB) son ~$7,500/mes. Storage cost también 35% más caro ($0.023 vs R2 $0.015). Lock-in alto: API propietaria NO S3-compatible → migrar post-launch requiere re-upload TODO + URL rewriter (cost one-shot a 10TB ~$1,500 en bandwidth out). Para un producto que cobra per GB es contradictorio elegir el provider con peor unit economics. **Reconsiderar V3+ si**: el producto pivota a flujo "assets pequeños no-image, low-egress" donde la diferencia desaparece.

- **β — AWS S3 directo**. Industry standard de facto; S3-compatible API es nuestra; integración madura con todo el ecosistema. **Rechazada porque**: egress de S3 cuesta $0.09/GB (6× R2 zero) — a V1.5 (5TB) son ~$450/mes extras vs R2; a V2 (50TB) son ~$4,500/mes. Free tier de S3 es 5GB SOLO primer año (luego paid desde el primer GB). Operacionalmente más complejo (IAM policies + bucket policies + CORS + lifecycle rules). Sentido si tuviéramos volumen masivo con descuentos enterprise negociables — no es nuestro caso. **R2 nos da S3-API portable sin el cost overhead** — best-of-both.

- **γ — Backblaze B2**. S3-compatible, $0.006/GB-month storage (más barato que R2), egress $0.01/GB (no zero pero muy bajo). **Rechazada porque**: el storage cost ahorrado vs R2 es marginal (~$45/mes a V2 escala), y B2 NO tiene CDN integrado de la calidad de Cloudflare — habría que poner Cloudflare delante igual (vía Cloudflare CDN partnership "Bandwidth Alliance" zero-egress B2→Cloudflare). Suma 1 vendor extra (B2 + Cloudflare CDN separados) por marginal savings. Si el producto crece a 100s de TBs y storage cost se vuelve dominante, reconsiderar V3+. R2 elimina la complejidad del partnership al ser CF nativo.

- **δ — Self-hosted (MinIO en Hetzner/Hetzner Storage Box/etc.)**. Máxima portabilidad + lock-in cero + cost predictable per-instance. **Rechazada porque**: viola production-grade V1 — ops burden de manejar uptime + backups + scaling + security patching de storage cluster nosotros mismos contradice el modelo de "build product, not infra" que cierran Vercel + Neon + Cloudflare. Sentido si fueras escala donde provider managed cost > 1 senior infra eng — no es V1-V3 razonable.

- **ε — DIY-on-Postgres-bytea (storage en Neon)**. Storage en columna `bytea` de Postgres, sirviendo blobs via Server Action que streams. **Rechazada porque**: Postgres NO es blob store — performance pésima (~100ms per read no cacheado), backups multiplican tamaño DB sin compresión, query planner sufre con tablas grandes, costos Neon escalan con storage rápidamente ($0.135/GB-month en Neon vs $0.015 R2 — 9× más caro), y no hay CDN delante. Patrón anti-recomendado por Postgres docs explícitamente. Mencionado para record — nunca fue opción viable.

- **ζ — Posponer decisión hasta V1.3 cuando se monten consumers**. Mantener "Storage = TBD" en stack.md + decidir cuando aparezca el primer consumer (logo place). **Rechazada porque**: la Phase 1.G (tech-debt closure) busca CERRAR TBDs estructurales pre-V1.3 precisamente para que las features V1.3 NO arranquen con un TBD pendiente que las bloquea. Decidir storage el día que se construye logo place lo bloquea por la duración del ADR + provisioning + wrapper (~2h) — peor cuando se acumulan 3-4 consumers necesitándolo simultáneamente. Cerrarlo ahora desbloquea V1.3 a velocidad máxima.

- **η — 1 bucket único (vs 2 desde día 1)**. Todo en `place-media`, diferencia public/private por prefijo de key + lógica TS. **Rechazada porque**: lifecycle/CORS/policies pueden necesitar diferir entre tipos de asset (event photos auto-archive vs avatares perpetuos; CORS amplio para web-uploads vs restrictivo para admin actions). Cambiar de "1 bucket con prefix" a "2 buckets" requiere mover archivos + actualizar URLs en DB — exactamente el costo de migración que estamos evitando con R2 vs Vercel Blob. Pagar el setup de 2 buckets desde el día 1 es trivial (~5min extra) y desbloquea políticas separadas futuras sin retroactividad. La complejidad código del wrapper es +20 LOC (discriminated `BlobBucket` type) — proporcional al valor.

- **θ — URL R2 default (`pub-{hash}.r2.dev`) sin custom domain**. Zero setup DNS, default funcional. **Rechazada porque**: expone hash de cuenta R2 en URLs persistentes en DB. Cualquier migración futura (a otro provider O a otro custom domain) rompe TODAS las URLs en DB. Setup del custom domain `media.place.community` es ~15min (CNAME + R2 verify) y desacopla forever — la URL persistida no cambia aunque migremos el storage backend. Defensa en profundidad cero-marginal para evitar lock-in invisible.

- **ι — `aws4fetch` (~5KB) en lugar de `@aws-sdk/client-s3` (~30KB server bundle)**. Ultra-liviano fetch-based, ideal serverless cold-start. **Rechazada porque**: menos battle-tested, comunidad chica, edge cases (multipart upload V2, retry strategies, error handling) menos cubiertos. Ahorro de 25KB en bundle server (NO client) es marginal vs el risk de hitting bugs en producción. `@aws-sdk/client-s3` tree-shakes bien (sólo importamos 3 commands) — el "120KB SDK" del marketing pessimista NO es nuestro footprint real. Reconsiderar si V2+ cold-start de funciones serverless se vuelve crítico (entonces se considera split: fetch-based para hot path, AWS SDK para admin).

## Consecuencias

### Positivas

- **Unit economics aligned con modelo de negocio**: storage cost 35% menor + egress zero + free tier 10× más generoso → margen mayor a perpetuidad sobre el modelo "2GB free + paid por GB extra".
- **Lock-in bajo**: S3-compatible API permite eject drop-in a AWS S3/Backblaze B2/MinIO sin reescribir wrapper. Cost de migración futura es 1 cambio de `endpoint` config + re-upload (one-time bandwidth cost, no code rewrite).
- **CDN nativo**: Cloudflare CDN delante del bucket público sin config adicional. V2 puede agregar Cloudflare Image Resizing (transformaciones on-the-fly sin storage adicional) sin cambiar provider.
- **Custom domain stable**: URLs persistidas en DB son `https://media.place.community/...` — desacopladas del provider underneath. Future migrate a otro CDN/storage no requiere DB migration.
- **2 buckets desde día 1**: policies separadas habilitadas (lifecycle, CORS, audit) sin migración retroactiva.
- **Reversibilidad arquitectónica del código**: wrapper `src/shared/lib/storage/blob.ts` aísla los callsites (V1.3+) de la API S3. Future eject toca 1 archivo (wrapper), no N consumers.

### Negativas

- **Vendor extra en stack** (Cloudflare separado de Vercel + Neon + Sentry + Upstash). Operacionalmente +1 dashboard + +1 billing. Mitigado: free tier R2 cubre V1 entero — billing recién al cruzar 10GB.
- **Provisioning manual ~30min one-time** (vs Marketplace ~10min): cost pagado una vez, savings recurrentes. Documentado en `.env.example` step-by-step.
- **Sin Vercel Marketplace integration**: env vars se setean manual (6 vars). Risk de "olvidar una al provisioning" → fail-loud-prod del wrapper protege (deploy con creds incompletas crashea al primer call de storage). Mitigado: el log.warn dev mode ya lista exactamente qué vars faltan.
- **`@aws-sdk/client-s3` v3 ~30KB en server bundle**: marginal (server bundle no shippea a cliente; cold-start impact <50ms).
- **Cloudflare como provider habitual**: depende de la estabilidad/pricing de Cloudflare a largo plazo. Mitigado por S3-compatible API que permite eject. Cloudflare no ha cambiado R2 pricing desde launch (GA 2022 con $0.015/GB-month).

### Operacionales

- **User provisioning** (~30min one-time, post-merge de Phase 1.G):
  1. Sign up cloudflare.com (free, email-based).
  2. Activar R2 desde dashboard Cloudflare (requiere payment method on file aunque free tier no cobra).
  3. Crear 2 buckets: `place-media-public` + `place-media-private` (nombres recomendados; aceptan otros).
  4. Crear API token scope `Object Read & Write` (NO admin) en R2 → Manage R2 API Tokens. Guardar `Access Key ID` + `Secret Access Key`.
  5. Configurar custom domain del bucket público: R2 → bucket → Settings → Custom Domains → Connect Domain → `media.place.community`. Agregar CNAME en DNS provider apuntando a `pub-{hash}.r2.dev`.
  6. Setear 6 env vars en Vercel (Production + Preview scopes): `R2_ACCOUNT_ID` (visible en URL del dashboard CF), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BUCKET=place-media-public`, `R2_PRIVATE_BUCKET=place-media-private`, `R2_PUBLIC_BASE_URL=https://media.place.community`.
  7. Verificar setup: `pnpm dev` con `.env.local` poblado + un Server Action test que uploadea + lee + borra (V1.3 cuando se monte primer consumer logo place).

- **Rotación de API token**: V1 manual cada 6 meses. V2+ evaluar Cloudflare API tokens scoped per-app si llegamos a tener múltiples deploys que comparten storage.

- **Observability de operaciones R2**: vía `log.*` wrapper (Phase 0.E). Errores R2 (AccessDenied, NoSuchKey, etc.) bubble up del SDK → Sentry los captura con stack trace.

- **Backup/disaster recovery V1**: R2 tiene durabilidad 11×9s (similar S3). NO hay cross-region replication V1 (Cloudflare no la ofrece nativo en R2 free/pro tier). Acceptable V1 (asumimos 11×9s durabilidad single-region). V2+ si el producto contiene contenido user-generated crítico, evaluar backup script periódico a otro provider.

- **CORS config**: V1 server-side uploads (Server Action recibe `File` → uploadea desde Function) → CORS NO requerido. V2+ si introducimos client-direct uploads (presigned PUT URLs para reducir egress de funciones), agregar CORS rules en R2 dashboard (allow origin = apex + custom domains).

## Implementación V1

Cambios concretos al cerrar Phase 1.G:

1. `pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner` (v3.1057.0).
2. `src/shared/lib/storage/types.ts` — SoT de tipos (`BlobBucket`, `UploadBlobInput`, `UploadBlobResult`, `GetBlobUrlInput`, `DeleteBlobInput`, `UploadBlobBody`).
3. `src/shared/lib/storage/blob.ts` — wrapper minimal (3 funciones públicas + singleton lazy init S3Client + `_resetConfigCacheForTests`).
4. `src/shared/lib/storage/__tests__/blob.test.ts` — 15 tests cubriendo: skip dev sin creds, fail-loud prod sin creds, uploadBlob public/private, getBlobUrl public (directo) + private (presigned con TTL default + custom), deleteBlob ambos buckets + bubble error, singleton S3Client, normalización trailing slash en publicBaseUrl.
5. `.env.example` — agregado bloque "Cloudflare R2" con 6 env vars + setup instructions step-by-step.
6. `docs/stack.md` — fila "Storage" cambiada de TBD → "Cloudflare R2 (S3-compatible) + custom domain `media.place.community`" + entrada §Variables de entorno con behavior por entorno + status update §Estado del header line 5.
7. `docs/features/README.md` — fila "Storage" movida de Roadmap/TBD a Plataforma (Cloudflare R2 + Drizzle/Sentry/Upstash pattern).
8. `docs/decisions/README.md` — index entry para ADR-0048.

**NO incluido en esta sesión** (deferido a V1.3+ cuando los consumers se monten):
- Provisioning Vercel-side (user lo hace manual fuera de sesión, ~30min, doc en .env.example).
- Migration de schema (`place.logo_url` columna) — vive en V1.3 §ε con su propia sesión.
- UI de upload (logo place, avatares).
- Quotas/limits per consumer (size max, mime allowlist, virus scan).
- Cron de agregación storage-usage-per-place (para billing modelo).
- CORS config (V2 cuando aparezca client-direct upload).

## Pointers

- `docs/tech-debt-pre-v1.3.md` §Sesión 1.G — origen + acceptance criteria + scope decisions.
- `docs/stack.md` §Storage + §Variables de entorno — env vars y operacional.
- `docs/features/README.md` — fila Storage actualizada.
- `src/shared/lib/storage/blob.ts` — wrapper canonical.
- `src/shared/lib/storage/types.ts` — SoT de tipos.
- ADR-0046 §ε — predecessor que difirió logo del place a este cierre.
- ADR-0047 — patrón observability `log.*` consumido por el wrapper.
- ADR-0017 — aprovisionamiento de entornos por migraciones (no aplica a R2 que es out-of-band del DB).
- Migration ADR Phase 2.I (Strict CSP, pendiente) — deberá agregar R2 custom domain a `connect-src` directive (`https://media.place.community`).
