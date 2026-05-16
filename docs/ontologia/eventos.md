# Eventos · objeto consolidado

Documento final del objeto "evento" en Place. Todas las decisiones tomadas.

> _Última actualización: 2026-05-16._ Ontología canónica del dominio. Si una decisión de producto cambia, se actualiza acá **en la misma sesión** y se ajusta la fecha; el schema (`docs/data-model.md`) es su expresión, no su fuente.

---

## El principio

El evento en Place no es un ítem aislado de calendario. Es un **momento compartido del lugar**, con su vibe, su preparación colectiva, su suceder, y su memoria que se integra a la identidad del place.

Place tiene dos tipos de eventos, mismo objeto en datos pero tratamiento visual y narrativo diferenciado:

- **Evento-ocasión**: único, especial, con peso individual. "Juntada presencial en Córdoba el 9 de noviembre."
- **Evento-ritual**: recurrente, parte de la identidad del place. "Misa del domingo", "Viernes de película online".

---

## Estructura del objeto evento

### Identidad

- Cover visual y/o color (vibe-first, no info-first)
- Título con peso tipográfico
- Descripción en voz del host, no formulario
- Tipo: ocasión o ritual
- Naturaleza: presencial, virtual síncrono, híbrido
- "Para quién es": texto explícito del alcance del evento

### Tiempo

- Fecha y hora de inicio (con timezone awareness para eventos virtuales con miembros distribuidos)
- Duración estimada
- Si es ritual: patrón de recurrencia (semanal, mensual, específico)

### Espacio

- Si es presencial: dirección física
- Si es virtual: link (Zoom/Meet/Discord externos, o sala integrada cuando exista)
- Si es híbrido: ambos, físico y link, requeridos

### Participantes

- Default: todos los miembros del place
- Exclusiones manuales posibles al crear
- "Para quién es" escrito explícitamente
- Confirmación texturada: voy / voy si X / no voy pero aporto Y / no voy
- Los excluidos pueden ver que el evento existe y de qué se trata, pero no pueden confirmar ni participar

### Visibilidad

- Evento visible para todo el place por default
- Solo invitados pueden confirmar/asistir/entrar al evento durante su suceder
- Memoria post-evento: visible para todo el place por default, configurable a "solo asistentes" si el creador lo define (caso típico: empresa con info sensible)

---

## Los tres momentos del evento

El evento en Place vive en tres momentos con tratamientos distintos:

### Momento 1 — Preparación colectiva (antes)

El evento genera automáticamente un **thread en el foro** del place. Este thread es el espacio de preparación colectiva, y después se transforma en memoria del evento.

En el thread se discute lo que corresponda según el tipo de evento:

- Asado presencial: quién trae qué
- Misa: intenciones a mencionar, lectura previa, qué se celebra esta semana
- Workshop: material previo, qué traer preparado, links
- Viernes de película online: votación de peli, set-up del stream, quién tiene Plex/Disney
- Juntada presencial a distancia: logística de viaje, alojamiento, quién viene de dónde

**No hay templates prescriptivos**. El thread es espacio abierto con todas las reglas del foro (verticalidad, citas estilo WhatsApp, audio efímero, "traído por"). El grupo usa el espacio según lo que necesita.

El thread está conectado bidireccional con el evento:

- Desde el evento: botón/link "conversación del evento"
- Desde el foro: el thread tiene header que dice "evento: [nombre], [fecha]" distinguiéndolo como thread de evento
- En la lista de threads del foro, los threads de evento tienen marca visual distintiva

La anticipación sube a medida que se acerca el evento. En la home del place, el evento gana peso visual cuando se acerca. El día anterior o el mismo día, es uno de los bloques protagonistas del bento.

### Momento 2 — El evento sucediendo (durante)

Durante las horas del evento:

- Si es presencial: el evento es en el mundo físico. El producto muestra punto de encuentro, mapa, contacto del organizador.
- Si es virtual síncrono: el link al evento está prominente. Se entra y se participa.
- Si es híbrido: ambos caminos disponibles, cada uno elige.

**La home del place se transforma durante el evento, pero solo para los invitados.** Si estás invitado y entrás al place durante esas horas, lo primero que ves es "el evento está pasando ahora — [botón para entrar/ver punto de encuentro]".

**Los no-invitados siguen viendo el place funcional**. Ven una nota "hay un evento en curso, no estás invitado" como información, pero pueden seguir interactuando con foro, biblioteca, etc.

**Sobre el horario del place y el evento**:

- Evento dentro del horario regular del place: se integra, el place está abierto normal, los invitados están "en el evento" mientras los demás pueden interactuar con otros objetos
- Evento presencial fuera del horario regular: el place no se abre. Solo existe el evento físico.
- Evento virtual fuera del horario regular: el place se abre solo para el evento. Si entrás, ves solo el evento, no otros objetos del place.
- Durante un evento en horario regular, para los invitados: están "dentro del evento", no en otros objetos del place.

### Momento 3 — Memoria del evento (después)

El evento terminó pero no desaparece. Entra en **período de memoria fresca** (~2-4 semanas) donde:

- El thread del foro sigue vivo — fotos, comentarios, "qué bueno estuvo", recuerdos
- El evento sigue apareciendo en la home del place pero con peso decreciente día a día
- La gente puede seguir subiendo cosas, comentando

