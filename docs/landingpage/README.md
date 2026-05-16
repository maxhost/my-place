# Landing page · diseño canónico

Diseño de la landing pública de Place (`place.community`). Convergencia de 3 investigaciones 2026: anatomía de alta conversión, UX/UI + performance, y análisis competitivo/posicionamiento. Reemplaza los docs de landing pre-reset (que describían stack viejo Supabase/Prisma y un enfoque "una página → /login").

> _Última actualización: 2026-05-16._ Documento vivo de diseño. La implementación en código es una sesión aparte (spec antes de código, `CLAUDE.md`); el push a Vercel requiere autorización explícita.

---

## Objetivos

- **Alta conversión** sin traicionar el DNA (nada grita, sin urgencia, sin FOMO — y en 2026 eso *también* convierte).
- **Diferenciación**: comunidad no audiencia; lo pequeño como virtud; ritmo/calma; 0% comisión como argumento ético.
- **Valor claro** para 3 públicos: creadores con comunidad, organizaciones, empresas (intranet-comunidad).
- **Extremadamente rápida**: TTFB < 200ms, LCP < 1s, CLS ~0, INP < 160ms.
- **Multi-idioma**: ES day-one; EN/FR/PT después.

## Posicionamiento (el hueco que nadie ocupa)

La categoría entera (Circle, Skool, Mighty, Heartbeat, Patreon, Discord) vende lo mismo: all-in-one, escala ilimitada, "monetizá tu audiencia", engagement/retención, AI. **Nadie defiende lo pequeño, ni habla del miembro como persona, ni vende calma.** Ese es el territorio de Place.

**Línea transversal (ningún competidor puede copiarla sin romper su modelo):**
> "Las demás plataformas ganan más cuanto más grande y más adicta es tu comunidad. Nosotros ponemos el techo en 150 y no te cobramos comisión por tu gente. Nuestro incentivo es que tu lugar sea bueno, no infinito."

**Voz:** **amistosa y cercana** (no corporativa, no manifiesto). Diferenciación **moderada**: la justa para capturar al potencial cliente, no un sermón contra la competencia. Mostrar la sensación, no predicar; dejar que "150", "cierra a la noche" y "0% comisión" argumenten solos. **No** sonar moralista/anti-tech.

## Estructura de secciones

Orden de alta conversión 2026, con qué decir / qué NO:

| # | Sección | Decir | NO decir |
|---|---|---|---|
| 1 | **Hero** | "Un lugar para hasta 150 personas que se conocen. Entrás, te ponés al día, participás si querés, y salís." 1 CTA primario. El número **150** acá o inmediatamente debajo. Pasa el 5-second test | "all-in-one", "complete platform", "launch in minutes", "scale", "grow", "AI-powered" |
| 2 | **Prueba social** | Cita cualitativa de experiencia ("se siente como entrar a un bar donde me conocen"); nº de places | dólares ganados, nº miembros totales, "trusted by 25,000+" |
| 3 | **Problema** | El dolor: plataformas que te tratan como generador de engagement / a tu gente como audiencia / te cobran comisión | — |
| 4 | **Solución / cómo funciona** | Mecanismos concretos: conversaciones (turnos, no chat), presencia silenciosa, el place tiene horario y cierra, temas que no mueren, identidad visual propia | "engagement", "retention", "% que vuelven", "courses" como pilar |
| 5 | **Diferenciación** | Contraste explícito comunidad vs audiencia/feed; 150 = decisión de diseño (Dunbar), no límite de plan | manifiesto acusador a competidores |
| 6 | **Para quién** (selector) | Creador / organización / empresa — reordena ejemplos y testimonios, 1 CTA por vista | lenguaje SaaS B2B agresivo, "scale your business" |
| 7 | **Testimonios** | Nombre + foto + cargo + experiencia concreta, cerca de CTA | "hice $3M", calculadora de ingresos |
| 8 | **Pricing** | Transparencia total; "0% de comisión. Tu comunidad no es nuestro producto" como ancla ética; explicar el techo de 150 | costos ocultos, "monetize your audience", testimonios de revenue |
| 9 | **FAQ / objeciones** | Privacidad/derecho al olvido, sin lock-in, "¿no se muere sin notificaciones?" (reframe activo), idiomas, qué pasa con >150 | — |
| 10 | **CTA final** | Invitación calmada: "Creá tu lugar" | countdowns, "join 25,000+", urgencia |
| 11 | **Footer** | Navegación secundaria, legal, selector de idioma; no compite con el CTA | — |

