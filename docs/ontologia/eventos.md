# Eventos · objeto consolidado

Documento canónico del objeto "evento" en Place. Decisiones tomadas.

> _Última actualización: 2026-06-11 (ADR-0053 — pivot al Substack para podcasts: el evento pasa a ser un tipo de thread; muere el horario de apertura; visibilidad alineada al modelo público/comunidad/privado; nuevo origen automático — thread programado genera evento; el modelo de acceso por usuarios-específicos/grupos/tiers pre-pivot se retira)._ Ontología canónica del dominio. Si una decisión de producto cambia, se actualiza acá **en la misma sesión** y se ajusta la fecha; el schema (`docs/data-model.md`) es su expresión, no su fuente.

---

## El principio

El evento en Place no es un ítem aislado de calendario. Es **un momento compartido del show y su comunidad**, con su anticipación, su suceder, y su memoria que se integra a la identidad del place.

**Un evento es un thread** (el thread es el primitivo, ver `conversaciones.md`): mismo hilo de comentarios y mismas reglas. Lo único que cambia es la **morfología del mensaje principal** — en vez del cuerpo libre de una discusión, es el formulario del evento.

Dos orígenes:

- **Evento manual**: el owner anuncia un evento presencial u online en fecha X ("juntada de oyentes en Córdoba el 9 de noviembre", "charla en vivo por Zoom el viernes"). Si los oyentes pueden crear eventos comunitarios queda como pregunta abierta de ADR-0053 (default conservador: owner-only hasta dictado).
- **Evento generado por programación**: cuando el owner **programa un thread** (típicamente un episodio) para publicarse en fecha futura, Place **genera automáticamente el evento** de anticipación — "la próxima semana, episodio 4: lo que sea". Al llegar la fecha, el thread se publica y el evento queda como memoria. Es el mecanismo de anticipación del show, sin trabajo extra del creador.

Dos tipos, mismo objeto en datos, tratamiento narrativo distinto:

- **Único (ocasión)**: especial, con peso individual. "Juntada presencial en Córdoba el 9 de noviembre."
- **Recurrente (ritual)**: parte de la identidad del show. "Episodio nuevo todos los martes", "After mensual de oyentes".

---

## Estructura: el mensaje principal del evento

No admite cover (por ahora). Es casi el mismo formulario que una discusión:

- **Título del evento**: texto.
- **Tipo de evento**: único | recurrente.
- **Fecha del evento**: inicio y fin; si es recurrente, patrón de recurrencia (cada X días, en Y horarios).
- **Texto**: cuerpo libre como en una discusión, con Lexical (enlaces, video, negritas, listas).
- **Modalidad**: presencial → dirección física · online → link (Zoom/Meet/Discord externos) · híbrido → ambos. (Un evento generado por programación no tiene modalidad — su "lugar" es el place mismo: el thread que se va a publicar.)
- **Visibilidad**: el modelo granular de ADR-0053 — **público** (visible en la cara pública del place), **comunidad** (oyentes), o **privado** (solo suscriptores). La dirección física/link solo la ven quienes tienen acceso.

El **hilo de comentarios** debajo del mensaje principal funciona igual que cualquier thread (vertical, citas, lectores como presencia, @menciones, nunca se cierra).

### Zona horaria

El evento se crea en la zona horaria del creador y **cada persona lo ve en su propia zona horaria local** — siempre, tanto presencial como online. Quien mira el evento ve la hora ya convertida a su huso: sabe sin pensar a qué hora es "para él".

### Visibilidad y participación

**Existencia visible, contenido gateado** (mismo patrón que todo thread): según la visibilidad que el owner setee, quienes no tienen acceso pueden ver que el evento existe (título, cuándo) pero no entrar a su hilo, ver dirección/link ni confirmar. Un evento público lo ve cualquiera en la web; uno privado es un beneficio de suscriptores.

**Confirmación texturada** (para quienes tienen acceso): voy / voy si X / no voy pero aporto Y / no voy.

**Memoria post-evento:** usa exactamente la misma visibilidad del evento — no es una restricción aparte.

> _Retirado por ADR-0053:_ el modelo de acceso pre-pivot por "usuarios específicos / grupo / tier" (diseñado para la comunidad íntima ≤150) se reemplaza por el modelo de visibilidad de threads. Grupos con permisos siguen siendo feature futura posible, pero ya no son el eje del acceso a eventos.

---

## Los tres momentos del evento

### Momento 1 — Anticipación (antes)

