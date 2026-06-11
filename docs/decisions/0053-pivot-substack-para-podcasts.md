# ADR-0053 — Pivot de producto: el Substack para podcasts

- **Fecha:** 2026-06-11
- **Estado:** aceptada
- **Relación con ADRs previas:** supersede la visión de producto "cozytech ≤150 personas" como definición del producto (sin ADR propia — vivía en `docs/producto.md` pre-pivot) · supersede ADR-0007 §horario-default como comportamiento de producto (el default `opening_hours` queda como columna dormida) · refina ADR-0002/0003 (la noción "tier de miembro" se reorienta a suscripción de oyente vía Stripe Connect) · cierra el TBD de Pagos de `stack.md` en dirección **Stripe Connect** · desprioriza la ontología de library (`docs/ontologia/library.md`) · NO toca la infraestructura: multi-tenancy, custom domains, SSO (ADR-0032), members/invitations (ADR-0044), settings, R2 (ADR-0048) se conservan tal cual.

## Contexto

Place venía siendo "un generador de espacios digitales para comunidades íntimas" (cozytech, máx 150 personas, horario de apertura, privado por diseño). El 2026-06-11, tras el review production-grade, el owner pivotea el producto: **Place pasa a ser el Substack para podcasts**. El podcaster crea su place y ahí tiene todo lo que hoy arma con 4 herramientas separadas: hosting + RSS del podcast (Spotify/Apple Podcasts resuelven contra Place), página pública del show (se ahorra la web aparte), blog con SEO, y comunidad de oyentes con monetización directa.

La infraestructura construida (multi-tenancy por subdominio, custom domains con SSO, miembros/invitaciones, settings, storage R2, observability, rate-limiting, CSP) es exactamente la que este producto necesita — el pivot cambia el **dominio**, no la plataforma.

## Decisión

### 1. El primitivo pasa de "Discusión" a **Thread**, con tipos

El thread conserva todas las propiedades estructurales del primitivo anterior (hilo vertical de comentarios, citas, lectores como presencia, nunca se cierra, pertenece al place). Lo que cambia es que la "morfología del mensaje principal" se formaliza en **tipos de thread**:

- **Discusión general** — la conversación de la comunidad. La pueden traer los oyentes.
- **Episodio** — thread con player embebido (audio/video en R2) + comentarios. **Solo el owner** lo crea. Se distribuye por RSS.
- **Blogpost** — thread de contenido editorial público, con trabajo SEO/GEO. **Solo el owner** lo crea.
- **Evento** — thread que anuncia un evento presencial u online en fecha X (ya existía como variante; se conserva).

### 2. RSS: Place genera y mantiene el feed del podcast

Place es el hosting del podcast: genera y mantiene el feed RSS de cada place para que Spotify, Apple Podcasts y demás agregadores resuelvan los episodios. Es infraestructura nueva sin nada previo en el repo. El media (audio/video) vive en R2 (ADR-0048, wrapper ya existente).

### 3. Monetización: threads privados detrás de la suscripción del oyente, vía Stripe Connect del creador, **0% para Place**

- La suscripción paga del oyente desbloquea los **threads marcados como privados** (típicamente episodios exclusivos, pero cualquier tipo de thread puede ser privado).
- El creador conecta **su propia cuenta de Stripe** (Stripe Connect). El dinero de los oyentes va al creador; **Place no toma comisión** de eso.
- El revenue de Place sigue siendo la suscripción SaaS del creador (modelo ADR-0003/0005: trial 30 días + suscripción del owner; pricing concreto TBD).
- Esto **cierra el TBD de Pagos** de `stack.md` en dirección Stripe Connect (la integración concreta se especifica al construir el feature).

### 4. Visibilidad: el owner controla la frontera público/privado con granularidad

- A nivel place: el owner decide si su **comunidad es pública o privada** (si los anónimos pueden leer lo que pasa adentro).
- Granular por objeto: **thread público o privado · comentarios públicos o privados · eventos públicos o privados**.
- Tres niveles de acceso emergen del modelo: **anónimo** (web pública + RSS), **oyente** (se unió a la comunidad), **suscriptor** (oyente con suscripción paga activa → threads privados). La existencia de lo gateado puede ser visible aunque el contenido no (patrón "existencia visible, contenido gateado" que ya era canon).

### 5. Programación de threads → evento automático

El owner puede **programar un thread** para que se publique o abra en una fecha futura; programarlo **genera un evento** en el place ("la próxima semana, episodio 4: …"). El evento es la anticipación; el thread programado es el contenido.

