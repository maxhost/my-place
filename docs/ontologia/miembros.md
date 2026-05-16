# Miembros · objeto consolidado

Documento final del objeto "miembros" en Place. Incluye identidad del usuario, perfil contextual, y DMs. Todas las decisiones tomadas. Listo para construir.

> _Última actualización: 2026-05-16._ Ontología canónica del dominio. Si una decisión de producto cambia, se actualiza acá **en la misma sesión** y se ajusta la fecha; el schema (`docs/data-model.md`) es su expresión, no su fuente.

---

## El principio

Los miembros en Place no son una sección, no son una página, no son un directorio. **Son personas que se manifiestan en los otros objetos del lugar a través de lo que hacen**. La identidad se construye por contribución al lugar, no por declaración de uno mismo.

Y la información que un miembro lleva entre distintos lugares es mínima por diseño — lo que sos en un place no viaja a otro place, excepto lo estrictamente necesario para identificarte como la misma persona.

---

## En qué se parece y en qué se diferencia a un perfil tradicional

**Se parece en**:

- Cada miembro tiene nombre y avatar
- Hay una forma de ver información sobre un miembro específico
- Hay una forma de mandarle un mensaje directo

**Se diferencia en cinco propiedades estructurales**:

### Uno — Identidad en tres capas con propósitos distintos

Un perfil tradicional es una sola entidad: tu nombre, tu bio, tus stats, todo junto y mostrado a todos igual (con permisos que ajustás).

En Place la identidad tiene **tres capas separadas** con reglas distintas:

- **Universal** (viaja entre places): lo mínimo. Nombre, avatar, handle único global. Nada más.
- **Contextual** (vive en cada place, no viaja): tu historia en este place específico — antigüedad, contribuciones, rol. Se construye por lo que hacés, no por lo que declarás.
- **Privada** (solo vos la ves): settings, lista de places a los que pertenecés, notificaciones.

Esta separación no es un feature de privacidad — es **cómo funciona la identidad por diseño**. Respeta el principio de integridad contextual: información apropiada en un contexto puede ser inapropiada en otro.

### Dos — La identidad contextual se construye por contribución, no por declaración

Un perfil tradicional tiene un campo "bio" o "about me" donde te describís. "Dev, escritor amateur, fan de Bilardo."

En Place no hay bio. **Tu identidad contextual en un place es lo que hiciste en ese place**. Cuántos temas trajiste, en cuántos participaste, qué documentos subiste, desde cuándo sos miembro, qué rol tenés. Sos lo que aportaste al lugar, no lo que dijiste que eras.

Si querés que los demás sepan algo sobre vos, lo contás en una discusión, lo traés al lugar como todo lo demás. No hay un formulario para declarar quién sos.

### Tres — No hay página "miembros"

Un producto tradicional tiene una sección "miembros" o "community" donde ves todos los perfiles en grid o lista. Esa sección suele ser la pantalla más muerta del producto — nadie la visita más de una vez.

En Place **no existe esa sección**. Los miembros se manifiestan en los lugares donde actúan: los ves en discusiones cuando hablan o leen, en la biblioteca cuando suben algo, en eventos cuando confirman, en la home del place cuando están presentes. No son una galería a la que se va — son gente con la que te cruzás en el lugar.

Si querés ver el perfil de un miembro específico, tocás su nombre desde donde lo encontraste.

### Cuatro — Derecho al olvido estructurado

Un perfil tradicional se borra y desaparece, o queda abandonado como fantasma. No hay política intermedia clara. En Place hay dos planos distintos (detalle y plazos en `docs/decisions/0003-lifecycle-cuenta-place-tombstone.md`):

- **Salir de un place:** el **contenido que creó** (temas, mensajes, eventos, documentos) queda en el place como parte del lugar, atribuido a su nombre — es del place, no del individuo. Su **rastro personal** (presencia, actividad, lecturas) en ese place se borra inmediatamente. Salir de un place no lo anonimiza ni libera su handle: sigue siendo la misma persona en los otros places.
- **Inactividad de cuenta:** si una cuenta sin pago activo no se usa por mucho tiempo, primero queda `inactivo` y, más adelante, se elimina y **anonimiza de forma irreversible** ("ex-miembro"): se borra su rastro personal, su nombre se desliga de todo su contenido y su handle se libera. Quien es owner de un place o paga está exento de esta escala.