**CTA:** **una sola acción/mensaje, repetida en varias ubicaciones** (hero + tras solución + cierre, mínimo 3). No es un único botón (eso es una sola oportunidad = riesgo); es el mismo CTA presente varias veces, no CTAs que dicen cosas distintas. Copy de bajo compromiso ("Creá tu place" / "Probá Place", no "Registrate"/"Submit"). Empresa tolera CTA de mayor compromiso ("Solicitá una demo") con self-serve para los otros dos.

## Copy — dirección (a refinar con el owner)

- **H1 candidatos** (≤8 palabras, outcome, sin jerga): "Un lugar, no una plataforma." · "Tu comunidad, sin la máquina de atención." · "Reuní a tu comunidad, no a una audiencia."
- **Subhead:** ataca la objeción/diferenciación. Ej.: "Hasta 150 personas que se conocen. Sin FOMO, sin métricas, sin algoritmo."
- **Pricing subhead:** "0% de comisión en el plan comunidad. Lo que tu comunidad paga, llega a vos."
- **Pricing concreto (MVP, se muestra):** **30 días gratis** como promesa destacada. Plan **Hobby $7/mes**, plan **Comunidad $30/mes**. (Comisión por plan aún sin fijar — ver índice de features / ADR-0004 pendiente; el copy de comisión 0% aplica al plan Comunidad como dirección, confirmar al cerrar números.)
- **Reframe anti-objeción** (riesgo "se muere sin notificaciones"): "Los temas dormidos no mueren — cualquier mensaje revive una conversación de hace meses. El horario no apaga la comunidad: la hace un lugar al que se vuelve, no una app que te persigue."

## UX/UI (estética de restraint = tendencia 2026)

