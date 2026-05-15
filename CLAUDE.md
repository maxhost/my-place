# Place

Place es un lugar digital pequeño e íntimo para hasta 150 personas. Es **cozytech**: un espacio tranquilo donde entrás, te ponés al día de lo que pasa, participás si querés, y salís. Como entrar a un pub conocido — no como abrir una red social.

**No es:** un feed con scroll infinito, una app que compite por atención, un producto con notificaciones agresivas, un sistema con métricas de engagement, ni una plataforma con gamificación.

**Es:** un lugar con miembros, conversaciones, eventos y memoria compartida. Donde cada place tiene su identidad visual propia y su propio ritmo.

## Estado del proyecto

El código fue **reseteado a un scaffold limpio** (Next.js 15 + TS + Tailwind). No hay features implementadas todavía. La capa de datos migra a **Neon (Postgres 17)**; auth, storage, realtime, pagos y el método de acceso a la DB están **TBD**. La historia previa (implementación Prisma+Supabase) queda en `git log`.

## Documentos de referencia

Para entender el producto y el proyecto en profundidad:

- `docs/architecture.md` — decisiones técnicas, paradigma, índice
- `docs/stack.md` — stack técnico y variables de entorno (estado de los TBD)
- `docs/data-model.md` — schema SQL del core e invariantes del dominio
- `docs/multi-tenancy.md` — routing por subdomain, DNS, middleware
- `docs/ontologia/` — documentos canónicos de cada objeto (conversaciones, eventos, miembros)
- `docs/landingpage/` — arquitectura y contenido de la landing pública

Otros docs (blueprint, features, mockups, pre-launch-checklist, gotchas, decisions) se eliminaron en el reset y se reescriben cuando corresponda.

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
- **Pages de detalle siguen el patrón "streaming agresivo del shell".** Top-level await SÓLO para validación de existencia + redirect; todo lo demás vive bajo `<Suspense>`. Ver `docs/architecture.md` § "Streaming agresivo del shell" para la regla canónica + implementaciones de referencia. **Aplica a pages nuevas y refactor de pages existentes que tengan `await Promise.all` en el shell**.
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

## Seguridad de secrets

- **NUNCA exponer API keys, passwords, ni service-role tokens en GitHub** — ni siquiera en repos pre-producción / privados / de desarrollo. Los secrets viven SOLO en `.env.local` (gitignored), Vercel env vars, o secret managers.
- **NUNCA usar `git add -A` o `git add .`** — siempre stagear archivos por path explícito. Esos comandos atrapan untracked sensibles (backups de `.env`, dumps, credentials.json, tokens) que pueden no estar en `.gitignore`.
- **Antes de cualquier `git commit`:** verificar `git status --short` y leer la lista de archivos a stagear. Si aparece algo que matchea `\.env`, `*-backup*`, `*credentials*`, `*token*`, `*.pem`, `*.key`, `*secret*` — STOP y consultar.
- **Si se expone un secret accidentalmente:** rotar inmediatamente en el dashboard del proveedor correspondiente (Neon, etc.), después limpiar historial Git. La rotación es prioridad sobre la limpieza.

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

Los gotchas del proyecto previo se eliminaron en el reset. Se reconstruyen a medida que aparezcan.

**Cuándo agregar uno nuevo:** cuando descubrís un comportamiento que (a) no es derivable del código, (b) tiene un síntoma confuso, y (c) volvería a morder a alguien en el futuro. Crear `docs/gotchas/<topic-slug>.md` (creando el directorio si hace falta) y sumarlo a un índice en `docs/gotchas/README.md`.

**Gotcha vigente heredado:** `next build` falla con un error falso de `<Html> should not be imported outside of pages/_document` si el shell tiene `NODE_ENV=development`. Por eso el script `build` usa `cross-env NODE_ENV=production next build`.

## Qué hacer cuando tengas dudas

Si en algún momento de la implementación pensás que vale la pena desviarte de estos principios, del paradigma, o de una decisión en `docs/architecture.md`:

1. Pausá. No implementes la desviación.
2. Consultame el motivo.
3. Si acordamos la desviación, la registramos en `docs/decisions/` con fecha y razón.
4. Recién ahí implementás.

Nunca tomes una decisión arquitectónica solo durante una sesión de código.
