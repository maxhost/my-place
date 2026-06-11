# Threads · objeto consolidado

Documento canónico del **thread**, el primitivo de Place (pre-pivot se llamaba "Discusión"). Decisiones tomadas.

> _Última actualización: 2026-06-11 (ADR-0053 — pivot al Substack para podcasts: Discusión → Thread con tipos; mueren el horario de apertura y las temporadas; visibilidad granular del owner)._ Ontología canónica del dominio. Si una decisión de producto cambia, se actualiza acá **en la misma sesión** y se ajusta la fecha; el schema (`docs/data-model.md`) es su expresión, no su fuente.

---

## El principio

El thread es **la unidad de todo lo que se publica y se conversa en un place**: un post con su mensaje principal y su hilo de comentarios debajo. La conversación del show vive con el show — no en un Discord satélite, no en los comentarios ruidosos de un agregador.

**El thread es el primitivo del que derivan los demás objetos.** Cambia la **morfología del mensaje principal** según el tipo; el hilo de comentarios y todas sus reglas son los mismos.

---

## Tipos de thread

| Tipo | Quién lo crea | Mensaje principal | Ontología propia |
|---|---|---|---|
| **Discusión** | cualquier oyente (y el owner) | cuerpo libre (Lexical) | este doc |
| **Episodio** | **solo el owner** | player de audio/video + show notes | `episodios.md` |
| **Blogpost** | **solo el owner** | artículo editorial público (SEO/GEO) | `blogposts.md` |
| **Evento** | el owner (oyentes: a confirmar, ADR-0053 §Preguntas abiertas) | fecha/modalidad/confirmaciones | `eventos.md` |

Episodio y blogpost son **la voz del show** — por eso son owner-only. La discusión es la voz de la comunidad.

### Programación

El owner puede **programar un thread** para que se publique o abra en una fecha futura. Programarlo **genera automáticamente un evento** en el place ("la próxima semana, episodio 4: …") — el evento es la anticipación, el thread programado es el contenido. Detalle del evento generado en `eventos.md`.

---

## Visibilidad: quién ve qué

Tres niveles de acceso, controlados por el owner (canónico en ADR-0053 §4; la mecánica de paywall en `monetizacion.md`):

- **Público** — visible para anónimos en la web (y, si es episodio público, en el RSS).
- **Comunidad** — visible para los oyentes del place.
- **Privado** — visible solo para **suscriptores** (oyentes con suscripción paga activa del creador).

El owner decide a nivel place si su **comunidad es pública o privada**, y con granularidad por objeto: **cada thread, sus comentarios y cada evento pueden ser públicos o privados**. Un episodio puede ser público mientras sus comentarios quedan solo para la comunidad; un blogpost es público por definición; un episodio exclusivo es privado.

**Existencia visible, contenido gateado:** lo que no podés abrir puede igual verse listado (sabés que existe un episodio exclusivo; no lo escuchás sin suscripción). Este patrón ya era canon pre-pivot y sobrevive.

Las discusiones traídas por oyentes viven en la comunidad; su exposición pública la gobierna la configuración del owner, no el oyente.

---

## En qué se parece y en qué se diferencia a un foro tradicional

**Se parece a un foro en**: los oyentes traen temas; cada uno tiene un hilo de respuestas; se pueden citar mensajes; hay moderación.

**Se diferencia en propiedades estructurales**:

### Uno — Los threads son traídos, no autorizados

Un foro tradicional tiene "autor" dueño del post; si se va, el contenido queda huérfano. En Place, un thread es **traído por** alguien al place. Pertenece al place, no al individuo. Si un oyente se va, su discusión queda como parte del lugar. No estás "posteando en tu cuenta" — estás "trayendo algo al lugar". (El contenido del owner — episodios, blogposts — es del show por la misma regla.)

### Dos — Los lectores son parte de la conversación

En un foro tradicional leer es invisible. En la comunidad de Place **leer es una forma de presencia**. Cada thread registra quién lo leyó recientemente y lo muestra como nombres acumulados: "Leyeron: Max, Lucía, Rodri — y 2 más". La comunidad sabe quiénes estuvieron, aunque no hayan escrito. (Aplica a la zona comunidad; los anónimos de la cara pública no acumulan presencia.)

### Tres — Un thread nunca se cierra

Un thread no se archiva, no "muere", no "duerme". **Siempre está ahí para ser habitado**: cualquiera con acceso puede sumar un comentario en cualquier momento y la conversación continúa donde estaba. No hay estado "cerrado por inactividad" ni hilos nuevos para retomar algo viejo — se retoma el mismo. Un episodio de hace dos años sigue recibiendo comentarios. La historia del place acumula capas en vez de fragmentarse.

---

## Estructura

### La zona de threads

Punto de entrada de la comunidad. Muestra:

- Los threads **agrupados por día**, los más nuevos primero (un thread con comentarios nuevos sube como nuevo). Los tipos se distinguen visualmente (un episodio con su player se reconoce de un vistazo).
- **Scroll con lazyload**: la lista es cronológica, finita y reconocible (hoy, ayer, …) y carga más al bajar por performance. No es un feed algorítmico infinito — siempre hay un fondo y el usuario sabe dónde está (ver principio en `docs/producto.md`).
- Cada thread con: título, tipo, traído por quién, cuándo, preview de la última actividad, participantes visibles (avatares), conteo de comentarios y de lectores, y marca de visibilidad (público/privado) visible para el owner.
- **CTA para traer una discusión** — claro, sin fricción artificial. (Episodio/blogpost se crean desde el flujo de publicación del owner.)

