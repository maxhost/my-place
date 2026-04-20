# Discusiones · objeto consolidado

Documento final del objeto "discusiones" (el foro reimaginado) en Place. Todas las decisiones tomadas. Listo para construir.

---

## El principio

Las discusiones en Place no son un foro tradicional donde los miembros postean contenido atemporal que queda archivado para siempre. Son **el espacio donde la comunidad habla durante el tiempo que el lugar está abierto**, y donde esa conversación queda como tejido del lugar mismo.

---

## En qué se parece y en qué se diferencia a un foro tradicional

**Se parece a un foro en**:

- Los miembros traen temas para discutir
- Cada tema tiene una lista de respuestas
- Los temas pueden reactivarse si alguien vuelve a escribir
- Se pueden citar mensajes anteriores
- Hay moderación

**Se diferencia en seis propiedades estructurales**:

### Uno — Vive dentro del horario del place

Un foro tradicional está siempre abierto, 24/7, indiferente al tiempo humano. Las discusiones en Place **solo existen cuando el place está abierto**. Fuera del horario, el place no está accesible — no hay acceso a las discusiones. Lo que no se dijo hoy, se dirá el próximo jueves.

Esto no es restricción arbitraria — es lo que hace que la conversación tenga ritmo y densidad. Cuando el taller abre los jueves de 19 a 23, esas cuatro horas son de conversación real. No es un chorro asíncrono interminable.

### Dos — Los temas son traídos, no autorizados

Un foro tradicional tiene "autor" del post. El autor tiene propiedad del contenido. Si el autor se va, el contenido queda huérfano.

En Place, los temas son **traídos por** alguien al place. El tema pertenece al place, no al miembro. Si Max trae un tema sobre Electron, ese tema es del Taller, no de Max. Si Max se va del Taller, el tema queda como parte del lugar.

Esto cambia la sensación de autoría. No estás "posteando en mi cuenta" — estás "trayendo algo al lugar".

### Tres — Los lectores son parte de la conversación

En un foro tradicional, leer es invisible. Los lurkers existen pero no se sabe quién leyó qué. Los que participan hablando tienen visibilidad, los que solo leen no.

En Place, **leer es una forma de presencia**. Cada tema registra quién lo leyó durante la apertura. "Leyeron esta noche: Max, Lucía, Rodri, Juan — y 2 más hasta ahora". Eso convierte la lectura en participación visible. La comunidad sabe quiénes estuvieron en ese tema, aunque no hayan escrito.

### Cuatro — Los audios son efímeros pero su contenido persiste

Un foro tradicional no tiene audios en general. Cuando los tiene (Discord, WhatsApp), los audios quedan para siempre como archivo.

En Place, los audios de 15-20 segundos **son efímeros**: se pueden escuchar durante 24 horas después de grabados, después desaparecen y queda solo la transcripción automática como texto en el hilo. La voz de Max queda preservada solo por 24 horas; lo que dijo queda para siempre.

Esto resuelve dos tensiones: la riqueza emocional del audio para expresar cosas que el texto no captura, y la privacidad/ligereza de que tu voz no quede archivada para siempre.

### Cinco — Los temas dormidos no mueren, hibernan

Un foro tradicional empuja los temas viejos al fondo del archivo. A veces los cierra automáticamente. La conversación se fragmenta en hilos nuevos en vez de continuar la vieja.

En Place, los temas que no se tocan por 30 días pasan a estado "dormido". Siguen siendo visibles, pero con tipografía atenuada. **Cualquier mensaje los reactiva instantáneamente** al estado "vivo". Lu puede reabrir el tema de TDD que Max trajo hace tres meses, y la conversación continúa ahí mismo — no necesita un hilo nuevo.

Esto hace que la historia del place acumule capas en vez de fragmentarse.

### Seis — La temporada cierra y queda como artefacto

Un foro tradicional acumula temas indefinidamente. A los tres años tiene 5000 hilos y nadie encuentra nada.

En Place, el admin puede cerrar una temporada del place (mes, trimestre, año). Al cerrar, los temas de esa temporada se consolidan como **artefacto descargable** — un anuario del place, un libro digital, un PDF. Después empieza otra temporada con borrón parcial.

Esta propiedad es opcional — cada place decide si usa temporadas o no. Pero abre la puerta a que la discusión sea algo que acumula y luego se preserva como memoria del grupo.

---

## Estructura del objeto discusiones

### El espacio general

El foro es la pantalla principal del objeto discusiones. Muestra:

- **Solo los temas vivos hoy** por default. Sin scroll infinito.
- Cada tema con: título, traído por quién, cuándo, preview de la última actividad, participantes visibles (avatars), estadísticas (cuántos mensajes, cuántos leyeron).
- Los temas activos durante la apertura tienen marca visual distintiva (borde ámbar izquierdo).
- **Acceso explícito a temas dormidos** al final de la lista (tap discreto, no en la cara).
- **Botón flotante "Traer tema"** — CTA claro para contribuir. Sin fricción artificial.

### El tema individual

Al abrir un tema, la estructura es:

- **Hero del tema**: título, "traído por [nombre]" con fecha y hora, bloque de lectores de la apertura actual.
- **Lista de mensajes vertical**: sin árbol, sin indentación. Cada mensaje con avatar, nombre, timestamp, contenido.
- **Citas tipo WhatsApp**: cuando alguien responde a un mensaje específico, la cita aparece arriba como bloque con borde ámbar, mostrando nombre del citado y fragmento del mensaje.
- **Audios**: player de 15-20 segundos con ondas visibles. Después de 24h, se convierte a bloque de texto transcripto con marca "fue audio · transcripto automáticamente".
- **Composer abajo sticky**: campo de texto, botón de micrófono (audio), botón enviar.

