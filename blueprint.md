# Place · documento maestro

Documento índice y marco general del producto. Punto de entrada para cualquier sesión futura de diseño o construcción.

---

## El primitivo

**Place es un lugar digital con horario, inhabitado por un grupo afín, que existe como espacio real de encuentro y pertenencia.**

No es una app. No es una red social. No es una plataforma de comunidad estilo Circle o Discord. Es una categoría distinta de objeto en el vocabulario de internet, caracterizado por tres propiedades estructurales que no están presentes combinadas en ningún producto existente:

1. **Horario propio** — el place abre y cierra en momentos definidos por sus miembros. Fuera del horario, el place no está accesible: no se entra al contenido, no hay lectura ni escritura. Solo el admin/owner conserva acceso a la configuración para poder abrirlo.
2. **Existencia Schrödinger** — si no hay observador, el place no se manifiesta. Se materializa cuando alguien entra.
3. **Pertenencia como primitivo** — el place no es un contenedor que contiene miembros. El place ES sus miembros encontrándose en un momento. Sin gente presente, no hay lugar.

Estas tres propiedades son no-negociables. Cuando alguna se suaviza, Place se vuelve Circle con otra tipografía.

---

## Por qué Place no es Circle con otro skin

Durante el diseño apareció la preocupación legítima: si Circle también tiene discusiones + eventos + miembros + documentos, branded, privado por default, ¿cuál es la diferencia real?

La respuesta es estructural, no de features:

- **Circle**: contenedor permanente donde una comunidad deposita contenido. Siempre abierto. El contenido es lo central.
- **Place**: evento recurrente al que una comunidad asiste. Con horario. El encuentro es lo central.

Átomos similares (texto, audio, eventos). Estructura distinta. Por las mismas razones que Twitter no es Facebook aunque ambos tengan posts y profiles. Las restricciones estructurales producen experiencias fundamentalmente distintas.

La receta de "añadir reglas nuevas a átomos viejos" es exactamente cómo se crean categorías nuevas (Snapchat, Twitter, Discord, TikTok). No necesitamos inventar telepatía.

---

## Propiedades del objeto place

### Escala

- **Máximo 150 miembros por place**. No es restricción técnica, es restricción de diseño. Aproxima el número de Dunbar — el límite superior de relaciones sociales estables que un humano puede sostener. Places más grandes dejan de ser lugares y se vuelven plataformas.
- Si un grupo necesita más granularidad (una parroquia con coro, catequistas y jóvenes), son places separados. La "parroquia completa" es un place, "el coro" es otro. Los miembros pueden estar en ambos.

### Identidad visual

- Cada place tiene identidad propia: paleta, tipografía, mark. Esto lo configura el admin al crear.
- La identidad visual es customizable por place. El vocabulario funcional de los objetos NO es customizable (foro/discusiones, eventos, miembros, etc. tienen nombres consistentes en el producto).
- La identidad visual se mantiene estable sobre contenido variable. Reconocés que es El Taller aunque cada vez veas cosas distintas.

### Horario

- Definido al crear el place por el admin fundador.
- Puede ser: horario fijo recurrente (jueves 19-23), múltiples ventanas (sábados y domingos de mañana), siempre abierto por ahora (empresas que lo necesitan así), etc.
- El horario es **el alma del lugar**, no una feature. Ejerce fuerza real sobre cómo se comporta el producto.
- Fuera del horario: el place no está accesible. No hay lectura ni escritura, ni siquiera del foro. El gate es duro y uniforme (no configurable por feature). La única excepción es admin/owner, que conserva acceso a `/settings/*` para administrar y eventualmente abrir el lugar. Ver `docs/features/hours/spec.md`.

### Membresía

- Public / private / sponsorship como opciones de acceso.
- Voto anónimo opcional para expulsión.
- Transferible: el fundador puede pasar titularidad a otro miembro. No a desconocidos.
- Al salir de un place: el contenido que creaste queda en el place. Por 365 días sigue atribuido a tu nombre (trazabilidad legal). Pasados 365 días, pasa a "ex-miembro" — tu nombre se desliga. Tu rastro personal (presencia, lectura) se borra al salir, sin esperar.

### Modelo económico

- Founder paga ($10-30/mes), miembros no pagan.
- Target: 1000-5000 founders activos = $10-75k MRR. Viable para solo-founder.
- Para vos como founder: cada place es revenue, lo cual incentiva a que los admins creen places específicos en vez de mega-places genéricos. Refuerza la filosofía de intimidad.

