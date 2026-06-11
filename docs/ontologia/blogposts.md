# Blogposts · objeto consolidado

Documento canónico del objeto "blogpost" en Place. Nace con el pivot (ADR-0053).

> _Última actualización: 2026-06-11 (ADR-0053 — pivot al Substack para podcasts)._ Ontología canónica del dominio. Si una decisión de producto cambia, se actualiza acá **en la misma sesión** y se ajusta la fecha; el schema (`docs/data-model.md`) es su expresión, no su fuente.

---

## El principio

El blogpost es **el contenido editorial escrito del show**: artículos públicos pensados para que el podcast se encuentre — en buscadores (SEO) y en LLMs (GEO). Donde el episodio es lo que el oyente escucha, el blogpost es lo que el mundo lee y lo que trae oyentes nuevos. Reemplaza el blog aparte que el podcaster mantenía en otra herramienta.

**Un blogpost es un thread** (ver `conversaciones.md`): mismo hilo de comentarios y mismas reglas. Cambia la morfología del mensaje principal — es un **artículo**.

**Solo el owner crea blogposts.** Como el episodio, es la voz del show.

---

## Estructura: el mensaje principal del blogpost

- **Título.**
- **Cuerpo del artículo**: Lexical (enlaces, video embebido, negritas, listas, imágenes cuando storage de imágenes en mensajes se habilite).
- **Metadata editorial**: fecha de publicación; descripción corta (excerpt) para previews y metadata.
- **Visibilidad**: el blogpost es **público por definición** — su razón de ser es ser encontrado. (Un texto exclusivo para suscriptores no es un blogpost: es una discusión/thread privado del owner.) Sus **comentarios** sí pueden ser públicos o solo-comunidad (control granular del owner, ADR-0053 §4).

El **hilo de comentarios** debajo funciona igual que cualquier thread.

### Publicación programada

Como todo thread, un blogpost puede programarse; programarlo genera un evento de anticipación (ver `eventos.md`). Para contenido editorial será menos común que para episodios, pero es el mismo mecanismo — no hay un sistema aparte.

---

## SEO y GEO: el trabajo que este objeto exige

El blogpost solo vale si se encuentra. Reglas de producto (el detalle técnico vive en el spec del feature):

- **Server-rendered e indexable**: HTML completo en el primer response, URL canónica bajo el dominio del place (custom domain cuando existe — el SEO juice es del creador, no de `place.community`).
- **Metadata completa**: title/description por post, Open Graph para shares, **datos estructurados** (schema.org `Article`/`PodcastEpisode` donde aplique), sitemap del place.
- **GEO (generative engine optimization)**: contenido legible por LLMs — estructura semántica limpia, hechos atribuibles, sin paywalls sobre el cuerpo del artículo. Qué primitivas concretas (p. ej. `llms.txt`) se adoptan es decisión del spec, con el estándar de la industria del momento.
- **Performance**: la cara pública compite en Core Web Vitals; el presupuesto de performance de `architecture.md` aplica con más razón acá.

---

## Lo que hereda el blogpost

- **Del thread**: hilo de comentarios, citas, lectores como presencia (en la comunidad), @menciones, nunca se cierra, pertenece al place.
- **De la identidad del place**: paleta, tipografía y mark — el blog es la marca del show.

---

## Lo que el blogpost NO tiene

- **No hay paywall sobre blogposts** — lo exclusivo va como thread privado, no como "blogpost privado".
- **No hay métricas públicas** (views, claps) — las métricas de la cara pública son del owner si se construyen, nunca decoración social.
- **No hay tags/categorías en V1** — como todo thread. Si el volumen editorial lo pide, se revalida con su propia decisión.
- **No hay multi-autor en V1** — owner-only, como el episodio. La firma es la del show.

---

## Estado

**Ontología:** cerrada — este documento es canónico. **Implementación:** no empezada. El detalle de pantallas, rutas públicas y primitivas SEO/GEO vive en el spec del feature cuando se construya, no acá.

---

## Referencias cruzadas

- `docs/ontologia/conversaciones.md` — el thread, primitivo del que el blogpost es una variante
- `docs/ontologia/episodios.md` — el otro tipo owner-only; el blogpost le trae oyentes
- `docs/ontologia/monetizacion.md` — por qué lo exclusivo no es un blogpost
- `docs/producto.md` — visión (la cara pública del place)
- `docs/decisions/0053-pivot-substack-para-podcasts.md` — la decisión madre