### Estados del tema

- **Vivo**: se escribió algo en las últimas 30 días. Visible con tipografía normal.
- **Dormido**: 30+ días sin actividad. Sigue siendo visible pero con tipografía atenuada.
- **Reabierto**: cualquier mensaje reactiva al estado vivo.

### Comportamiento durante la apertura

- Lectura: disponible
- Escritura: disponible
- Registro de lectores: se acumula con nombres
- Audios: se pueden grabar y escuchar

### Comportamiento fuera de la apertura

Fuera del horario el place **no está accesible** para el contenido. Ni member ni admin/owner ven discusiones, eventos, miembros o threads. La única excepción es admin/owner, que mantiene acceso a `/settings/*` para administrar el place (incluyendo configurar el horario). Cualquier ruta no-settings muestra `<PlaceClosedView>` indicando cuándo vuelve a abrir.

Ver `docs/features/hours/spec.md` para el contrato completo del gate por rol.

---

## Features concretas

**Del tema**:

- Traído por (no autor)
- Identidad estable — el título y origen no cambian aunque la conversación derive
- Ventana de edición de 60 segundos después de escribir
- Reacciones con emoji (implícito, no diseñado explícitamente en detalle)

**De los lectores**:

- Registro durante la apertura inicial: cuenta
- Pasadas las 24h: nombres explícitos se agregan a medida que leen
- Visible como bloque en el tema individual

**De los audios**:

- Grabación 15-20 segundos máximo
- Escucha disponible por 24 horas
- Transcripción automática generada al momento de grabar
- A las 24h el audio desaparece, queda solo la transcripción como texto

**De la moderación**:

- Centralizada en admin (no distribuida)
- Miembros pueden solicitar; admin ejecuta
- No hay flags automáticos
- No hay moderación algorítmica

**De las temporadas** (opcional):

- El admin puede definir temporadas (mes, trimestre, año)
- Al cerrar una temporada, se genera un artefacto descargable: PDF, libro digital, o similar
- Los temas de esa temporada quedan archivados pero accesibles

---

## Lo que el foro NO tiene

Para proteger el primitivo de Place:

- **No hay karma/reputation/points** de miembros por postear. No hay gamificación.
- **No hay algoritmo de ranking** — los temas se ordenan cronológicamente por última actividad, no por "popularidad".
- **No hay tags/categorías** preestablecidas. Cada tema es su propio tema.
- **No hay votos up/down** en mensajes. Reacciones emoji sí (son expresión, no jerarquía).
- **No hay árbol de respuestas** — vertical con citas, plano.
- **No hay "topic has been closed"** automático por inactividad — los temas dormidos siguen accesibles y reactivables.
- **No hay notificaciones push agresivas** por respuestas. El foro se revisa cuando el place está abierto, no cuando la app lo decide.

---

## Integraciones con otros objetos del place

**Con eventos**: cada evento genera automáticamente un thread del foro que funciona como espacio de preparación colectiva, participación durante, y memoria post-evento. Ver `place-eventos-consolidado.md`.

**Con miembros**: los nombres en el foro son tappeables. Tocás el nombre de Lucía y abrís su perfil contextual del place. Desde ahí podés iniciar DM. Ver `place-miembros-consolidado.md`.

**Con biblioteca** (cuando se implemente): los documentos pueden ser referenciados desde discusiones. Un mensaje puede linkear a un documento del place.

---

## Casos de uso que funcionan

**Pub de amigos (ocho personas, jueves 19-23)**:
Los temas son conversación real: "¿viste la serie X?", "alguien prueba tal restaurant?", "qué opinan de lo que pasó en...?". Los audios se usan mucho. Los dormidos se reactivan fácil. La temporada anual se cierra como memoria.

**Taller profesional (15 personas, sábados 9-13)**:
Temas técnicos con más peso: "nuevo enfoque de testing", "librería X vs Y", "código que quiero que revisen". Menos audio, más texto largo. Citas tipo WhatsApp usadas para responder puntualmente. Biblioteca del taller complementa el foro con recursos.

**Iglesia (50 personas, siempre abierta para algunos temas)**:
Discusiones de fe, dudas, pedidos de oración, organización de actividades. Admin modera activamente. Temas sensibles pueden tener restricciones específicas.

**Empresa pequeña (30 personas, horario laboral)**:
Discusiones más formales, decisiones de producto, retrospectivas, cosas que son demasiado largas para Slack y demasiado informales para email. El horario del place refuerza que hay tiempo de trabajo y tiempo de descanso.

---

## Casos de uso que NO funcionan bien

Es importante ser honestos:

- **Comunidades de 500+ personas**: exceden el límite de 150. No es Place.
- **Soporte al cliente 24/7**: necesita horario siempre abierto y volumen que rompe el modelo íntimo.
- **Forums públicos de consulta técnica**: Stack Overflow / Reddit sirven para eso. Place es privado por diseño.
- **Chat frenético tipo Discord de gamers**: Place no está diseñado para ese ritmo.

---

## Estado

**Ontología**: cerrada. Este documento es canónico.
**UI**: mobile existe (`place-foro-ui.html`) con tres pantallas — home del place, foro (lista de temas), tema individual.
**Implementación**: no empezada.

**Lo que no tiene UI todavía**:

- Pantalla de crear/traer tema nuevo
- Pantalla de temas dormidos (lista)
- Cierre de temporada + generación de artefacto

---

## Referencias cruzadas

- `place-maestro.md` — marco general del producto
- `place-eventos-consolidado.md` — evento, que usa thread del foro como espacio
- `place-miembros-consolidado.md` — perfil del miembro, accesible desde nombres del foro
- `place-foro-ui.html` — UI mobile existente
