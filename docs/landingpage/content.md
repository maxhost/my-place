# Landing — contenido y copy

> Estructura de secciones + copy **placeholder en español**. Todo el copy
> es provisional y está acotado a claims que existen en `docs/blueprint.md`
> y `CLAUDE.md`. **NO se inventan features ni promesas.** Lo que requiere
> decisión del owner está marcado `[A DEFINIR con owner]`.
>
> Idioma: **UI en español** (regla CLAUDE.md). Tono: tranquilo, sobrio,
> sin signos de exclamación, sin urgencia, sin hype.

## Claims permitidos (fuente de verdad)

Solo se puede afirmar lo que está en blueprint/CLAUDE.md. Lista de
afirmaciones válidas para construir el copy:

- Place es un **lugar digital pequeño e íntimo** para hasta **150
  personas** (ya es la `description` del root layout).
- Es **cozytech**: entrás, te ponés al día, participás si querés, salís.
  Como entrar a un pub conocido — no como abrir una red social.
- Tiene **miembros, conversaciones, eventos y memoria compartida**.
- **Cada place tiene su propio horario**; fuera de él, el place no está
  accesible.
- **Cada place tiene identidad visual propia**, configurable por su owner.
- **No** es: feed con scroll infinito, métricas de engagement,
  notificaciones agresivas, gamificación, perfil público.
- **Sin métricas vanidosas, nada grita, sin urgencia artificial.**

> ❌ NO afirmar: precios concretos, "miles de comunidades", integraciones,
> roadmap, comparaciones nominales con competidores en la página pública
> (el blueprint las usa internamente, no necesariamente en la landing —
> **[A DEFINIR con owner]** si se quiere posicionamiento explícito).

## Estructura de la página (orden de render)

`Hero → ValueProp → HowItWorks → Cta → Footer`. Una sola pantalla
conceptual; scroll corto y finito. Sin navbar.

---

### 1. Hero (`_landing/hero.tsx`)

**Objetivo:** en una frase, qué es Place + el tono. CTA primario.

- **Overline (kicker):** `Un lugar, no una app`
- **Título `<h1>` (Fraunces italic):** `Place`
  *(o título-frase — ver variante abajo; **[A DEFINIR con owner]: D3**)*
- **Subtítulo:**
  > Un lugar digital pequeño e íntimo para hasta 150 personas. Entrás, te
  > ponés al día, participás si querés, y salís.
- **CTA primario:** `Entrar` → `/login` (ver `styles.md` § CTA y D4).
- **Micro-línea bajo el CTA (opcional, `--muted`):**
  > Creá tu place o sumate a uno.

Variante de título (si el owner prefiere frase a wordmark):
> *Como entrar a un pub conocido.*
(Fraunces italic; "Place" pasa a wordmark del footer.) **[A DEFINIR con
owner: D3]**

---

### 2. ValueProp (`_landing/value-prop.tsx`)

**Objetivo:** 2–3 afirmaciones de qué hace distinto a Place. Texto, sin
íconos que griten, sin números.

- **Section `<h2>`:** `Un espacio tranquilo, no un feed`
- Bloques (cada uno: una línea fuerte + una de apoyo en `--muted`):

  1. **Íntimo por diseño.**
     Hasta 150 personas. Lo suficientemente chico para que sea un lugar y
     no una plataforma.
  2. **Con su propio horario.**
     Cada place abre y cierra cuando sus miembros deciden. Fuera de hora,
     el lugar descansa.
  3. **Nada grita.**
     Sin notificaciones agresivas, sin métricas de vanidad, sin scroll
     infinito. La información está para quien mire.

> Estas 3 mapean 1:1 a propiedades reales del blueprint (escala 150,
> horario propio, principios "nada grita"). No agregar un 4º bloque con
> claims inventados.

---

### 3. HowItWorks (`_landing/how-it-works.tsx`)

**Objetivo:** mostrar que entrar es simple. 3 pasos. Mapea al flujo real
de `docs/rls/place-access.md` (registrarse → crear / unirse vía
directorio / aceptar invitación).

- **Section `<h2>`:** `Cómo entrás`
- Pasos (1 col mobile, 3 en `md:`; numeración discreta, sin badges):

  1. **Te registrás.**
     Una cuenta para todos tus places.
  2. **Creás un place o te sumás a uno.**
     Empezá el tuyo, sumate por el directorio, o aceptá una invitación.
  3. **Entrás cuando está abierto.**
     Te ponés al día, participás si querés, y salís.

> Paso 2 refleja exactamente las 3 vías de `place-access.md` ("crear /
> unirse vía directorio / aceptar invitación"). No prometer "explorá
> miles de places": el directorio solo lista places que su owner marcó
> discoverable, y sin métricas (place-access.md). Mantener el copy neutro.

---

### 4. Cta (`_landing/cta.tsx`)

**Objetivo:** cierre. Repite el CTA, sin presión.

- **Línea de cierre (Fraunces, calma):**
  > Tu lugar te espera cuando quieras entrar.
  *(evitar urgencia — nada de "creá el tuyo hoy", "no esperes". El tono
  es invitación tranquila, no llamada a la acción agresiva.)*
- **CTA:** `Entrar` → `/login` (mismo destino que el hero).
- Fondo opcional `--accent-soft` para diferenciar el bloque (ver
  `styles.md`).

---

### 5. Footer (`_landing/footer.tsx`)

**Objetivo:** cierre mínimo. Sin sitemap extenso (no hay más páginas
públicas en MVP).

- **Wordmark:** `Place` (Fraunces italic, `--muted`).
- **Tagline corta (opcional):** `Un lugar, no una app.`
- **Links:** `[A DEFINIR con owner — D6]`. Candidatos posibles si
  existen: Términos · Privacidad · Contacto. Si no hay legales aún, el
  footer es solo wordmark + tagline. NO inventar links a páginas
  inexistentes (no crear `/about`, `/pricing`, `/blog` — no existen y no
  están en scope).
- Hairline superior `--border`. Tipografía `text-sm`, `--muted`.

---

## Marcas `[A DEFINIR con owner]` (consolidado)

| Ref | Qué hay que decidir                                                                 |
| --- | ----------------------------------------------------------------------------------- |
| D3  | Copy final, wordmark vs título-frase en el hero, tagline definitiva                  |
| D4  | ¿Un solo CTA "Entrar" o además un CTA secundario "Crear un place"? (ambos → /login)  |
| D6  | Links del footer (legales/contacto) y sus destinos                                  |
| —   | ¿Se incluye posicionamiento explícito vs competidores en la página? (default: no)   |
| —   | Texto exacto del CTA: "Entrar" / "Entrar a Place" / otro                             |
| —   | ¿Existe un mark/logo oficial o el wordmark es solo tipográfico? (ver `styles.md`)    |

## Tono — checklist de revisión del copy

Antes de dar por bueno cualquier copy, verificar contra `CLAUDE.md`:

- [ ] Sin signos de exclamación ni mayúsculas de impacto.
- [ ] Sin urgencia ("ahora", "hoy", "no esperes", countdowns).
- [ ] Sin métricas ni números de vanidad ("+1000 comunidades").
- [ ] Sin promesas de features fuera de blueprint.
- [ ] Sin lenguaje de red social ("seguidores", "engagement", "viral").
- [ ] Frases cortas, calmas, en español neutro.
</content>