Esto resuelve dos tensiones que la mayoría de productos no resuelve bien: privacidad real vs memoria del lugar, y olvido del individuo vs permanencia del contenido. El contenido no desaparece (es del place), pero el individuo puede desligarse.

### Cinco — No existe fuera de los places

Un perfil tradicional suele tener una URL pública — yourapp.com/user/max. Cualquiera puede buscarte. Tu perfil es independiente de las comunidades a las que pertenecés.

En Place **no hay perfil público fuera de places**. No existe "max.place.community". Si alguien no comparte un place contigo, no puede verte, buscarte, encontrarte. Place no es red social — es sistema de lugares cerrados.

Esto tiene una consecuencia fuerte: tu existencia en Place es **siempre situada**. No sos un perfil flotante con comunidades asociadas. Sos una persona en ciertos lugares.

---

## Estructura del objeto miembro

### Identidad universal (capa 1)

Lo que viaja con vos entre places:

- **Nombre elegido**: cómo te identificás. No es tu legal name. Puede ser "Max", "Max Fernandez", "maxdev", lo que quieras.
- **Avatar**: imagen o inicial con color. Se muestra en todas partes.
- **Handle único global**: identificador único en todo el ecosistema de Place. Obligatorio: se asigna uno random no usado al crear la cuenta, y el usuario puede modificarlo (única regla: que no exista otro igual). Útil para menciones cross-place y como identidad portable.

**Eso es todo lo universal**. No hay edad, género, ubicación, pronombres, bio universal. Si un place específico necesita saber esas cosas, se resuelve en la capa contextual.

### Identidad contextual (capa 2)

Lo que vive en cada place, no viaja entre places:

- **Antigüedad**: cuándo te sumaste a este place específico. "Desde marzo 2024".
- **Rol**: owner o miembro. **Owner** = creador del place o quien otro owner designe; **miembro** = todo el resto. No hay rol "admin": la administración delegada será una feature futura de *grupos con permisos granulares* que el owner crea (un grupo "admin" con miembros elegidos). Asignado por estructura, no por declaración.
- **Contribuciones**: temas que trajiste, mensajes que escribiste, documentos que subiste, eventos que creaste. Métricas de actividad real, no vanidad. Se muestran como hechos, no como puntaje.
- **Actividad reciente**: última aparición en el place, últimos temas donde participaste, últimos documentos que subiste.
- **Reconocimientos específicos del place**: si el place define títulos honoríficos, alguna marca especial. Esto es customizable por place y totalmente opcional.

La identidad contextual es **distinta en cada place**. En El Taller sos "Max que trajo 14 temas sobre Electron". En la iglesia sos "Max que fue a 23 misas este año". En el grupo de amigos sos "Max que no falta a ningún asado".

### Datos privados (capa 3)

Lo que solo vos ves:

- Settings generales (notificaciones, idioma, etc.)
- Lista de places a los que pertenecés
- Configuraciones específicas por place (notifs de cada place)
- Historial general de tu actividad

Nadie más accede a esta capa. Ni los admins de los places donde estás.

---

## El perfil contextual del miembro

Cuando tocás el nombre o avatar de Lucía desde cualquier objeto del place, abre su perfil **contextual de este place**.

No abre un perfil universal, no abre un "about page", no te lleva a otra pantalla con toda su vida digital. Abre lo que es Lucía acá, en El Taller.

**Lo que muestra**:

- Nombre + avatar + handle (capa universal)
- Antigüedad en este place: "Lucía está en El Taller desde marzo 2024"
- Sus contribuciones acumuladas en este place: "14 temas traídos, 48 mensajes, 3 documentos subidos"
- Actividad reciente: "Su último tema: TDD en proyectos chicos · reabierto hace 2 días"
- Rol: owner / miembro
- Botón para iniciar DM: "Iniciar conversación"

