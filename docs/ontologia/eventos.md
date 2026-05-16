# Eventos · objeto consolidado

Documento canónico del objeto "evento" en Place. Decisiones tomadas.

> _Última actualización: 2026-05-16._ Ontología canónica del dominio. Si una decisión de producto cambia, se actualiza acá **en la misma sesión** y se ajusta la fecha; el schema (`docs/data-model.md`) es su expresión, no su fuente.

---

## El principio

El evento en Place no es un ítem aislado de calendario. Es un **momento compartido del lugar**, con su preparación colectiva, su suceder, y su memoria que se integra a la identidad del place.

**Un evento es una Discusión** (la Discusión es el primitivo, ver `docs/ontologia/conversaciones.md`): mismo hilo de mensajes y mismas reglas. Lo único que cambia es la **morfología del mensaje principal** — en vez del cuerpo libre de una discusión normal, es el formulario del evento.

Eventos es una **zona opcional**: el owner la activa/desactiva desde `/settings/*` (a diferencia de Discusiones, que no se puede desactivar).

Dos tipos, mismo objeto en datos, tratamiento narrativo distinto:

- **Único (ocasión)**: especial, con peso individual. "Juntada presencial en Córdoba el 9 de noviembre."
- **Recurrente (ritual)**: parte de la identidad del place. "Misa del domingo", "Viernes de película online".

---

## Estructura: el mensaje principal del evento

No admite cover (por ahora). Es casi el mismo formulario que una Discusión:

- **Título del evento**: texto.
- **Tipo de evento**: único | recurrente.
- **Fecha del evento**: inicio y fin; si es recurrente, patrón de recurrencia (cada X días, en Y horarios).
- **Texto**: cuerpo libre como en una discusión, con Lexical (enlaces, video, negritas, listas).
- **Modalidad**: presencial → dirección física · online → link (Zoom/Meet/Discord externos) · híbrido → ambos.
- **Visibilidad / acceso**: quién puede *abrir* el evento (entrar a la Discusión, participar, ver dirección/link, confirmar). Las opciones dependen de quién crea el evento, porque **un miembro no elige abstracciones que no conoce** (ver "Visibilidad y participación").

El **hilo de mensajes** debajo del mensaje principal funciona igual que cualquier Discusión (vertical, citas, lectores como presencia, @menciones, nunca se cierra).

### Zona horaria

El evento se crea en la zona horaria del creador y **cada persona lo ve en su propia zona horaria local** — siempre, tanto presencial como online. Quien mira el evento ve la hora ya convertida a su huso: sabe sin pensar a qué hora es "para él".

### Visibilidad y participación

**Todos los miembros del place ven que el evento existe** y de qué se trata (título, tipo, cuándo, descripción), siempre. Lo que se restringe es *abrirlo*: entrar a la Discusión, participar, confirmar, ver dirección/link. Quien no tiene acceso ve que existe pero no entra ni ve dirección/link.

Opciones de acceso, según quién crea el evento (principio: un miembro nunca elige ni ve abstracciones que gestiona el owner y de las que no forma parte — coherente con identidad contextual, `docs/ontologia/miembros.md`):

- **Cualquier miembro** puede setear:
  - **Público**: cualquier miembro del place abre y participa (default).
  - **Usuarios específicos**: elige qué miembros pueden abrir/participar.
  - **Su mismo grupo**: solo si el creador ya pertenece a un grupo, puede acotar el evento a ese grupo (lo conoce porque está en él). No puede elegir grupos ajenos ni tiers — no sabe que existen.
- **El owner**, además: restringir a **cualquier grupo** o a **cualquier tier** (gestiona grupos y tiers, sabe que existen).

Grupos y tiers son features futuras (ver `docs/decisions/0002-roles-gamificacion-handle.md` y `0003-lifecycle-cuenta-place-tombstone.md`); hasta que existan, el acceso es público o por usuarios específicos.

**Confirmación texturada** (para quienes tienen acceso): voy / voy si X / no voy pero aporto Y / no voy.

**Memoria post-evento:** usa exactamente la misma configuración de acceso del evento — no es una restricción aparte. Si el evento se restringió a Y usuarios, solo ellos ven la memoria.

---

## Los tres momentos del evento

### Momento 1 — Preparación colectiva (antes)

El evento **es una Discusión** en la Zona Discusión desde que se crea: el hilo es el espacio de preparación colectiva y después se vuelve memoria. Se discute lo que corresponda según el tipo (asado: quién trae qué; misa: intenciones; workshop: material previo; película: votación y set-up; viaje: logística). **No hay templates prescriptivos** — el grupo usa el espacio según necesita.

El mensaje principal del evento distingue visualmente a esta Discusión en la lista. La anticipación sube al acercarse: el evento gana peso visual en la home del place; el día anterior o el mismo día es uno de los bloques protagonistas.