El evento **es un thread** en el place desde que se crea: el hilo es el espacio de preparación/anticipación colectiva y después se vuelve memoria. Se conversa lo que corresponda (juntada: quién lleva qué; charla en vivo: preguntas previas; episodio programado: expectativas, pedidos). **No hay templates prescriptivos** — la comunidad usa el espacio según necesita.

El mensaje principal del evento distingue visualmente a este thread en la lista. La anticipación sube al acercarse: el evento gana peso visual en la home del place; el día anterior o el mismo día es uno de los bloques protagonistas.

### Momento 2 — El evento sucediendo (durante)

- Presencial: punto de encuentro, mapa, contacto del organizador.
- Online: link prominente; se entra y se participa.
- Híbrido: ambos caminos disponibles, cada uno elige.
- Episodio programado: al llegar la fecha, el thread del episodio se publica — "salió el episodio" es el suceso.

**La home destaca el evento en curso, solo para quienes tienen acceso** ("el evento está pasando ahora — [entrar / ver punto de encuentro]"). Los que no tienen acceso siguen viendo el place normal (pueden saber que existe, según la visibilidad).

### Momento 3 — Memoria del evento (después)

El evento **no se cierra nunca** (es un thread). Después de que sucede solo se le pone un **marcador visual** ("finalizado" / "memoria") y se sigue publicando igual que siempre: fotos, comentarios, recuerdos, sin límite de tiempo. No hay transición automática a "archivo" ni cierre por antigüedad. Lo único que cambia con el tiempo es la **prominencia en la home** (pierde peso visual a medida que pasa), pero el thread sigue abierto. La historia del show es la suma de sus momentos.

---

## Eventos-ritual y acumulación como memoria cálida

El ritual se visualiza **como patrón**, no como lista de instancias: próxima instancia destacada ("Episodio nuevo, el martes 10:00"), acumulación como contexto cálido ("episodio 47 del año"), historia accesible para profundizar.

**NO**: streaks que se "rompen", ansiedad por faltar, castigo visual si se saltea una instancia, comparación o ranking entre oyentes. **SÍ**: la acumulación se celebra como **memoria colectiva** ("mirá cuánto construimos juntos"), los huecos no rompen nada. Si una semana no hay episodio, no se pierde nada — el siguiente sigue el patrón. "En 2026 publicamos 48 episodios, hicimos 6 vivos y 2 juntadas." (Acumulación colectiva permitida — ver principio en `docs/producto.md`.)

---

## Lo que hereda el evento

- **Del thread**: es un thread — hilo vertical, citas, lectores como presencia, @menciones, nunca se cierra.
- **De los oyentes**: quienes confirman y participan son oyentes del place, con sus avatares/nombres.
- **De la identidad del place**: paleta, tipografía y mark del place. No tiene branding propio.
- **De la visibilidad granular**: público / comunidad / privado, decidido por el owner (ADR-0053 §4).

---

## Lo que el evento NO tiene

Para proteger el primitivo y no convertirnos en Circle:

- No waitlist ni escasez artificial.
- No ticketing/cobro integrado por evento puntual. Un evento solo-suscriptores se logra marcándolo **privado** (`monetizacion.md`); vender entradas sueltas es otro eje, fuera de alcance hasta su propio spec.
- No streaming propio integrado (se usa Zoom/Meet/Discord externos).
- No moderación algorítmica (humana, como el resto del place).
- No "discover" global de eventos (los eventos son del place; un evento público vive en la página del place, no en un agregador de Place).
- No competencia de asistencia: no points, no ranking, no comparación de asistentes. Sí reconocimiento cualitativo de rol ("siempre presente en los vivos") — ver `docs/producto.md`.

---

## Abierto para después (no V1)

- Sala de video integrada (por ahora externa).
- Ticketing de eventos puntuales (eje distinto; exige su propia decisión).
- Eventos creados por oyentes (pregunta abierta de ADR-0053).
- Integración con calendario externo (Google/Apple Calendar).

---

## Estado

**Ontología:** cerrada — este documento es canónico (reescrito por ADR-0053). **Implementación:** no empezada (no hay UI ni schema de eventos). El detalle de pantallas vive en el spec de la feature cuando se construya, no acá.

---

## Referencias cruzadas

- `docs/ontologia/conversaciones.md` — el thread, primitivo del que el evento es una variante; threads programados generan eventos
- `docs/ontologia/episodios.md` — el caso típico de thread programado
- `docs/ontologia/monetizacion.md` — eventos privados como beneficio de suscriptores
- `docs/ontologia/miembros.md` — confirmados/participantes son oyentes del place
- `docs/producto.md` — principios de experiencia (acumulación colectiva vs vanidad)