### Customización y addons

- El admin elige qué objetos core activar (todos están disponibles, pero algunos casos no necesitan eventos, por ejemplo).
- Customización por admin: paleta, tipografía, mark, tagline, horario, nombre del lugar.
- Addons curados (8-15 al inicio, sin terceros) para casos específicos.

---

## Los cuatro objetos core

Cada place puede incluir estos objetos. Los tres primeros son usados por casi todos los places. El cuarto es opcional pero frecuente.

### 1. Discusiones (el foro reimaginado)

El espacio central de conversación del place. Temas traídos por miembros, conversación vertical, audios efímeros que se transcriben, registro de lectores.

**Estado**: cerrado ontológicamente + UI mobile ✓
**Documento consolidado**: `place-discusiones-consolidado.md`
**UI**: `place-foro-ui.html`

### 2. Miembros + Perfil + DMs

Identidad del usuario a tres niveles: universal mínima portable, contextual por place construida por contribuciones, privada solo propia. Los miembros no son una página dedicada — se manifiestan en los otros objetos. DMs en inbox universal, se inician desde el perfil contextual.

**Estado**: cerrado ontológicamente (sin UI propia porque miembros no es página)
**Documento consolidado**: `place-miembros-consolidado.md`
**UI**: No hay pantalla "miembros". Se ve en contexto dentro de otros objetos.

### 3. Eventos

Momento compartido del lugar, con preparación colectiva, participación diferida, memoria que se integra al tejido del place. Distinción entre evento-ocasión (único) y evento-ritual (recurrente).

**Estado**: cerrado ontológicamente + UI mobile ✓
**Documento consolidado**: `place-eventos-consolidado.md`
**UI**: `place-evento-ui.html`

### 4. Biblioteca / Documentos

Contenido persistente que el place guarda como recurso: documentos, guías, recursos, link útiles. Importante para places de empresa o iglesia, opcional para grupos de amigos.

**Estado**: no reimaginado todavía. Para MVP puede ser una versión simple y se reimagina después.

---

## Home del place

La home es la pantalla que ves al entrar al place. No es un menú de zonas ni un dashboard — es una **portada editorial** con bento grid que muestra lo relevante del place ahora para vos.

**Principios**:

- Se compone de bloques de tamaños distintos con contenido real
- Jerarquía visual basada en qué importa ahora, no en igualdad de opciones
- Identidad visual estable, contenido variable por momento y miembro
- Para MVP: reglas determinísticas. Para producción: AI generativo por miembro.
- Sin bottom nav, sin feed, sin scroll infinito, sin dashboard de métricas

**Estado**: primer mockup bento existe (`place-home-mobile.html`) pero necesita refactor sin vocabulario inventado ("la barra", "el estante") y con los cuatro objetos reales integrados correctamente. Pendiente tras cerrar los objetos.

---

## Principios de diseño no negociables

Surgieron a lo largo del proceso y protegen el primitivo contra tentaciones de dilución:

1. **Tres decisiones del fundador dan identidad** (tipografía, paleta, mark) + tagline + horario. Eso es el setup mínimo.
2. **Menos es más** — saturación es fracaso de diseño.
3. **Misma identidad visual de la puerta al interior** — no hay salto estético entre home y objetos.
4. **Customización > Personalización** — el founder decide cosas reales que afectan el lugar, no el algoritmo decide por vos.
5. **Los miembros tienen agencia real**, no solo el founder decora.
6. **El horario es el alma del lugar, no una feature**.
7. **Memoria anclada en el espacio, no en feeds**.
8. **Mobile-first** — target Gen Z y millennials.
9. **Las mecánicas no interfieren con casos de uso diversos** — tiene que funcionar para iglesia, empresa, pub de amigos.
10. **Renaming de objetos mapea 1:1 con objetos reales** — "biblioteca" en lugar de "documentos" es válido porque biblioteca ES donde viven documentos. "La barra" como zona inventada NO es válido porque no mapea a nada real.
11. **Place no hace todo** — no tiene waitlist, ticketing, streaming propio, moderación algorítmica, "discover" público, ni gamificación. Esas son no-features intencionales.

---

## Target y posicionamiento

**Usuario target**:

- Fundadores/organizadores de comunidades pequeñas (8-150 personas)
- Iglesias, empresas, grupos de amigos, talleres, clubs, comunidades profesionales
- Que valoran intimidad > alcance
- Dispuestos a pagar por una herramienta buena ($10-30/mes)

