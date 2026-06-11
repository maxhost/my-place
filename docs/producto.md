# Producto · visión y principios de experiencia

Documento canónico de **qué es Place** y de los **principios de experiencia/diseño** que atraviesan todos los objetos. Es la fuente de verdad de producto. Los objetos del core (threads, episodios, blogposts, eventos, oyentes, monetización) tienen su ontología propia en `docs/ontologia/`; este documento es lo transversal que no pertenece a un objeto único.

> _Última actualización: 2026-06-11 (ADR-0053 — pivot de producto)._ Documento vivo: si una decisión de producto cambia un principio, se actualiza acá **en la misma sesión**, se ajusta la fecha y se registra en `docs/decisions/`.

---

## Qué es Place

**Place es el Substack para podcasts.** El podcaster crea su place y ahí tiene, en un solo lugar, lo que hoy arma con cuatro herramientas separadas:

- **Su podcast con hosting y RSS propios.** Place genera y mantiene el feed RSS; Spotify, Apple Podcasts y demás agregadores resuelven los episodios contra Place. El audio/video vive en nuestra infraestructura.
- **Su página pública.** El place es la web del show — episodios, blog, eventos — con su identidad visual y, si quiere, su dominio propio. Se ahorra la web aparte.
- **Su blog.** Blogposts públicos con trabajo de SEO y GEO (posicionamiento en buscadores y en LLMs), para que el show se encuentre.
- **Su comunidad de oyentes.** Cada episodio publicado es un thread con player embebido y comentarios; los oyentes traen discusiones; hay eventos. La conversación del show vive con el show, no en un Discord satélite.
- **Su monetización, sin peaje.** Los threads privados se desbloquean con la suscripción paga del oyente, cobrada por **la cuenta de Stripe del propio creador** (Stripe Connect). **Place toma 0%** de ese dinero — el revenue de Place es la suscripción SaaS del creador.

**No es:** un agregador (no competimos con Spotify — los alimentamos vía RSS), una red social de audio, un feed algorítmico que captura atención, ni un marketplace que tasa a los creadores.

**Es:** la casa del podcast — el lugar donde el show se publica, se encuentra, se conversa y se monetiza.

## La frontera público/privado la controla el creador

Place tiene dos caras, y dónde pasa la línea es decisión del owner:

- **La cara pública** (anónimos, buscadores, agregadores): la página del show, el RSS, los blogposts, los episodios públicos, los eventos públicos.
- **La comunidad** (oyentes que se unieron): las discusiones, los comentarios, lo que el owner decida no exponer.
- **Lo privado** (suscriptores pagos): los threads marcados como privados.

El owner decide si su comunidad es pública o privada, y con granularidad: cada thread, sus comentarios y cada evento pueden ser públicos o privados. La existencia de lo gateado puede verse aunque el contenido no ("existe un episodio exclusivo" — patrón existencia visible, contenido gateado). Detalle en `docs/ontologia/conversaciones.md` y `docs/ontologia/monetizacion.md`.

**No hay límites de tamaño ni horarios.** El place está siempre abierto y la audiencia es la que sea — el cap de 150 personas y el horario de apertura del producto pre-pivot murieron con ADR-0053.

---

## Métricas: dos mundos con reglas distintas

Este es el principio que reemplaza al "sin métricas" absoluto del producto anterior:

- **El creador tiene métricas de audiencia estándar de la industria.** Las necesita para trabajar — vender publicidad se hace con downloads por episodio, oyentes únicos, geografía y plataformas, medidos según **IAB Podcast Measurement Technical Guidelines v2.2**. Son herramienta del owner, visibles solo para él. Detalle en `docs/ontologia/episodios.md` § Métricas.
- **La comunidad no tiene métricas vanidosas.** Entre oyentes no hay rankings, ni leaderboards, ni comparación, ni puntos. Lo que era canon pre-pivot acá sigue intacto.

---

## Principios no negociables de experiencia (la comunidad)

Estos principios definen el DNA de la comunidad de un place — son el diferencial frente a YouTube/Spotify/Patreon, donde la conversación es un agregado ruidoso. Aplican a toda la UI de la zona comunidad.