Después de la memoria fresca, el evento pasa a **archivo del place** — parte permanente de la identidad histórica del lugar. El thread y todo su contenido quedan accesibles, pero ya no son protagonistas en la home.

Los eventos archivados se integran en la **temporada/anuario del place**. La historia del lugar es la suma de sus momentos.

---

## Eventos-ritual y acumulación como memoria cálida

Los eventos recurrentes tienen tratamiento distinto al único, aunque son el mismo objeto en datos.

**Cómo se visualiza un ritual**:

En la home del place, no aparecen 47 instancias de "misa del domingo" como lista. Aparece **el ritual como patrón**:

- La próxima instancia destacada ("Misa del domingo, mañana a las 11:00")
- La acumulación como contexto cálido ("47ª misa dominical de este año")
- La historia del ritual es accesible si el miembro quiere profundizar — todas las instancias pasadas con sus threads de memoria

**Qué NO hacemos (diferencia tonal con Duolingo/Strava)**:

- No hay "streak" que se puede "romper"
- No hay ansiedad por faltar
- No hay castigo visual si una instancia se saltea
- No hay comparación ni ranking entre miembros ("el más fiel", "el que más asistió")

**Qué SÍ hacemos**:

- La acumulación se celebra como memoria ("mirá cuánto hemos construido juntos")
- Los huecos no rompen nada — quedan como parte natural de la historia
- El valor está en lo que se hizo, no en el miedo a perderlo

Si una misa se cancela por lluvia, no "se pierde" nada. Simplemente esa semana no hay misa. La siguiente sigue el patrón. El ritual no es frágil — es tejido acumulado del place.

Esto conecta directamente con el concepto de **anuario/temporada**: al cerrar una temporada del place, los rituales acumulados quedan como parte visible de la historia. "En 2026, hicimos 48 misas dominicales. Fuimos a 12 retiros espirituales. Celebramos 8 bautismos."

---

## Lo que hereda el evento de otros objetos de Place

**Del horario del place**: la noción de tiempo del lugar se respeta y se integra.

**De las discusiones**: el thread del evento es un thread del foro con todas sus reglas.

**De los miembros**: los invitados son miembros del place, con sus avatares, nombres, contribuciones visibles. Los excluidos siguen siendo miembros del place.

**De la identidad del place**: la paleta, tipografía, mark del place se ejercen en el evento. No es un objeto con branding propio.

---

## Lo que el evento NO tiene

Para proteger el primitivo y no convertirnos en Circle:

- **No tiene waitlist** (place es íntimo, no hay tickets ni escasez artificial)
- **No tiene ticketing/cobro** (si se necesita pago, se resuelve fuera del place con otra herramienta)
- **No tiene streaming propio integrado** para el MVP (usa Zoom/Meet/Discord externos)
- **No tiene moderación algorítmica** del thread (moderación humana, como el resto del place)
- **No tiene "discover" público** (eventos son del place, no del mundo)
- **No tiene competencia de asistencia** (no hay points por asistir, ni ranking, ni comparación de asistentes; sí puede haber reconocimiento cualitativo de rol tipo "siempre presente en los eventos" — ver principio en `docs/producto.md`)

---

## Abierto para después (no MVP)

Algunas cosas que tienen sentido pensar pero no son bloqueantes para lanzar:

- **Sala de video integrada**: construir propia vs siempre externa. Por ahora externa.
- **Eventos con pago**: si la iglesia cobra retiro espiritual, ¿Place lo integra o se resuelve fuera? Por ahora fuera.
- **Invitaciones a no-miembros**: ¿un place puede invitar a alguien externo a un evento puntual? Por ahora no. Para estar en un evento, tenés que ser miembro del place.
- **Timezone display avanzado**: para eventos con gente en muchos timezones, mostrar la hora local de cada uno. Nice-to-have.
- **Integración con calendario externo** (Google Calendar, Apple Calendar): agregar el evento al calendario del usuario. Muy útil pero no core.

---

## Estado del core de Place

Con eventos cerrado, el core completo del place queda definido:

1. **Discusiones** — listo
2. **Miembros + perfil contextual + DMs** — listo
3. **Eventos** — listo (este documento)
4. **Home del place** — primer mockup bento existente, necesita refactor sin vocabulario inventado y con eventos integrados

Los objetos adicionales (biblioteca/documentos, cursos, chat en vivo, etc) son addons que pueden sumarse pero no son core.

---

## Lo que viene ahora

Con los cuatro objetos del core definidos, tres caminos posibles:

**Uno — UI del objeto evento** (pantallas: crear evento, ver evento próximo, evento durante, evento en memoria, ritual con acumulación).

**Dos — Rehacer home del place** con los cuatro objetos reales y sin vocabulario inventado. Este era el pendiente más fuerte.

**Tres — Definir los flows de producto** (onboarding de crear place, onboarding de sumarse a place, flow de invitar miembros, etc) antes de más UI de detalle.

Mi recomendación: **dos primero**. La home es lo que define la experiencia del place y todavía no la resolvimos bien. Con los cuatro objetos core cerrados, podemos rehacer la home de verdad.

Pero decime vos.