**Posicionamiento**:

- Contra Circle: "Circle es el Slack de las comunidades. Place es el pub semanal."
- Contra Discord: "Discord está siempre abierto y ruidoso. Place abre cuando tiene que abrir."
- Contra WhatsApp group: "WhatsApp es el grupo sin forma. Place es el grupo con lugar y horario."
- Contra Eventbrite/Partiful: "Partiful es el evento suelto. Place es el lugar donde los eventos pasan."

---

## Estado del producto (abril 2026)

**Diseño ontológico**:

- ✓ Primitivo definido
- ✓ Propiedades del place como contenedor
- ✓ Discusiones consolidado
- ✓ Miembros/perfil/DMs consolidado
- ✓ Eventos consolidado
- ✗ Biblioteca/documentos — postponed

**Diseño UI**:

- ✓ Foro/discusiones (pantalla principal + tema individual)
- ✓ Evento (home integrado + form creación + thread)
- ✓ Home del place (primer mockup bento, necesita refactor)
- ✗ Perfil contextual del miembro — no hecho
- ✗ DMs inbox universal — no hecho
- ✗ Onboarding de crear place — no hecho
- ✗ Onboarding de sumarse a place — no hecho

**Implementación**:

- No empezada. Fase de diseño todavía.

---

## Archivos relacionados

Ordenados por relevancia actual, de más importante a menos:

**Documentos ontológicos cerrados (canónicos)**:

- `place-maestro.md` (este documento)
- `place-discusiones-consolidado.md`
- `place-miembros-consolidado.md`
- `place-eventos-consolidado.md`

**UI mobile**:

- `place-home-mobile.html` (necesita refactor)
- `place-foro-ui.html`
- `place-evento-ui.html`

**Research / investigación de apoyo** (para consultar si surge duda):

- `place-concepto.md` (concepto original completo)
- `place-research-pertenencia.md`
- `place-home-patterns-2026.md`
- `place-home-research.md`
- `place-miembros-research.md`
- `place-eventos-research.md`

**Artefactos obsoletos** (conservados por registro histórico pero no usar como referencia):

- `place-mockup.html` (isometric, rechazado)
- `place-mockup-mobile.html` (dashboard saturado, rechazado)
- `place-interior.html` (zonas inventadas, rechazado)
- `place-mockup-direccion-a.html` (la puerta del lugar, aprobado pero superseded)
- `place-investigacion-ui.md` (dirección isometric, descartada)
- `place-objetos.md` (dicotomía content/habitar, rechazada)

---

## Siguientes pasos sugeridos

Cuando retomes el diseño, el orden lógico es:

1. **Rehacer home del place** con los cuatro objetos reales, sin vocabulario inventado, usando lo aprendido (bento editorial, generative UI concept).
2. **UI del perfil contextual del miembro** — cuando tocás un nombre desde cualquier objeto.
3. **UI de DMs inbox universal** — la lista de conversaciones y una conversación individual.
4. **Flows de onboarding** — crear place, sumarse a place, invitar miembros.
5. **Estados adicionales del evento** — durante el evento, memoria post-evento, ritual con acumulación de instancias.
6. **Biblioteca/documentos** — reimaginación (opcional, puede ser MVP simple).

---

## Nota sobre el proceso

Este producto se diseñó iterando entre ontología y UI en múltiples pasadas. Algunas lecciones del proceso que vale la pena recordar:

- **Ontología antes de UI siempre**. Cuando saltamos a UI sin cerrar ontología, saturamos o inventamos cosas falsas.
- **Reimaginar es reimaginar, no renombrar**. Darle otra etiqueta a un objeto viejo no lo cambia. Hay que preguntar qué cambia estructuralmente cuando el objeto vive en un place con horario y pertenencia.
- **Las restricciones productivas se descubren tarde**. El límite de 150, el horario como no-negociable, el hecho de que miembros no es una página — todo apareció durante el proceso, no desde el inicio.
- **La universalidad diluye**. Intentar que funcione para todos los casos empuja al promedio. Pero con el marco correcto (horario como primitivo, preparación colectiva, participación diferida, memoria acumulada) puede servir a iglesia, empresa y pub sin traicionar el primitivo.
- **Templates fuerzan estructura falsa**. Cuando los casos de uso son infinitos (preparación de evento, bio del miembro), mejor espacio abierto con buena metáfora que templates prescriptivos.