- **Nada parpadea, nada grita, nada demanda atención.** La información está disponible para el que mire, nunca se impone.
- **Sin métricas vanidosas ni comparación entre oyentes.** No se muestran contadores enmarcados como estatus ni comparación entre oyentes ("el más activo esta semana", "ranking de comentaristas"). Las métricas de audiencia del creador (ver arriba) son privadas del owner, no decoración social.
- **Sin urgencia artificial.** Nada de "EN 2 DÍAS", "ÚLTIMA CHANCE", countdowns ansiosos. Un evento o un episodio programado comunican su fecha como un hecho, no como presión.
- **Reconocimiento de pertenencia y rol, sí. Competencia por estatus, no.** Se permite lo que celebra vínculo, permanencia y *tipo de aporte* como un hecho: antigüedad ("oyente desde marzo 2024"), hitos temporales tranquilos, contribuciones como hechos contextuales, insignias/títulos **cualitativos** conferidos por estructura o por el owner, y acumulación **colectiva** ("este año publicamos 48 episodios"). Se prohíbe lo que crea comparación, escasez o FOMO: leaderboards, rankings, "top fan", streaks que se "rompen", puntos/karma/niveles por volumen, contadores como estatus. **Test:** ¿esto afirma pertenencia/rol, o dispara comparación social o loss-aversion? Lo primero entra; lo segundo no.
- **Sin push notifications agresivas.** Sumar notificaciones requiere decisión de producto, no técnica.
- **Sin feed algorítmico infinito.** Lo prohibido es el stream interminable sin fondo, ordenado por algoritmo para capturar atención. Sí se permite **scroll con lazyload de una lista acotada y cronológica** (threads agrupados por día, más nuevos primero, que cargan más al bajar por performance) — finita, reconocible, con un fondo, el usuario siempre sabe dónde está.
- **Presencia silenciosa.** Quién está se comunica visualmente (burbuja con borde verde), nunca con texto ansioso ni animaciones.
- **Customización activa, no algorítmica.** El owner configura colores e identidad. El orden y la personalización son decisión humana, no del algoritmo. _Nota (ADR-0020/0051):_ la asistencia LLM propose-only del onboarding está pausada, con reactivación comprometida a V1.3 (ADR-0051).

---

## Identidad visual por place

- **Cada place tiene identidad visual propia**, configurable por el owner — el place es la cara pública del show, así que esto es marca del podcast, no solo decoración. El producto provee defaults; cada place los personaliza dentro de límites que protegen usabilidad.
- Los colores del place viven como CSS custom properties configurables, no como clases Tailwind hardcoded. El detalle técnico está en `docs/architecture.md` y `docs/stack.md`.

---

## Multi-idioma

Place es una plataforma multi-idioma. Dos reglas estructurales lo gobiernan:

**1) Frontera estático/dinámico.**

- **Contenido estático se traduce.** Todo lo que provee el producto —landing page, formularios, labels, instrucciones, mensajes del sistema, emails transaccionales— está disponible en los idiomas soportados.
- **Contenido dinámico NO se traduce.** Lo que crea el creador o un oyente (episodios, blogposts, mensajes, eventos, nombres, descripciones) queda en el idioma en que se escribió. Place nunca auto-traduce contenido de la gente: traducir automáticamente es ruido y distorsión. Si alguien quiere traducir lo que lee, lo hace fuera del producto.

**2) Cada place habla un idioma único (ADR-0022).**

El place es **un lugar** con identidad propia — y el idioma del chrome (navegación, labels, menús, mensajes del sistema) es parte de esa identidad, decidida por el owner. Implicancias:

- El owner elige el idioma del place al crearlo (Paso 1 del wizard, default = locale del path de creación) y lo edita después en `/settings`. Persiste en `place.default_locale`.
- **Todos los oyentes (y los visitantes anónimos de la cara pública) ven el chrome del place en el idioma del owner**, sin importar en qué idioma navegaron la landing o el Hub. El idioma del show es parte del show.
- La zona pública del producto (marketing, Hub `inbox.place.community`) sí usa el idioma del visitante (routing por path `/{locale}/...`). La frontera entre los dos modos vive en `docs/architecture.md` § "i18n: dos modos de resolución de locale".

**Idiomas operativos (post-ADR-0022, 6 locales):**

- **Español (`es`)** — idioma base, day-one. Default si no se elige otro.
- **Inglés (`en`)** · **Francés (`fr`)** · **Portugués (`pt`)** · **Alemán (`de`)** · **Catalán (`ca`)** — operativos desde el feature settings (2026-05-20). Cobertura de traducciones se completa por namespace cuando se necesita; el fallback runtime garantiza que la UX nunca rendea key cruda (ADR-0024).

La estrategia técnica (next-intl, dos modos de resolución, fallback deep-merge) está en `docs/stack.md` y `docs/architecture.md`.

## Dónde vive el resto

Los principios que pertenecen a un objeto específico viven en su ontología canónica, no acá:

- **El thread, primitivo del que derivan los demás objetos** (tipos, visibilidad, comentarios, programación) → `docs/ontologia/conversaciones.md`
- **Episodios** (player, distribución RSS, métricas IAB) → `docs/ontologia/episodios.md`
- **Blogposts** (contenido público, SEO/GEO) → `docs/ontologia/blogposts.md`
- **Monetización** (Stripe Connect del creador, threads privados, 0%) → `docs/ontologia/monetizacion.md`
- **Eventos** (anuncio, thread programado → evento, memoria) → `docs/ontologia/eventos.md`
- **Identidad de los oyentes** (identidad contextual, derecho al olvido, DMs) → `docs/ontologia/miembros.md`
- **Biblioteca** (despriorizada post-pivot, ADR-0053) → `docs/ontologia/library.md`
- **Invariantes de dominio** (mínimo 1 owner, slug inmutable, transferencia de ownership) → `docs/data-model.md`
- **Multi-tenancy** (routing por subdomain, custom domains, slug inmutable) → `docs/multi-tenancy.md`
