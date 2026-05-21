# Producto · visión y principios de experiencia

Documento canónico de **qué es Place** y de los **principios de experiencia/diseño** que atraviesan todos los objetos. Es la fuente de verdad de producto. Los objetos del core (miembros, conversaciones, eventos) tienen su ontología propia en `docs/ontologia/`; este documento es lo transversal que no pertenece a un objeto único.

> _Última actualización: 2026-05-20._ Documento vivo: si una decisión de producto cambia un principio, se actualiza acá **en la misma sesión**, se ajusta la fecha y se registra en `docs/decisions/`.

---

## Qué es Place

Place es un lugar digital pequeño e íntimo para hasta 150 personas. Es **cozytech**: un espacio tranquilo donde entrás, te ponés al día de lo que pasa, participás si querés, y salís. Como entrar a un pub conocido — no como abrir una red social.

**No es:** un feed algorítmico infinito, una app que compite por atención, un producto con notificaciones agresivas, un sistema con métricas de engagement, ni una plataforma que gamifica la atención.

**Es:** un lugar con miembros, conversaciones, eventos y memoria compartida. Donde cada place tiene su identidad visual propia y su propio ritmo.

---

## Principios no negociables de experiencia

Estos principios definen el DNA de Place. Violarlos es violar qué es el producto. Aplican a toda la UI, en todos los objetos.

- **Nada parpadea, nada grita, nada demanda atención.** La información está disponible para el que mire, nunca se impone.
- **Sin métricas vanidosas ni comparación.** No se muestran contadores enmarcados como estatus ni comparación entre miembros ("el más consultado esta semana", "ranking de activos").
- **Sin urgencia artificial.** Nada de "EN 2 DÍAS", "ÚLTIMA CHANCE", countdowns o similar.
- **Reconocimiento de pertenencia y rol, sí. Competencia por estatus, no.** Se permite lo que celebra vínculo, permanencia y *tipo de aporte* como un hecho: antigüedad ("miembro desde marzo 2024"), hitos temporales tranquilos ("hace un año traías tu primer tema", mostrado una vez, no un contador que tictaquea), contribuciones como hechos contextuales, insignias/títulos **cualitativos** que reconocen un rol o forma de participar (conferidos por estructura o por el owner), y acumulación **colectiva** ("este año hicimos 48 misas"). Se prohíbe lo que crea comparación, escasez o FOMO: leaderboards, rankings, "top contributor", comparación entre miembros, streaks que se "rompen", puntos/karma/niveles por volumen, contadores como estatus, e insignias convertidas en colección competitiva o achievement-hunting. **Test:** ¿esto afirma pertenencia/rol, o dispara comparación social o loss-aversion? Lo primero entra; lo segundo no.
- **Sin push notifications agresivas.** El MVP no tiene push notifications. Sumar notificaciones requiere decisión de producto, no técnica.
- **Sin feed algorítmico infinito.** Lo prohibido es el stream interminable sin fondo, ordenado por algoritmo para capturar atención. Sí se permite **scroll con lazyload de una lista acotada y cronológica** (ej. la Zona Discusión: discusiones agrupadas por día, más nuevas primero, que cargan más al bajar por performance) — finita, reconocible, con un fondo, el usuario siempre sabe dónde está.
- **Presencia silenciosa.** Quién está se comunica visualmente (burbuja con borde verde), nunca con texto ansioso ni animaciones.
- **Customización activa, no algorítmica.** El owner del place configura colores. El orden y la personalización son decisión humana, no del algoritmo. _Nota (ADR-0020, 2026-05-19):_ la asistencia LLM propose-only del onboarding (paleta + borrador de descripción) está **pausada en el MVP** — no aporta valor proporcional a su complejidad y no estaba funcional al momento del corte. El owner customiza con presets curados o paleta personalizada (3 hex), siempre humana. El diseño original del LLM (ADR-0005 §5 / ADR-0007) queda en histórico, reactivable cuando se justifique con una ADR que supersede a la 0020.

---

## Identidad visual por place

- **Cada place tiene identidad visual propia**, configurable por el owner. El producto provee defaults; cada place los personaliza dentro de límites que protegen usabilidad.
- Los colores del place viven como CSS custom properties configurables, no como clases Tailwind hardcoded. El detalle técnico está en `docs/architecture.md` y `docs/stack.md`.

---

## Multi-idioma

Place es una plataforma multi-idioma. Dos reglas estructurales lo gobiernan:

**1) Frontera estático/dinámico.**

- **Contenido estático se traduce.** Todo lo que provee el producto —landing page, formularios, labels, instrucciones, mensajes del sistema, emails transaccionales— está disponible en los idiomas soportados.
- **Contenido dinámico NO se traduce.** Lo que crea un miembro (mensajes, temas, eventos, nombres, descripciones del place) queda en el idioma en que se escribió. Place nunca auto-traduce contenido de la gente: traducir automáticamente es ruido y distorsión, contrario al principio cozytech. Si alguien quiere traducir lo que lee, lo hace fuera del producto.

**2) Cada place habla un idioma único (ADR-0022, 2026-05-20).**

Place NO es una app personal cuyo idioma se elige por miembro. Es **un lugar** con identidad propia — y el idioma del chrome (navegación, labels, menús, mensajes del sistema) es parte de esa identidad, decidida por el owner. Implicancias:

- El owner elige el idioma del place al crearlo (Paso 1 del wizard, default = locale del path de creación) y lo edita después en `/settings`. Persiste en `place.default_locale`.
- **Todos los miembros ven el chrome del place en el idioma del owner**, sin importar en qué idioma navegaron la landing o el Hub. Un miembro que entró en inglés a un place creado en español lo ve en español, igual que vería en el idioma del lugar físico si entrara presencialmente.
- La zona pública del producto (marketing, Hub `inbox.place.community`) sí usa el idioma del visitante (routing por path `/{locale}/...`). La frontera entre los dos modos vive en `docs/architecture.md` § "i18n: dos modos de resolución de locale".

**Idiomas operativos (post-ADR-0022, 6 locales):**

- **Español (`es`)** — idioma base, day-one. Default si no se elige otro.
- **Inglés (`en`)** · **Francés (`fr`)** · **Portugués (`pt`)** · **Alemán (`de`)** · **Catalán (`ca`)** — operativos desde el feature settings (2026-05-20). Cobertura de traducciones se completa por namespace cuando se necesita; el fallback runtime garantiza que la UX nunca rendea key cruda (ADR-0024).

La estrategia técnica (next-intl, dos modos de resolución, fallback deep-merge) está en `docs/stack.md` y `docs/architecture.md`.

## Dónde vive el resto

Los principios que pertenecen a un objeto específico viven en su ontología canónica, no acá:

- **Identidad de los miembros** (se manifiestan por lo que hacen, identidad contextual, derecho al olvido, sin perfil público fuera de places) → `docs/ontologia/miembros.md`
- **Comunicación** (Zona Discusión vs Discusión, traídas no autorizadas, lectores como presencia, una discusión nunca se cierra) → `docs/ontologia/conversaciones.md`
- **Momentos compartidos** (eventos-ocasión vs ritual, acumulación como memoria cálida) → `docs/ontologia/eventos.md`
- **Invariantes de dominio** (máx 150 miembros, mínimo 1 owner, slug inmutable, transferencia de ownership) → `docs/data-model.md`
- **Horario y multi-tenancy** (gate por horario, routing por subdomain, slug inmutable) → `docs/multi-tenancy.md` y `docs/ontologia/conversaciones.md`
