# Discusiones · objeto consolidado

Documento canónico del objeto "discusiones" en Place. Decisiones tomadas. Listo para construir.

> _Última actualización: 2026-05-16._ Ontología canónica del dominio. Si una decisión de producto cambia, se actualiza acá **en la misma sesión** y se ajusta la fecha; el schema (`docs/data-model.md`) es su expresión, no su fuente.

---

## El principio

Las discusiones en Place no son un foro tradicional donde los miembros postean contenido atemporal que queda archivado para siempre. Son **el espacio donde la comunidad habla durante el tiempo que el lugar está abierto**, y donde esa conversación queda como tejido del lugar mismo.

---

## Vocabulario canónico

Dos cosas distintas, no confundir:

- **Zona Discusión**: el listado de todas las discusiones del place. Es el punto de entrada; el miembro ve la lista y entra a una.
- **Discusión**: la unidad. Un post con su mensaje principal y su hilo de mensajes. Es el primitivo.

**La Discusión es el primitivo del que derivan otros objetos.** Un evento genera una Discusión; un recurso de biblioteca genera una Discusión. Cambia solo la **morfología del mensaje principal** (un evento tiene fecha/lugar/confirmaciones; un documento tiene el archivo) — el hilo de mensajes y todas sus reglas son los mismos.

---

## En qué se parece y en qué se diferencia a un foro tradicional

**Se parece a un foro en**: los miembros traen temas; cada uno tiene un hilo de respuestas; se pueden citar mensajes; hay moderación.

**Se diferencia en propiedades estructurales**:

### Uno — Vive dentro del horario del place

Un foro tradicional está siempre abierto, 24/7, indiferente al tiempo humano. Las discusiones en Place **solo son accesibles para los miembros cuando el place está abierto**. Fuera del horario, el miembro no entra. Lo que no se dijo hoy, se dirá la próxima apertura. El **owner** es la excepción: entra fuera de horario (ver "Comportamiento por horario"). Esto no es restricción arbitraria — le da ritmo y densidad a la conversación.

### Dos — Las discusiones son traídas, no autorizadas

Un foro tradicional tiene "autor" dueño del post; si se va, el contenido queda huérfano. En Place, una discusión es **traída por** alguien al place. Pertenece al place, no al miembro. Si Max se va del Taller, su discusión queda como parte del lugar. No estás "posteando en tu cuenta" — estás "trayendo algo al lugar".

### Tres — Los lectores son parte de la conversación

En un foro tradicional leer es invisible. En Place **leer es una forma de presencia**. Cada discusión registra quién la leyó en la apertura actual y lo muestra como nombres acumulados: "Leyeron: Max, Lucía, Rodri — y 2 más". La comunidad sabe quiénes estuvieron, aunque no hayan escrito.

### Cuatro — Una discusión nunca se cierra

Una discusión no se archiva, no "muere", no "duerme". **Siempre está ahí para ser habitada**: cualquiera puede sumar un mensaje en cualquier momento y la conversación continúa donde estaba. No hay estado "cerrado por inactividad" ni hilos nuevos para retomar algo viejo — se retoma el mismo. La historia del place acumula capas en vez de fragmentarse.

### Cinco — La temporada cierra y queda como artefacto

Un foro acumula temas indefinidamente y a los años nadie encuentra nada. En Place el owner puede cerrar una temporada (mes, trimestre, año): las discusiones de esa temporada se consolidan como **artefacto descargable** (anuario, libro digital, PDF) y empieza otra con borrón parcial. Opcional — cada place decide si usa temporadas.

---

## Estructura

### La Zona Discusión

Punto de entrada. Muestra:

- Las discusiones **agrupadas por día**, las más nuevas primero (una discusión con mensajes nuevos sube como nueva).
- **Scroll con lazyload**: la lista es cronológica, finita y reconocible (hoy, ayer, …) y carga más al bajar por performance. No es un feed algorítmico infinito — siempre hay un fondo y el usuario sabe dónde está (ver principio en `docs/producto.md`).
- Cada discusión con: título, traída por quién, cuándo, preview de la última actividad, participantes visibles (avatares), conteo de mensajes y de lectores.
- **Botón "Traer discusión"** — CTA claro, sin fricción artificial.

### La Discusión

- **Mensaje principal**: título, "traída por [nombre]" con fecha, bloque de lectores de la apertura actual. (Eventos y biblioteca cambian la morfología de este bloque; el resto es igual.)
- **Hilo de mensajes vertical**: sin árbol, sin indentación. Cada mensaje con avatar, nombre, timestamp, contenido.
- **Citas**: responder a un mensaje puntual lo muestra citado arriba (nombre + fragmento del citado).
- **Composer estilo Reddit**: input sticky abajo; al hacer click se expande para escribir. Editor de texto **Lexical**.