### 6. Miembros pasan a ser **oyentes**; mueren el límite de 150 y el horario de apertura

- **No hay más límites de tamaño**: el invariante "máx 150 miembros" muere. Un podcast puede tener la audiencia que tenga.
- **No hay horario de apertura**: el place está siempre abierto. El RSS y la página pública no pueden "cerrar", y la comunidad tampoco cierra. El gate de horario (que nunca llegó a implementarse en código) se elimina del canon.
- El vocabulario cambia: **miembro → oyente**. El modelo de identidad en 3 capas (universal / contextual / privada), el derecho al olvido y los DMs se conservan.

### 7. Métricas: modelo dual

- **Para el creador (audiencia):** métricas estándar de la industria, porque las necesita para vender publicidad. El estándar es **IAB Podcast Measurement Technical Guidelines v2.2** (IAB Tech Lab) — ver §Anexo métricas abajo. Esto NO es métrica vanidosa: es herramienta de trabajo del podcaster, visible solo para el owner.
- **Para la comunidad:** se mantienen los principios calm pre-pivot — sin métricas vanidosas, sin rankings ni comparación entre oyentes, sin feed algorítmico, sin urgencia artificial.

### 8. Library se desprioriza

La ontología de biblioteca (`docs/ontologia/library.md`) queda **desprioritizada** — no es prioridad del pivot. Se revalidará en el futuro si las comunidades la necesitan (el doc se conserva con banner, no se borra).

## Qué muere (canon pre-pivot que deja de ser válido)

| Muere | Dónde vivía | Estado en código |
|---|---|---|
| Máx 150 miembros (invariante) | `data-model.md`, `producto.md`, ontologías | Sin enforcement real en código; se limpia de docs ya, de DEFINERs si alguno lo chequea, en migración futura |
| Horario de apertura + gate `<PlaceClosedView>` | `producto.md`, `conversaciones.md`, `eventos.md`, `architecture.md` §Gate | `place.opening_hours` queda **columna dormida** (se setea default al crear; ningún gate la lee). Remover en migración futura |
| Enum `billing_mode` (`OWNER_PAYS`/`OWNER_PAYS_AND_CHARGES`/`SPLIT_AMONG_MEMBERS`) | `data-model.md` | Columna NOT NULL en schema con default app-side. El modelo nuevo es ortogonal (creador paga SaaS + cobra por Connect). Reemplazar en migración futura del feature monetización |
| "Privado por diseño" como identidad total del producto | `producto.md`, `miembros.md` | — (la frontera público/privado pasa a ser configurable por el owner) |
| Casos de uso canónicos (pub, taller, iglesia, empresa) | ontologías | — (pasan a podcasters) |
| Temporadas/anuario como cierre de ciclo | `conversaciones.md` | Nunca implementado; se retira del canon (un podcast no "cierra temporada de comunidad"; revisitable) |

## Qué sobrevive (se conserva o se fortalece)

- **El thread como primitivo del que derivan los demás objetos** — el pivot lo fortalece: episodio, blogpost y evento son threads con morfología distinta, exactamente la jugada que ya hacían eventos y library.
- **Los principios calm de la comunidad** (sin métricas vanidosas entre oyentes, sin feed algorítmico, sin urgencia, presencia silenciosa, reconocimiento de pertenencia sin competencia) — son el diferencial frente a YouTube/Spotify/Patreon.
- **Identidad en 3 capas, derecho al olvido, DMs, handle global** (`miembros.md` → oyentes).
- **Threads traídos, no autorizados; nunca se cierran; lectores como presencia** (en la comunidad).
- **Toda la plataforma**: multi-tenancy, custom domains + SSO, invitations, settings, i18n 6 locales, identidad visual por place, R2, Sentry, rate-limiting, CSP.

## Anexo métricas: el estándar de la industria (research 2026-06-11)

Lo que el podcaster necesita para vender publicidad, y cómo se mide:

- **El estándar es IAB Podcast Measurement Technical Guidelines v2.2** (IAB Tech Lab). La medición es **server-side sobre los requests del archivo de audio** (logs del host/CDN — en nuestro caso, la capa de delivery de media R2/RSS): un "download válido" exige filtrar bots/user-agents conocidos (lista IAB), dedupe por IP+User-Agent en ventana de 24h, y un umbral mínimo de descarga (≥1 minuto de audio). Existe un programa de **certificación IAB** para hosts que da credibilidad ante anunciantes (futuro, no V1).
- **Las métricas que se usan para vender:** downloads por episodio (la métrica de negociación de CPM, típicamente medida en ventana de 7/30 días post-publicación), oyentes únicos (unique listeners/devices), distribución geográfica, y breakdown por app/plataforma de consumo.
- **Lo que el host NO ve:** engagement in-app (completion rate, retention curves) vive en las consolas de los agregadores (Apple Podcasts Connect, Spotify for Creators) porque el consumo ocurre en sus apps. Se complementa enlazando esas consolas, no se replica.
- **Implicación para Place:** al servir nosotros el RSS y el media, Place ES la hosting platform → puede medir IAB-style en la capa de delivery sin depender de terceros. El detalle de implementación (qué se loguea, dónde, agregación) va al spec del feature métricas, no acá.

