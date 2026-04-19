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
- **Cada place tiene su propio horario.** Las discusiones respetan las horas de apertura: fuera de horario, lectura disponible, escritura pausada.
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
- **Supabase connection string: copiar literal del dashboard.** El hostname del pooler varía entre proyectos (`aws-0-<region>` vs `aws-1-<region>` vs otros) y no es derivable del project ref ni de la región. Siempre ir a Dashboard → Connect → ORMs y pegar el URI exacto, nunca construirlo a mano.

## Qué hacer cuando tengas dudas

Si en algún momento de la implementación pensás que vale la pena desviarte de estos principios, del paradigma, o de una decisión en `docs/architecture.md`:

1. Pausá. No implementes la desviación.
2. Consultame el motivo.
3. Si acordamos la desviación, la registramos en `docs/decisions/` con fecha y razón.
4. Recién ahí implementás.

Nunca tomes una decisión arquitectónica solo durante una sesión de código.