### Mensajes

Por ahora **solo escritos** (no hay audio — es funcionalidad futura, fuera de alcance de esta ontología). Soportan enlaces, video, negritas, listas — todo vía Lexical. Ventana de edición de 60 segundos después de enviar. Reacciones con emoji (expresión, no jerarquía).

---

## Interacciones

Un miembro puede, **siempre que tenga el nivel de acceso para ello**:

- Abrir una discusión nueva.
- Responder en una discusión.
- Responder a un mensaje puntual de otro miembro (cita).
- **@mencionar** a otros usuarios.
- **@referenciar** recursos de la biblioteca o eventos del place.

---

## Comportamiento por horario

- **Miembro, en horario**: acceso completo de lectura y escritura. Se acumulan lectores.
- **Miembro, fuera de horario**: el place no es accesible. Cualquier ruta no-settings muestra `<PlaceClosedView>` indicando cuándo vuelve a abrir.
- **Owner**: accede al place y a discusiones, eventos, miembros, etc. **también fuera de horario** (lo ve como si estuviera abierto), además de `/settings/*`.

Regla técnica del gate (dónde vive, no por feature): `docs/architecture.md` § "Gate de horario del place".

---

## Moderación

- Centralizada en el owner (no distribuida; delegable vía grupos con permisos en el futuro).
- Miembros pueden solicitar; el owner ejecuta.
- No hay flags automáticos ni moderación algorítmica.

---

## Lo que la Zona Discusión NO tiene

Para proteger el primitivo de Place:

- **No hay karma/reputation/points por postear** ni ranking de actividad. Sí puede haber reconocimiento cualitativo de pertenencia/rol (ver principio en `docs/producto.md`), nunca métricas de volumen que compiten por atención.
- **No hay algoritmo de ranking** — orden cronológico por última actividad, no por "popularidad".
- **No hay tags/categorías** preestablecidas. Cada discusión es su propio tema.
- **No hay votos up/down** en mensajes. Reacciones emoji sí.
- **No hay árbol de respuestas** — vertical con citas, plano.
- **No hay cierre automático** por inactividad: una discusión nunca se cierra.
- **No hay notificaciones push agresivas** por respuestas.

---

## Integraciones con otros objetos del place

- **Con eventos**: cada evento genera una Discusión (morfología distinta del mensaje principal) que funciona como preparación colectiva, participación durante y memoria post-evento. Ver `docs/ontologia/eventos.md`.
- **Con miembros**: los nombres son tappeables → perfil contextual del miembro en el place → iniciar DM. Ver `docs/ontologia/miembros.md`.
- **Con biblioteca**: un recurso es una Discusión; los mensajes pueden @referenciar recursos. Ontología en `docs/ontologia/library.md` (feature aún no implementada).

---

## Casos de uso que funcionan

- **Pub de amigos (8 personas, jueves 19-23)**: conversación real, los temas viejos se retoman fácil, la temporada anual se cierra como memoria.
- **Taller profesional (15 personas, sábados 9-13)**: temas técnicos con texto largo, citas para responder puntual, biblioteca complementa.
- **Iglesia (50 personas)**: fe, dudas, pedidos de oración, organización. El owner modera activamente.
- **Empresa pequeña (30 personas, horario laboral)**: decisiones, retrospectivas; el horario refuerza tiempo de trabajo vs descanso.

## Casos de uso que NO funcionan bien

- Comunidades de 500+ (exceden el límite de 150).
- Soporte 24/7 (necesita estar siempre abierto; rompe el modelo íntimo).
- Foros públicos de consulta (Place es privado por diseño).
- Chat frenético tipo Discord (otro ritmo).

---

## Estado

**Ontología:** cerrada — este documento es canónico. **Implementación:** no empezada (scaffold limpio; no hay UI). El detalle de pantallas vive en el spec de la feature cuando se construya, no acá.

---

## Referencias cruzadas

- `docs/producto.md` — visión y principios de experiencia (incluye el límite scroll/lazyload)
- `docs/ontologia/eventos.md` — evento, que es una Discusión con mensaje principal distinto
- `docs/ontologia/library.md` — recurso de biblioteca, también una Discusión con mensaje principal distinto
- `docs/ontologia/miembros.md` — perfil del miembro, accesible desde nombres
- `docs/architecture.md` § "Gate de horario del place" — regla técnica del gate por horario
