# CLAUDE.md

Reglas operativas para no romper este proyecto. El producto/dominio se documenta una sola vez en `docs/`; acá se apunta, no se copia.

## Estado del proyecto

- Scaffold limpio, **sin features implementadas** — no busques features que no existen.
- Acceso a datos, auth, storage, realtime y pagos están **TBD**: no asumas que existen ni los elijas vos. **NO se vuelve a Prisma.** Stack y estado de los TBD en `docs/stack.md`.
- **Antes de tocar UI o tomar una decisión de producto, leé `docs/producto.md`** (visión + principios de experiencia, canónico).

## Mapa de documentos canónicos

Cada cosa vive en un solo lugar. Antes de implementar, leé el doc que corresponda:

- `docs/producto.md` — visión y principios de experiencia/diseño (transversal)
- `docs/architecture.md` — paradigma, decisiones técnicas, índice arquitectónico
- `docs/stack.md` — stack técnico, variables de entorno, estado de los TBD
- `docs/data-model.md` — schema SQL del core e invariantes del dominio
- `docs/multi-tenancy.md` — routing por subdomain, DNS, middleware, slug inmutable
- `docs/ontologia/` — documentos canónicos de cada objeto del core (`miembros.md`, `conversaciones.md`, `eventos.md`)
- `docs/landingpage/` — arquitectura y contenido de la landing pública

Otros docs (blueprint, features, mockups, pre-launch-checklist, gotchas, decisions) se eliminaron en el reset y se reescriben cuando corresponda.

## Paradigma arquitectónico

**Modular Monolith con Vertical Slices.** El detalle técnico vive en `docs/architecture.md`. La regla de comportamiento es esta:

- Cada feature en `src/features/` es una rebanada vertical autónoma con su propia UI, lógica, datos y tests.
- Las features solo se comunican entre sí a través de una interfaz pública explícita (`public.ts`).
- `shared/` nunca importa de `features/`.
- Una feature nunca importa directamente de otra feature — solo de su `public.ts`.

Si rompés esta regla, rompés el paradigma entero y perdés la capacidad de agregar/quitar features sin efectos colaterales.

## Reglas de vibecoding

### Antes de implementar

- **Diagnosticar antes de implementar.** Leer archivos relevantes, reportar estado actual, identificar patrones existentes. Nunca asumir paths, tipos, o convenciones — verificar.
- **Documentación primero.** Antes de implementar, revisar si hay doc relevante en `docs/`. Si existe: la implementación la respeta; si algo cambia, se actualiza el doc y se anota la fecha de última actualización. Si es algo nuevo: se documenta antes de codear (comportamiento esperado, no implementación).
- **Pages de detalle:** antes de construir o refactorizar una, consultar `docs/architecture.md` § "Streaming agresivo del shell" para confirmar el patrón vigente. No replicar la regla de memoria.
- **Triple review antes de ejecutar.** Todo prompt se revisa tres veces contra `docs/architecture.md` y `CLAUDE.md` antes de ejecutar.

### Durante la implementación

- **TDD obligatorio.** Tests primero, verificar que fallan, implementar, verificar que pasan. Sin excepciones en el core.
- **Un prompt = una responsabilidad.** Si una tarea toca más de 5 archivos o mezcla backend con frontend, dividir en sesiones separadas.
- **Sesiones focalizadas y cortas.** Backend y frontend en sesiones separadas cuando sea posible. Usar `/compact` al 60% del contexto.
- **Sin libertad para decisiones arquitectónicas.** Las decisiones están en `docs/architecture.md`. Si algo no está claro, pausar y consultar, no improvisar.
- **Nunca asumir el estado del código.** Siempre leer el archivo antes de modificarlo, porque puede haber cambiado desde la última vez que se revisó.

### Después de implementar

- **Auto-verificar:** correr tests y typecheck, reportar archivos tocados con sus líneas.
- **Cambios de paradigma/estructura** se registran en `docs/architecture.md` o `docs/decisions/`.
- **Gotchas nuevos** van a la sección Gotchas (criterio abajo).

## Seguridad de secrets

- **NUNCA exponer API keys, passwords, ni service-role tokens en GitHub** — ni siquiera en repos pre-producción / privados / de desarrollo. Los secrets viven SOLO en `.env.local` (gitignored), Vercel env vars, o secret managers.
- **NUNCA usar `git add -A` o `git add .`** — siempre stagear archivos por path explícito. Esos comandos atrapan untracked sensibles (backups de `.env`, dumps, credentials.json, tokens) que pueden no estar en `.gitignore`.
- **Antes de cualquier `git commit`:** verificar `git status --short` y leer la lista de archivos a stagear. Si aparece algo que matchea `\.env`, `*-backup*`, `*credentials*`, `*token*`, `*.pem`, `*.key`, `*secret*` — STOP y consultar.
- **Si se expone un secret accidentalmente:** rotar inmediatamente en el dashboard del proveedor correspondiente (Neon, etc.), después limpiar historial Git. La rotación es prioridad sobre la limpieza.

## Límites de tamaño

Superar un límite = dividir antes de continuar. Archivo ≤ 300 líneas · función ≤ 60 · feature ≤ 1500 · servicio/módulo en `shared/` ≤ 800.

## Idioma

- **UI del producto, documentación interna, comentarios, mensajes de commit:** español.
- **Código (nombres de variables, funciones, tipos, clases):** inglés.
- **Issues, PRs, discusiones de arquitectura:** español.

## Estilo de código

- **Tailwind solo para layout y spacing.** Los colores del place son CSS custom properties configurables por el owner, nunca clases Tailwind hardcoded.
- **Zod para todo input externo** (forms, API, webhooks).
- `any`/`@ts-ignore` solo con justificación escrita.

## Gotchas

Agregar uno cuando un comportamiento (a) no es derivable del código, (b) tiene síntoma confuso, (c) volvería a morder: crear `docs/gotchas/<slug>.md` + índice en `docs/gotchas/README.md`.

- **`next build` + `NODE_ENV`:** falla con error falso de `<Html> should not be imported outside of pages/_document` si el shell tiene `NODE_ENV=development`. Por eso el script `build` usa `cross-env NODE_ENV=production next build`.

## Ante una desviación

Nunca tomes una decisión arquitectónica solo durante una sesión. Si querés desviarte de un principio, del paradigma o de una decisión en `docs/architecture.md`: pausá, no la implementes, consultá el motivo. Si se acuerda, se registra en `docs/decisions/` con fecha y razón **antes** de implementar.