- **Fondo "unbleached"** (papel/piedra cálido, no #FFF puro). 1 color de acento, usado con moderación (CTA).
- **Tipografía = jerarquía**: máx 2 familias (idealmente 1 variable font), escala modular, titulares grandes pero **quietos** (tamaño = jerarquía, sin animación de entrada). Medida 60-75 caracteres.
- **Whitespace dirige la atención** al CTA (no pop-ups, no urgencia). Sistema de espaciado 8px. Una idea por sección, max-width ~1100-1200px.
- **Motion:** solo micro-transiciones de estado (hover/focus, 120-200ms) y siempre respetar `prefers-reduced-motion`. **Cero** parallax, scroll-jacking, auto-play, carruseles, contadores, pop-ups.
- **WCAG 2.2 AA**: contraste 4.5:1 (cuidado con paleta tenue), targets ≥24px (44 en mobile), `:focus-visible` de alto contraste, HTML semántico (1 `<h1>`, landmarks), `lang` por locale, skip-link, sin info solo-por-color, reflow 320px, texto en `rem`.
- **Mobile-first**: una columna, CTA sin scroll, cuerpo ≥16px, targets ≥44px, sin depender de hover.

**Dirección de arte (calmo ≠ soso):** restraint mal ejecutado se lee como vacío. La presencia se logra con **oficio, no con ruido**: contraste de escala tipográfica (titulares enormes y quietos vs cuerpo chico), un **visual protagonista trabajado** en el hero (composición tipográfica/SVG/ilustración cálida, no una foto stock ni la nada), ritmo y composición de secciones (grilla, asimetría intencional), textura del papel y el acento usado en los puntos justos. El producto no está construido → **donde irían capturas reales del producto van placeholders/imágenes de ejemplo claramente marcados** (`[CAPTURA: …]`) para reemplazar cuando exista la UI. Un dev no debe construir algo plano por seguir el spec literal: el plan de implementación especifica la dirección de arte.

## Performance (cómo se logra el <200ms)

- **SSG puro servido desde el edge de Vercel.** Cero APIs dinámicas (`cookies()`/`headers()`/dinámico) en el árbol → TTFB decenas de ms. (La regla de "streaming agresivo del shell" de `architecture.md` **NO** aplica: es para pages con datos, no para una landing estática — no meter `<Suspense>` artificial.)
- **`next/font`** self-hosted, subset latin, pesos mínimos, `display:swap` + fallback metrics (CLS ~0.02). Reusar el `next/font` del root layout — cero fuentes nuevas.
- **`next/image`** AVIF/WebP, `width/height` siempre, `sizes` correcto, `priority` solo en hero — **o** hero tipográfico/SVG (el LCP más rápido es el que no descarga nada; además ahorra 1 request).
- **~0 KB JS de cliente**: Server Components; `'use client'` solo en hojas diminutas (selector de idioma, menú mobile). **Sin** Framer/GSAP/Lottie. **Cero** scripts de terceros en critical path; analytics solo Vercel Speed Insights o `lazyOnload`.
- **Budget de bytes (página fría)**: HTML ≤ **14 KB** gzip/brotli (entra en la primera ventana de congestión TCP → 1 RTT, clave para el <200ms) · CSS ≤ 12 KB · fuentes ≤ 2 archivos / 60 KB · imágenes ≤ 1 (o 0) · **requests totales ≤ 5** · 0 KB First Load JS propio.
- **CI guardrails**: Lighthouse CI (`@lhci/cli`) con `lighthouse-budget.json` (falla el PR si HTML > 14 KB, CLS > 0, Performance < 99) + `@next/bundle-analyzer` (la ruta de la landing debe aparecer con 0 KB de First Load JS propio) + Speed Insights, alertas a 80% de umbrales. Probar con FR/ES (texto largo) y throttling mobile. **Gate bloqueante (decidido):** el PR no mergea si se pasa del budget.

## i18n

- **next-intl** (App Router no tiene i18n nativo). `app/[locale]/...` + middleware/proxy. **`localePrefix: 'always'`** (`/es` `/en` `/fr` `/pt`), default `es` — opción decidida por SEO.
- **`generateStaticParams(['es','en','fr','pt'])` + `setRequestLocale(locale)` en cada page/layout** — sin esto el SSG se rompe **en prod (no en dev)**: trampa #1.
- **Selector de idioma**: link real (`<a href>`, crawleable), nombres en su propio idioma (no banderas), discreto (footer/header), override manual de la autodetección (`Accept-Language` solo sugiere + cookie `NEXT_LOCALE`).
- **SEO**: `hreflang` + `x-default` + canonical por variante; `<html lang>` por locale.
- **Layout**: ES/FR/PT corren 15-30% más largo que EN — `min-width` no `width` en botones/nav/badges, `text-wrap: balance` en titulares, probar con FR/ES antes de cerrar breakpoints.

## Riesgos de posicionamiento y mitigación

1. **"Comunidad no audiencia" no resuena con el creador en modo growth.** → Segmentar al creador *cansado* del modelo engagement (hartazgo documentado 2026); no negar monetización (0% comisión es el cómo).
2. **"Sin FOMO / cierra" suena a producto que no usás.** → Reframe activo con el mecanismo concreto (temas dormidos reviven; lugar al que se vuelve).
3. **Geneva murió con mensaje parecido (cozy sin monetización).** → Dejar claro que es negocio sostenible para el owner (0% comisión, plan comunidad). No esconder la monetización por purismo.
4. **150 puede leerse como "juguete".** → Enmarcarlo como Dunbar / decisión de diseño deliberada, no límite de plan.
5. **Sonar moralista.** → Mostrar, no sermonear.

## Decisiones tomadas

1. **`localePrefix` = `always`** (`/es` `/en` `/fr` `/pt`), default `es`, `x-default`→es. Es la opción más limpia para SEO multi-idioma: cada locale con su path canónico explícito, `hreflang` sin ambigüedad, sin el caso raro del default-sin-prefijo.
2. **Hero = composición tipográfica/SVG** (opción 2: más rápida, coherente con el DNA, sin imagen en el critical path). Si no convence al ver el resultado, se pasa a imagen.
3. **Voz**: amistosa y cercana; diferenciación moderada (capturar, no sermonear).
3b. **Modo = B (landing de producto)**: CTA → `/login` → onboarding (bifurca crear/unirse/invitación). No es waitlist.
3c. **Tipografía**: Fraunces (titulares) + Inter (cuerpo), variable, self-hosted `next/font`.
3d. **Paleta = Papel cálido**: `--bg #FAF7F0` · `--surface #FFFFFF` · `--ink #1C1B22` · `--muted #6B6A73` · `--border #E7E2D6` · `--accent #C4632F` (terracota) · `--accent-ink #FFFFFF`. 1 acento, usado con intención (CTA, kickers). **Outcome de "validar cada par" (build 2026-05-16):** `--accent #C4632F` no alcanza 4.5:1 como texto (≈3.7:1 sobre papel, ≈3.9:1 blanco-sobre-accent). Se agregó `--accent-strong #A8501E` (terracota más profundo, ≈5.3:1) para TODO accent que sea texto (kickers, links, label/fill del CTA); `--accent` queda para detalles decorativos con umbral 3:1. La dirección de marca (terracota cálido sobre papel) no cambia.
3e. **Contacto**: `hola@place.community`.
4. **CTA**: una sola acción/mensaje, **repetida ≥3 veces** (hero, tras solución, cierre). No un único botón (riesgo).
5. **Pricing en la landing (MVP)**: se muestra, con **30 días gratis** como promesa destacada; Hobby **$7/mes**, Comunidad **$30/mes**. Comisión por plan aún sin fijar (ADR-0004 pendiente cuando se cierre).
6. **Footer/legales**: Términos, Privacidad, Contacto.
7. **Gate de performance en CI = BLOQUEANTE.** Lighthouse CI frena el PR si se pasa del budget (HTML > 14KB, Performance < 99, CLS > 0). `<200ms` es requisito duro → freno duro.
8. **H1 = "Un lugar, no una plataforma."** (build 2026-05-16, elegido por el owner entre los 3 candidatos). Subhead: "Hasta 150 personas que se conocen. Sin FOMO, sin métricas, sin algoritmo."
9. **Interactividad sin JS de cliente** (build 2026-05-16): el plan preveía hojas `'use client'` (LangSwitcher, MobileMenu, selector). Se implementó todo Server Component + CSS (LangSwitcher = `<a>` server-rendered; MobileMenu = checkbox+`peer`; selector ParaQuién = radios + `:has()`; FAQ = `<details>`). Resultado: **0 `'use client'`, 0 KB First Load JS propio** — supera el budget en vez de solo cumplirlo, sin perder UX. El "First Load JS shared" (~102 KB) es runtime de Next App Router, inherente y fuera de nuestro control; el budget bloqueante real es Lighthouse (HTML/CLS/Perf), que pasa.

## Próximos pasos

1. Owner revisa/ajusta este diseño (sobre todo posicionamiento, copy, y las decisiones).
2. Registrar decisiones en `docs/decisions/`.
3. Implementación en código — **sesión aparte** (frontend = su propia sesión). Runway en `docs/landingpage/implementation-plan.md`.
4. Deploy a Vercel — **requiere autorización explícita** ("push").

---

## Fuentes

Compilado de 3 investigaciones (2025-2026): anatomía de conversión B2B/SaaS, UX/UI + Core Web Vitals + Next.js/next-intl en Vercel, y análisis competitivo (Circle, Skool, Mighty Networks, Heartbeat, Patreon, Discord, Substack, Geneva). URLs completas en el historial de la sesión de investigación.
