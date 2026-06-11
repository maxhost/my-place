# Episodios · objeto consolidado

Documento canónico del objeto "episodio" en Place. Nace con el pivot (ADR-0053).

> _Última actualización: 2026-06-11 (ADR-0053 — pivot al Substack para podcasts)._ Ontología canónica del dominio. Si una decisión de producto cambia, se actualiza acá **en la misma sesión** y se ajusta la fecha; el schema (`docs/data-model.md`) es su expresión, no su fuente.

---

## El principio

El episodio es **la unidad de publicación del podcast**: el audio o video del show, publicado en el place y distribuido a los agregadores. Es el objeto por el que existe todo lo demás — la página pública lo muestra, el RSS lo distribuye, la comunidad lo conversa, la suscripción lo desbloquea cuando es privado.

**Un episodio es un thread** (el thread es el primitivo, ver `conversaciones.md`): mismo hilo de comentarios y mismas reglas. Lo que cambia es la **morfología del mensaje principal** — en vez del cuerpo libre de una discusión, es el **player embebido** con los datos del episodio.

**Solo el owner crea episodios.** El episodio es la voz del show.

---

## Estructura: el mensaje principal del episodio

- **Título del episodio.**
- **Player embebido**: audio o video. El media vive en **R2** (wrapper `shared/lib/storage`, ADR-0048); el player lo sirve desde nuestra infraestructura.
- **Show notes**: cuerpo libre con Lexical (enlaces, negritas, listas, capítulos si el creador los escribe). Es el espacio editorial del episodio.
- **Metadata de publicación**: fecha de publicación, duración, número de episodio/temporada si el creador lo usa.
- **Visibilidad**: público (web + RSS) o **privado** (solo suscriptores — ver `monetizacion.md`).

El **hilo de comentarios** debajo funciona igual que cualquier thread (vertical, citas, lectores como presencia, @menciones, nunca se cierra). La visibilidad de los comentarios es independiente de la del episodio: un episodio público puede tener comentarios solo-comunidad (control granular del owner, ADR-0053 §4).

### Publicación programada

Un episodio puede **programarse** para publicarse en fecha futura. Programarlo **genera un evento** en el place ("la próxima semana, episodio 4: …") que ancla la anticipación de la comunidad. Al llegar la fecha, el episodio se publica y el evento queda como memoria. Ver `eventos.md`.

---

## Distribución: el feed RSS

Place es el **hosting del podcast**: genera y mantiene el feed RSS de cada place para que los agregadores (Spotify, Apple Podcasts, Pocket Casts, etc.) resuelvan los episodios. El creador se da de alta en los agregadores apuntando a su feed de Place — y no necesita ningún otro hosting.

- **El feed es por place** y vive bajo el dominio del place (subdominio o custom domain).
- **Los episodios públicos** entran al feed con su media URL servida desde nuestra infraestructura (R2 detrás de la capa de delivery — la URL pública es nuestra, lo que habilita la medición, ver §Métricas).
- **Los episodios privados** no entran al feed público. Cómo los consumen los suscriptores fuera del player web (feed RSS privado tokenizado per-suscriptor, patrón Substack/Patreon) es una **pregunta abierta** de ADR-0053 — se decide en el spec del feature RSS.
- El formato del feed (RSS 2.0 + namespace `itunes:` + `podcast:` namespace moderno) es detalle del spec del feature, no de esta ontología. La regla de producto: **el feed cumple lo que los agregadores exigen** — es infraestructura de distribución, no un lugar para creatividad.

---

## Métricas de audiencia (del creador)

El podcaster necesita métricas **estándar de la industria** para vender publicidad. Place, al servir el RSS y el media, es la hosting platform → mide en su propia capa de delivery. Canónico del research: ADR-0053 §Anexo métricas.

- **El estándar es IAB Podcast Measurement Technical Guidelines v2.2** (IAB Tech Lab): medición server-side sobre los requests del archivo de media. Un "download válido" exige filtrar bots/user-agents (lista IAB), dedupe por IP+User-Agent en ventana de 24h, y umbral mínimo de descarga (≥1 minuto de audio).
- **Las métricas que el creador ve** (su dashboard, visible solo para el owner): **downloads por episodio** (la métrica con la que se negocia CPM con anunciantes, típicamente en ventana de 7/30 días post-publicación), **oyentes únicos**, **geografía**, **apps/plataformas de consumo**, tendencia en el tiempo.
- **Lo que Place no mide** (y no finge medir): engagement in-app de los agregadores (completion rate, retention curves) — eso vive en Apple Podcasts Connect / Spotify for Creators, porque el consumo ocurre en sus apps. Se complementa enlazando esas consolas.
- **Certificación IAB Tech Lab**: existe para hosts y da credibilidad ante anunciantes. No es V1; queda como aspiración del feature métricas.
- **Frontera con los principios de comunidad:** estas métricas son **herramienta de trabajo del owner**, privadas. Nunca se muestran como decoración social en la comunidad ("este episodio tiene 10k plays" no aparece para los oyentes). El principio "sin métricas vanidosas" de `producto.md` gobierna todo lo visible entre oyentes.

---

## Lo que hereda el episodio

- **Del thread**: hilo de comentarios vertical, citas, lectores como presencia, @menciones, nunca se cierra, pertenece al place.
- **De la identidad del place**: paleta, tipografía y mark del place. El player es del show, no un embed de terceros con branding ajeno.
- **De los oyentes**: quienes comentan son oyentes del place, con sus avatares/nombres.

---

## Lo que el episodio NO tiene

- **No hay hosting externo**: el media vive en R2 y el feed lo genera Place. Un episodio no es un link a YouTube/Spotify — es el archivo, acá. (Referenciar clips externos en show notes, sí.)
- **No hay métricas públicas de consumo** ("X plays") visibles para oyentes o anónimos.
- **No hay ranking de episodios** ("los más escuchados") en la cara pública ni en la comunidad — el orden es cronológico/editorial del creador.
- **No hay transcripción/clips automáticos en V1** — candidatos a futuro; requieren su propia decisión.
- **No hay streaming en vivo** — el episodio es media publicado, no transmisión.

---

## Estado

**Ontología:** cerrada — este documento es canónico. **Implementación:** no empezada (no hay schema de episodios, ni player, ni feed RSS, ni capa de métricas — todo es infraestructura nueva post-pivot). El detalle de pantallas, formato del feed y pipeline de medición viven en los specs de los features cuando se construyan, no acá.

---

## Referencias cruzadas

- `docs/ontologia/conversaciones.md` — el thread, primitivo del que el episodio es una variante
- `docs/ontologia/monetizacion.md` — episodios privados detrás de la suscripción del oyente
- `docs/ontologia/eventos.md` — episodio programado genera evento
- `docs/ontologia/blogposts.md` — el otro tipo de thread owner-only (editorial)
- `docs/producto.md` — visión + principio "métricas: dos mundos"
- `docs/decisions/0053-pivot-substack-para-podcasts.md` — la decisión madre + anexo research métricas
- `docs/decisions/0048-storage-cloudflare-r2.md` — dónde vive el media