### Momento 2 — El evento sucediendo (durante)

- Presencial: punto de encuentro, mapa, contacto del organizador.
- Online: link prominente; se entra y se participa.
- Híbrido: ambos caminos disponibles, cada uno elige.

**La home se transforma durante el evento, solo para quienes tienen acceso** ("el evento está pasando ahora — [entrar / ver punto de encuentro]"). Los que no tienen acceso siguen viendo el place funcional (nota "hay un evento en curso, no podés entrar").

**Horario del place × evento:**

- Dentro del horario regular: se integra; los invitados están "en el evento" mientras los demás interactúan con otros objetos.
- Evento presencial fuera del horario regular: el place no se abre para miembros; solo existe el evento físico. (El owner siempre puede entrar — ver `docs/architecture.md` § "Gate de horario del place".)
- Evento online fuera del horario regular: el place se abre solo para el evento; si entrás, ves solo el evento.

### Momento 3 — Memoria del evento (después)

El evento **no se cierra nunca** (es una Discusión). Después de que sucede solo se le pone un **marcador visual** ("finalizado" / "memoria") y se publica igual que siempre: fotos, comentarios, recuerdos, sin límite de tiempo. No hay transición automática a "archivo" ni cierre por antigüedad — evitar tener que ir cerrando cosas solas es justamente el punto. Lo único que cambia con el tiempo es la **prominencia en la home** (pierde peso visual a medida que pasa), pero la Discusión sigue abierta. Se integra a la **temporada/anuario**: la historia del lugar es la suma de sus momentos.

---

## Eventos-ritual y acumulación como memoria cálida

El ritual se visualiza **como patrón**, no como lista de instancias: próxima instancia destacada ("Misa del domingo, mañana 11:00"), acumulación como contexto cálido ("47ª misa dominical de este año"), historia accesible para profundizar.

**NO**: streaks que se "rompen", ansiedad por faltar, castigo visual si se saltea una instancia, comparación o ranking entre miembros. **SÍ**: la acumulación se celebra como **memoria colectiva** ("mirá cuánto construimos juntos"), los huecos no rompen nada. Si una misa se cancela por lluvia, no se pierde nada — la siguiente sigue el patrón. Conecta con el anuario/temporada: "En 2026 hicimos 48 misas dominicales, 12 retiros, 8 bautismos." (Esto es acumulación colectiva permitida — ver principio en `docs/producto.md` y `docs/decisions/0002-roles-gamificacion-handle.md`.)

---

## Lo que hereda el evento

- **De la Discusión**: es una Discusión — hilo vertical, citas, lectores como presencia, @menciones, nunca se cierra.
- **Del horario del place**: la noción de tiempo del lugar se respeta e integra (con la excepción del owner).
- **De los miembros**: quienes tienen acceso son miembros del place, con sus avatares/nombres; quienes no tienen acceso siguen siendo miembros igual.
- **De la identidad del place**: paleta, tipografía y mark del place. No tiene branding propio.

---

## Lo que el evento NO tiene

Para proteger el primitivo y no convertirnos en Circle:

- No waitlist (place es íntimo, sin escasez artificial).
- No ticketing/cobro integrado. Cobrar por un evento puntual es un eje distinto del billing del place (suscripción del owner / tiers de miembro, ver `docs/decisions/0003-lifecycle-cuenta-place-tombstone.md`); queda fuera de alcance hasta su propio spec.
- No streaming propio integrado (MVP usa Zoom/Meet/Discord externos).
- No moderación algorítmica (humana, como el resto del place).
- No "discover" público (los eventos son del place, no del mundo).
- No competencia de asistencia: no points, no ranking, no comparación de asistentes. Sí reconocimiento cualitativo de rol ("siempre presente en los eventos") — ver `docs/producto.md`.

---

## Abierto para después (no MVP)

- Sala de video integrada (por ahora externa).
- Eventos con pago (eje distinto; depende del modelo de billing/tiers y su spec).
- Invitaciones a no-miembros (por ahora no: para estar en un evento hay que ser miembro del place).
- Integración con calendario externo (Google/Apple Calendar).

---

## Estado

**Ontología:** cerrada — este documento es canónico. **Implementación:** no empezada (scaffold limpio; no hay UI). El detalle de pantallas vive en el spec de la feature cuando se construya, no acá.

---

## Referencias cruzadas

- `docs/ontologia/conversaciones.md` — la Discusión, primitivo del que el evento es una variante
- `docs/ontologia/library.md` — biblioteca, otro objeto que es una Discusión con mensaje principal distinto
- `docs/ontologia/miembros.md` — invitados/participantes son miembros del place
- `docs/producto.md` — principios de experiencia (acumulación colectiva vs vanidad)
- `docs/architecture.md` § "Gate de horario del place" — regla técnica del gate (excepción owner)