Fuentes: [IAB Tech Lab — Podcast Measurement Guidelines](https://iabtechlab.com/standards/podcast-measurement-guidelines/) · [Guidelines v2.2 (PDF)](https://iabtechlab.com/wp-content/uploads/2024/02/PodcastMeasurement_v2.2_pc.pdf) · [Podigee — IAB compliance explained](https://www.podigee.com/en/blog/podcast_iab_compliance_certification_explained/) · [CoHost — downloads vs unique listeners](https://www.cohostpodcasting.com/resources/difference-between-downloads-and-unique-listeners) · [RSS.com — podcast analytics](https://rss.com/blog/understanding-your-podcast-analytics/) · [Apple Podcasts for Creators — listener analytics](https://podcasters.apple.com/support/5392-listener-analytics)

## Alternativas rechazadas

- **Mantener el producto genérico de comunidades cozytech** — decisión de mercado del owner: el nicho podcasts tiene un job-to-be-done claro (hosting + web + blog + comunidad + monetización hoy son 4 herramientas) y la plataforma construida calza sin refactor.
- **Place toma comisión de las suscripciones de oyentes** (modelo marketplace) — rechazado: el 0% es el diferencial frente a Patreon/Supercast/Apple (15-30%); el revenue de Place es la suscripción SaaS del creador, alineado con Substack-para-podcasts como posicionamiento.
- **Delegar RSS/hosting a un tercero** (creador trae su feed de Libsyn/Transistor) — rechazado: el RSS ES el core del valor ("tu podcast vive acá"); sin él, Place sería solo otra comunidad satélite.
- **Borrar `docs/ontologia/library.md` y el slice de temporadas** — rechazado borrar docs: library queda con banner de despriorización (costo cero, revalidable); temporadas se retira del canon pero la historia queda en git.

## Consecuencias

1. **Docs reescritos en esta misma tanda (S3):** `producto.md` (visión nueva), `conversaciones.md` (→ Threads), `eventos.md` (sin horario, + thread programado→evento), `miembros.md` (→ oyentes), `library.md` (banner), ontologías nuevas `episodios.md` / `blogposts.md` / `monetizacion.md`, `data-model.md` (banner de divergencia schema↔dominio), `stack.md` (Pagos → Stripe Connect), `architecture.md` (gate de horario retirado), `CLAUDE.md` (mapa de docs).
2. **Deuda de schema explícita (migraciones futuras, NO en esta sesión):** remover/reemplazar `billing_mode`, remover `opening_hours` (hoy dormida con default), modelar thread/episodio/blogpost/suscripción cuando cada feature se especifique. El schema actual NO se toca — ningún cambio de código en S3.
3. **`docs/landingpage/`** queda desactualizada (vendía el producto pre-pivot); se reescribe cuando se rehaga la landing, fuera de este scope.
4. La pausa de style-assist (ADR-0020/0051) y member-profile (ADR-0050) no se ven afectadas.

## Preguntas abiertas (a dictar antes de implementar cada feature)

- **Alta de oyentes:** ¿self-service desde la página pública (modelo Substack), solo invitación, o configurable por el owner? Las invitaciones existentes sobreviven como mecanismo; el alta abierta es nueva.
- **Feed privado para suscriptores:** ¿los episodios privados se consumen solo en el player web, o también vía RSS privado tokenizado per-suscriptor (patrón Substack/Patreon/Supercast)? Define infraestructura del feature RSS.
- **¿Los oyentes pueden crear threads de tipo evento?** Pre-pivot cualquier miembro podía crear eventos; el dictado del pivot solo confirmó al owner. Default conservador hasta dictado: owner sí, oyentes a confirmar.
- **Pricing de la suscripción SaaS creador→Place** (monto, tiers de plataforma) — TBD de siempre, ahora con dirección clara.
- **Precio único vs tiers de la suscripción de oyentes** — V1 asume precio único del creador; tiers múltiples a revalidar.