### El thread

- **Mensaje principal**: la morfología del tipo (cuerpo libre / player + show notes / artículo / evento) + "traído por [nombre]" con fecha + bloque de lectores.
- **Hilo de comentarios vertical**: sin árbol, sin indentación. Cada comentario con avatar, nombre, timestamp, contenido.
- **Citas**: responder a un comentario puntual lo muestra citado arriba (nombre + fragmento del citado).
- **Composer estilo Reddit**: input sticky abajo; al hacer click se expande para escribir. Editor de texto **Lexical**.

### Comentarios

Por ahora **solo escritos** (no hay audio — funcionalidad futura, fuera de alcance de esta ontología). Soportan enlaces, video, negritas, listas — todo vía Lexical. Ventana de edición de 60 segundos después de enviar. Reacciones con emoji (expresión, no jerarquía).

---

## Interacciones

Un oyente puede, **siempre que tenga el nivel de acceso para ello**:

- Traer una discusión nueva.
- Comentar en un thread (episodio, blogpost, discusión, evento — el hilo es el mismo primitivo).
- Responder a un comentario puntual de otro (cita).
- **@mencionar** a otros usuarios.
- **@referenciar** otros threads del place (un comentario puede apuntar a un episodio o a un evento).

---

## Moderación

- Centralizada en el owner (no distribuida; delegable vía grupos con permisos en el futuro).
- Oyentes pueden solicitar; el owner ejecuta.
- No hay flags automáticos ni moderación algorítmica.
- Con comentarios públicos, la moderación importa más: lo que se ve desde afuera es la cara del show. La herramienta es la misma (el owner modera); el spam a escala se mitiga con el rate-limiting de plataforma y, si hace falta, gates por nivel de acceso — decisión del spec del feature, no de esta ontología.

---

## Lo que la zona de threads NO tiene

Para proteger el primitivo de Place:

- **No hay karma/reputation/points por postear** ni ranking de actividad. Sí puede haber reconocimiento cualitativo de pertenencia/rol (ver principio en `docs/producto.md`), nunca métricas de volumen que compiten por atención.
- **No hay algoritmo de ranking** — orden cronológico por última actividad, no por "popularidad".
- **No hay tags/categorías** preestablecidas. Cada thread es su propio tema.
- **No hay votos up/down** en comentarios. Reacciones emoji sí.
- **No hay árbol de respuestas** — vertical con citas, plano.
- **No hay cierre automático** por inactividad: un thread nunca se cierra.
- **No hay notificaciones push agresivas** por respuestas.

---

## Integraciones con otros objetos del place

- **Con episodios**: un episodio es un thread (player como mensaje principal). Ver `episodios.md`.
- **Con blogposts**: un blogpost es un thread público. Ver `blogposts.md`.
- **Con eventos**: un evento es un thread; además, programar cualquier thread genera un evento. Ver `eventos.md`.
- **Con oyentes**: los nombres son tappeables → perfil contextual del oyente en el place → iniciar DM. Ver `miembros.md`.
- **Con monetización**: thread privado = detrás de la suscripción paga del oyente. Ver `monetizacion.md`.

---

## Casos de uso que funcionan

- **Podcast independiente (2.000 oyentes/episodio):** publica el episodio semanal (thread con player, público), la conversación pasa debajo del episodio, dos episodios exclusivos al mes para suscriptores, blogpost ocasional que trae tráfico de Google.
- **Videopodcast con comunidad fuerte:** comunidad privada (solo oyentes leen las discusiones), episodios públicos para crecer, eventos presenciales anunciados con thread programado.
- **Show de nicho profesional:** blogposts SEO como puerta de entrada, episodios públicos, comunidad donde los oyentes traen discusiones técnicas que alimentan los próximos episodios.

## Casos de uso que NO funcionan bien

- Chat frenético tipo Discord (otro ritmo — el thread es conversación con fondo, no stream).
- Foro generalista sin show (Place es la casa de un podcast; el contenido del creador es el corazón).
- Agregador multi-show (cada place es UN podcast con su identidad; no hay "discover" global).

---

## Estado

**Ontología:** cerrada — este documento es canónico (reescrito por ADR-0053). **Implementación:** no empezada (no hay UI de threads). El detalle de pantallas vive en el spec de la feature cuando se construya, no acá. El schema de threads tampoco existe aún (`docs/data-model.md` § banner pivot).

---

## Referencias cruzadas

- `docs/producto.md` — visión y principios de experiencia (incluye el límite scroll/lazyload)
- `docs/ontologia/episodios.md` — episodio, thread con player + RSS + métricas
- `docs/ontologia/blogposts.md` — blogpost, thread editorial público
- `docs/ontologia/eventos.md` — evento, thread con fecha; threads programados generan eventos
- `docs/ontologia/monetizacion.md` — threads privados y suscripción del oyente
- `docs/ontologia/miembros.md` — perfil del oyente, accesible desde nombres
- `docs/ontologia/library.md` — despriorizada post-pivot (ADR-0053)
