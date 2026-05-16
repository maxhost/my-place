# Biblioteca · objeto consolidado

Documento canónico del objeto "biblioteca" (library) en Place.

> _Última actualización: 2026-05-16._ Ontología canónica del dominio. Si una decisión de producto cambia, se actualiza acá **en la misma sesión** y se ajusta la fecha; el schema (`docs/data-model.md`) es su expresión, no su fuente.

---

## El principio

La biblioteca es el espacio para compartir **recursos más profundos y organizados que una discusión suelta**. Donde una Discusión es conversación, un recurso de biblioteca es material que se consume: un documento, un curso, una guía — con su propia área de conversación debajo.

**Un recurso es una Discusión** (la Discusión es el primitivo, ver `docs/ontologia/conversaciones.md`): mismo hilo de mensajes y mismas reglas. Cambia la **morfología del mensaje principal** (el recurso) y se le suma estructura organizativa que la Zona Discusión no tiene: **categorías**.

A diferencia de las discusiones —que no tienen categorías ni tags (cada tema es su propio tema)— la biblioteca **sí** se organiza en categorías. No es contradicción: son objetos distintos con propósitos distintos (conversar vs. organizar material).

---

## Jerarquía

```
Biblioteca (zona)
└── Categoría (la crea solo el owner)
    └── Recurso publicado (= una Discusión)
```

- **Biblioteca** es una **zona opcional**: el owner la activa/desactiva desde `/settings/*`. Desactivada no aparece en el place. (Eventos también es opcional; Discusiones es el primitivo y **no se puede desactivar** — ver `docs/data-model.md` invariantes.)
- **Categoría**: solo el **owner** la crea y configura (tipo, visibilidad, escritura). Es la unidad organizativa.
- **Recurso**: lo que se publica dentro de una categoría. Es una Discusión.

---

## La Categoría

Solo el owner crea categorías. Cada categoría tiene tres ejes de configuración:

### Tipo

- **General**: se puede publicar cualquier recurso, sin relación entre ellos.
- **Curso**: cada recurso puede declarar una **dependencia** de otro recurso de la misma categoría. Para desbloquear el recurso B hay que haber **completado** el recurso A primero.

### Visibilidad (quién ve y consume el contenido + participa en la discusión del recurso)

- **Público**: cualquier miembro del place.
- **N usuarios**: limitado a usuarios específicos.
- **N grupo**: limitado a un grupo.
- **N tier**: limitado a un tier.
- **Solo owner**: categoría privada del owner.

Como solo el owner crea categorías, el owner sí puede restringir por grupo o tier (los gestiona, sabe que existen — coherente con el modelo role-aware de `docs/ontologia/eventos.md`).

### Escritura (quién puede publicar recursos en la categoría)

- **Solo owner**
- **Público**: cualquier miembro del place.
- **N usuarios**: solo usuarios específicos.
- **N grupo**: solo miembros de ese grupo.
- **N tier**: solo miembros de ese tier.

Visibilidad y escritura tienen el mismo conjunto de opciones (público / usuarios / grupo / tier / solo owner).

### Acceso parcial

Aunque un miembro **no** tenga acceso a una categoría, **igual la ve listada** en la biblioteca (sabe que existe y de qué se trata). Lo que no puede es ver el detalle del contenido ni participar en la discusión de sus recursos sin el nivel de acceso requerido. Mismo patrón que eventos: la existencia es visible, el contenido se gatea.

Grupos y tiers son features futuras (ver `docs/decisions/0002-roles-gamificacion-handle.md` y `0003-lifecycle-cuenta-place-tombstone.md`); hasta que existan, visibilidad/escritura son público / usuarios / solo owner.

---

## El Recurso (mensaje principal)

Crear un recurso es crear una Discusión, como con los eventos. El formulario:

- **Título**: texto.
- **Texto**: cuerpo del recurso, con Lexical (enlaces, video, negritas, listas).
- **Tipo**: sin dependencia · depende de otro recurso (esta opción solo aparece en categorías tipo **Curso**).
- **Recurso previo** (si declaró dependencia): se elige **solo entre los recursos ya publicados en la misma categoría**.

Al publicar se crea la Discusión del recurso:

- El **mensaje principal** es el recurso (título + texto + material).
- Debajo, el **hilo de mensajes** funciona igual que cualquier Discusión (vertical, citas, lectores como presencia, @menciones, nunca se cierra).
- Si la categoría es **Curso**: el recurso tiene además la acción **"marcar como completado"**.

**Completado = autoreporte.** Quien consume el recurso lo marca "completado" él mismo; eso le desbloquea los recursos que dependen de este. No requiere validación de un tercero.

**Recurso bloqueado por dependencia: visible con candado.** Si B depende de A y el miembro no completó A, B aparece listado pero con candado — sabe que existe, no puede abrirlo hasta completar A. (Mismo patrón que eventos: la existencia es visible, el contenido se gatea.)

El **progreso de curso es por usuario**: cada miembro tiene su propio avance (qué recursos completó). El schema de progreso se modela en el spec de la feature, no acá (diferido, como tiers).

---

## Comportamiento por horario

Igual que el resto de las zonas: el miembro no accede fuera del horario del place; el owner sí (ver `docs/architecture.md` § "Gate de horario del place").

---

## Lo que la biblioteca NO tiene

- No es un drive/file manager genérico: es material curado y conversado, no almacenamiento.
- No hay categorías creadas por miembros: solo el owner define la estructura.
- No hay ranking de recursos ni "más vistos" (sin métricas de vanidad — ver `docs/producto.md`).
- No hay tags algorítmicos ni recomendación. La organización es humana (categorías del owner).
- No hay cierre de recursos: una Discusión nunca se cierra (`docs/ontologia/conversaciones.md`).

---

## Integraciones con otros objetos

- **Con discusiones**: un recurso es una Discusión; los mensajes de cualquier Discusión pueden @referenciar recursos de la biblioteca.
- **Con miembros**: "publicado por [nombre]" tappeable → perfil contextual → DM. Los lectores del recurso son parte de la conversación, como en toda Discusión.
- **Con eventos**: un evento puede @referenciar un recurso (material previo de un workshop, etc.).

---

## Estado

**Ontología:** cerrada — este documento es canónico. **Implementación:** no empezada (scaffold limpio; no hay UI). El detalle de pantallas y el schema de progreso/categorías viven en el spec de la feature cuando se construya, no acá.

---

## Referencias cruzadas

- `docs/ontologia/conversaciones.md` — la Discusión, primitivo del que el recurso es una variante
- `docs/ontologia/eventos.md` — otro objeto que es una Discusión con mensaje principal distinto; mismo modelo de acceso role-aware
- `docs/ontologia/miembros.md` — autores/lectores son miembros del place
- `docs/producto.md` — principios de experiencia (sin métricas de vanidad)
- `docs/architecture.md` § "Gate de horario del place" — regla técnica del gate