**Lo que NO muestra**:

- Bio escrita por ella
- Edad, género, ubicación, pronombres (a menos que ella los haya compartido en una discusión del place)
- Otros places a los que pertenece (eso es capa privada)
- Stats agregados de toda su actividad en Place
- Última vez que estuvo online en general

Si Lucía quiere que sepas más de ella, lo dice en una discusión. Es así de simple.

---

## DMs entre miembros

### Principio de los DMs

Los DMs se inician desde un place, pero viven en un inbox universal del usuario. Los places son el punto de encuentro, pero la conversación personal es tuya.

### Cómo funciona

- **Iniciación**: desde el perfil contextual de un miembro, botón "iniciar conversación"
- **Vida**: la conversación vive en un **inbox universal** de DMs del usuario, no dividido por place
- **Contexto**: cada conversación tiene metadata de contexto — "esta conversación empezó en El Taller" — para que sepas de dónde viene
- **Horario**: los DMs NO respetan el horario del place. Si Max conoció a Lucía en El Taller que abre los jueves, pueden seguir hablando cuando quieran. La relación personal trasciende el horario del lugar.
- **Una sola conversación por par**: si Max y Lucía coinciden en El Taller y también en el club de lectura, tienen una sola conversación entre ellos, no una por place. El contexto es el lugar donde se conocieron, no compartimento de la relación.

### Tratamiento al salir del place

Cuando uno de los dos sale del place donde se conocieron:

- Compartan o no otro place, la conversación sigue accesible: los DMs viven en el inbox universal, no en el place.
- Los DMs siguen la **escala de cuenta**, no la de places: si una cuenta se elimina por inactividad (ver § "Derecho al olvido"), sus mensajes pasan a "ex-miembro". Si **ambas** partes quedaron como ex-miembro, la conversación se elimina por completo.

---

## Inbox universal de DMs

Una sección del app (no del place específico) donde ves todas tus conversaciones directas con otros miembros.

**Lo que muestra**:

- Lista de conversaciones ordenadas por actividad reciente
- Cada conversación con: avatar + nombre, preview del último mensaje, timestamp, contexto (place donde se conocieron)
- Indicador de mensajes no leídos

**Lo que NO muestra**:

- Filtros por place (todas las conversaciones juntas, el place es solo contexto)
- "Sugerencias" de gente con quien hablar
- Estado online de los contactos (los DMs no son Instagram — no hay pressure de respuesta inmediata)

---

## Cómo se manifiestan los miembros en otros objetos

Como los miembros no tienen página dedicada, aparecen en contexto:

**En discusiones**:

- Avatar + nombre en cada mensaje que escriben
- Nombre visible en "traído por [Nombre]" de los temas
- Nombre visible en "leyeron esta noche: Max, Lucía, Rodri, Juan" del tema

**En eventos**:

- Avatares en el bloque de confirmados
- Nombre en "traído por [Nombre]" del evento
- Nombres en los mensajes del thread del evento

**En la home del place**:

- Avatares en el bloque de presencia ("4 adentro ahora")
- Nombres mencionados en el saludo contextual si están activos ("Max y JP están discutiendo algo jugoso")

**En la biblioteca** (cuando exista):

- Nombres en "subido por [Nombre]" de cada documento
- Nombres en comentarios sobre documentos

Cualquier nombre que aparezca en cualquier lugar es tappeable. Al tocarlo se abre el perfil contextual del miembro en este place.

---

## Estados de presencia del miembro

Los estados visibles en el place:

- **Activo escribiendo en un tema específico**: "Max está escribiendo en [título del tema]"
- **Activo leyendo/navegando sin acción específica**: "Rodri está adentro"
- **Activo en biblioteca (cuando exista)**: "Lucía está en la biblioteca"
- **App abierta en otro place**: "Martina está en otro place" o simplemente no aparece
- **Fuera de la app**: no aparece como presencia

Estos estados se muestran donde corresponde (presencia en home, indicador de "escribiendo" en discusiones, etc.). No hay un "indicator de estado" general ni selector de estado manual.

---

## Handle único global

El handle es:

- **Obligatorio y único** en todo el ecosistema de Place (nadie más puede tener el mismo a la vez).
- **Asignado automático al crear la cuenta**: un handle random que no esté en uso. El usuario puede **modificarlo** después; la única regla es que no colisione con uno existente.
- Formato: letras, números, algunos caracteres permitidos. Sin espacios.
- Visible en el perfil contextual como "@max" debajo del nombre.
- Útil para mencionar a alguien en un mensaje cross-place (si algún día se permite).
- **Ciclo de vida:** el handle se libera y vuelve a estar disponible **solo al eliminarse la cuenta** (anonimización irreversible por inactividad, ver § "Derecho al olvido"). Salir de un place NO libera el handle — seguís siendo la misma persona en los otros places. "Ex-miembro" es el estado de la cuenta tombstoned (universal), no un estado por-place.

---

## Lo que el objeto miembro NO tiene

Para proteger el primitivo:

- **No hay bio escrita por el miembro**. Tu identidad es lo que hacés.
- **No hay "followers/following"**. Place no es red social, es lugar.
- **No hay página pública del perfil fuera de places**.
- **No hay stats vanidosos** tipo "total posts, total likes". Los stats son hechos contextuales, no métricas.
- **No hay "online status"** agregado. Sabés dónde está alguien si estás en el mismo place que él/ella.
- **No hay feed de actividad** del miembro. La actividad se ve en contexto de cada objeto.
- **Reconocimiento de pertenencia/rol, no competencia.** Sí: antigüedad, hitos temporales tranquilos, insignias/títulos cualitativos por rol o forma de participar (ej. "siempre presente en eventos", "ayuda seguido en [tema]"), conferidos por estructura o por el owner. No: leaderboards, rankings, comparación entre miembros, streaks, puntos/niveles por volumen, colección competitiva de insignias. Principio canónico en `docs/producto.md`.
- **No hay "última vez online"** general. Solo visible en contexto del place.
- **No hay verificación de identidad/blue checkmark**. Sos quien decís que sos, y el place es privado por diseño.

---

## Casos de uso que funcionan

**Nuevo miembro entra al place**:
Se suma con nombre + avatar. Su perfil contextual arranca en cero — "en el taller desde hoy, 0 temas traídos". A medida que participa, se construye su historia contextual. Sin fricción de onboarding con 15 campos que llenar.

**Miembro establecido es tappeado por otro**:
Se abre perfil contextual con toda su historia en el place. Clara, densa, basada en hechos. Sin bio falsa, sin curaduría estratégica de imagen personal.

**Miembro quiere chatear privado con otro**:
Desde el perfil, botón "iniciar conversación". Abre el DM en el inbox universal. Si ya había conversación, continúa; si no, empieza.

**Miembro sale del place**:
Su contenido queda en el place con su nombre (es del place); su presencia y rastro personal ahí desaparecen inmediatamente. No se anonimiza ni pierde el handle por salir: eso solo ocurre si la cuenta se elimina por inactividad.

---

## Estado

**Ontología**: cerrada. Este documento es canónico.
**UI**: NO hay pantallas todavía. Pendientes:

- Perfil contextual del miembro (se ve al tocar un nombre desde cualquier objeto)
- Inbox universal de DMs (lista de conversaciones)
- Conversación individual de DM
- Onboarding inicial: capturar nombre + avatar (el handle se asigna random automático; editable después)

**Implementación**: no empezada.

---

## Referencias cruzadas

- `docs/producto.md` — visión y principios de experiencia (marco general)
- `docs/ontologia/conversaciones.md` — donde los miembros se manifiestan hablando
- `docs/ontologia/eventos.md` — donde los miembros se manifiestan confirmando y asistiendo
- `docs/data-model.md` — expresión en schema (capas de identidad, derecho al olvido)
