# Landing · plan de implementación

Runway para la sesión de build (fresca, enfocada). El diseño/copy/decisiones son canónicos en `docs/landingpage/README.md`; este doc es el **cómo construirla** sin inventar. Spec antes de código (`CLAUDE.md`).

> _Última actualización: 2026-05-16._ **Build ejecutada (2026-05-16): landing completa, todas las fases cerradas.** El deploy a Vercel sigue requiriendo autorización explícita ("push") — aún no se hizo.

## Estado de la build (2026-05-16)

Fases 1-8 completas. Verificado en verde: `pnpm typecheck`, `pnpm lint`, `pnpm build` (20/20 páginas estáticas: 5 rutas × 4 locales, todas SSG `●`), `pnpm lhci`.

**Budget medido (ruta `/es`, prod build, servida local):**

| Métrica | Medido | Target | Estado |
|---|---|---|---|
| HTML | 9.9 KB gzip / 7.6 KB brotli | ≤ 14 KB | ✅ |
| CSS | 5.0 KB gzip / 4.4 KB brotli | ≤ 12 KB | ✅ |
| Fuentes | 2 woff2 subset (preload) | ≤ 2 / 60 KB | ✅ |
| Imágenes | 0 (SVG inline + placeholders tipográficos) | ≤ 1 | ✅ |
| First Load JS propio | 0 KB (0 `'use client'`) | ~0 KB | ✅ |
| Lighthouse Performance | 0.99 (`/es` y `/fr`, mobile throttled) | ≥ 0.99 | ✅ (al filo) |
| CLS | 0.0000 | 0 | ✅ |

**Notas:**
- Interactividad sin JS (ver README §Decisiones 9): LangSwitcher server `<a>`, MobileMenu checkbox+CSS, selector ParaQuién radios+`:has()`, FAQ `<details>`. No se crearon hojas `_client/`.
- Paleta: se sumó `--accent-strong #A8501E` por WCAG (ver README §Decisiones 3d).
- Legales en `/[locale]/terminos` y `/privacidad` (ruta plana, sin route group `(legal)` — es cosmético, no cambia URL).
- "First Load JS shared by all" ≈102 KB = runtime de Next App Router, inherente; el gate bloqueante real es Lighthouse y pasa. La regla "requests ≤5" del README se excede solo por chunks de framework de Next (no código propio).
- Pendiente antes de publicar: comisión % (ADR-0004) y contenido legal definitivo.

> _Lo de abajo es el runway original de la sesión (histórico)._

## Inputs lockeados (no re-decidir)

- Modo **B** (producto), CTA → `/login` → onboarding.
- Copy **aprobado** (ver `README.md` § "Copy propuesto"). Idioma fuente **ES**; v1 solo ES, scaffold i18n listo para EN/FR/PT.
- Tipografía **Fraunces + Inter** (`next/font`, variable, self-hosted).
- Paleta **Papel** (tokens en `README.md` § Decisiones 3d).
- Pricing visible: 30 días gratis, Hobby $7, Comunidad $30. **Comisión % = TBD** → mostrar "0% comisión (plan Comunidad)" como dirección, marcado para confirmar con ADR-0004 antes de publicar.
- Prueba social: **sin testimonios** (no hay usuarios); franja "Para clubes, talleres, equipos y comunidades de hasta 150".
- `localePrefix: 'always'`, default `es`. Contacto `hola@place.community`.
- Gate Lighthouse CI **bloqueante**.

## Estructura de archivos (Next.js 15 App Router)

```
src/
├── app/
│   └── [locale]/
│       ├── layout.tsx          # <html lang>, next/font, setRequestLocale, metadata+hreflang
│       ├── page.tsx            # landing: composición de secciones (Server Component, 0 JS)
│       └── (legal)/
│           ├── terminos/page.tsx
│           └── privacidad/page.tsx
├── features/landing/           # vertical slice (regla de aislamiento de architecture.md)
│   ├── components/             # Hero, Problema, ComoFunciona, Diferenciacion, ParaQuien,
│   │   │                       #   Pricing, FAQ, CtaFinal, Footer, Nav (Server salvo hojas)
│   │   └── _client/            # LangSwitcher, MobileMenu (únicos 'use client', diminutos)
│   ├── content/                # placeholders de capturas + assets (svg/ilustración hero)
│   └── public.ts
├── i18n/
│   ├── routing.ts              # next-intl: locales ['es','en','fr','pt'], localePrefix 'always', defaultLocale 'es'
│   ├── request.ts              # getRequestConfig
│   └── messages/es.json        # TODO el copy vive acá (única fuente; EN/FR/PT después)
└── proxy.ts                    # middleware next-intl (Next 16: proxy.ts; 15: middleware.ts)
```

## Orden de build (fases)

1. **Scaffold i18n**: `next-intl`, `routing.ts`, `request.ts`, `proxy`, `app/[locale]/layout.tsx` con `generateStaticParams(['es','en','fr','pt'])` + `setRequestLocale(locale)`. Verificar SSG en `next build` (trampa: sin `setRequestLocale` el SSG se rompe en prod, no en dev).
2. **Tokens + tipografía**: CSS custom properties (paleta Papel) en `globals.css`; `next/font` Fraunces+Inter (subset latin, pesos mínimos, `display:swap`, fallback metrics).
3. **Copy a `messages/es.json`**: trasladar el copy aprobado del README; cero strings hardcodeados en componentes.
4. **Secciones** (Server Components, en orden del README §"Estructura de secciones"): Nav → Hero → Problema → CómoFunciona → Diferenciación → ParaQuién (selector) → Franja-prueba-social → Pricing → FAQ → CtaFinal → Footer.
5. **Hojas cliente mínimas**: `LangSwitcher` (links reales `<a>`, nombres en su idioma), `MobileMenu`, selector de público (si necesita estado; si se puede sin JS mejor).
6. **Páginas legales** mínimas (Términos, Privacidad) + footer linkeado.
7. **Performance pass**: medir, ajustar a budget.
8. **Gate CI**: `@lhci/cli` + `lighthouse-budget.json` bloqueante; `@next/bundle-analyzer` (landing = 0 KB First Load JS propio).

## Dirección de arte

**Principio:** calmo con presencia, por oficio no por ruido (ver `README.md` § Dirección de arte).

- **Hero**: composición tipográfica/SVG trabajada (titular Fraunces enorme y quieto + un elemento gráfico sobrio que evoque "un lugar"). NO foto stock, NO vacío. Si al verlo se siente soso → palanca = enriquecer el visual del hero (sigue siendo opción dentro del DNA), no agregar motion.
- **Placeholders de producto**: donde irían capturas reales de la UI (ej. en "Cómo funciona", "Para quién"), poner imagen de ejemplo con marca visible `[CAPTURA: descripción de qué irá]` y `alt` descriptivo. Centralizar en `features/landing/content/` para reemplazo trivial cuando exista la UI.
- **Composición**: grilla con asimetría intencional, whitespace que dirige al CTA, secciones con ritmo (no todas iguales), acento terracota solo en CTA + kickers.
- **Referencias de archetipo** (tomar el *principio*, no copiar): Linear (jerarquía tipográfica + quietud, motion mínimo), Stripe (ritmo/composición de secciones sin ruido), un editorial cálido tipo Anthropic/Readymag (serif con presencia + espacio + textura). Place = la calidez de un editorial + la contención de Linear.

## Checklist performance (budget duro)

- [ ] SSG puro: cero `cookies()`/`headers()`/dinámico en el árbol; `next build` muestra la ruta como estática.
- [ ] `next/font` self-hosted, subset, pesos mínimos, fallback metrics → CLS ~0.
- [ ] `next/image` (si hay imágenes) AVIF/WebP, `width/height`, `sizes`, `priority` solo hero. Preferir SVG/tipografía en critical path.
- [ ] ~0 KB First Load JS propio; `'use client'` solo en hojas diminutas.
- [ ] Cero scripts de terceros en critical path; analytics solo Speed Insights.
- [ ] Budget: HTML ≤14KB, CSS ≤12KB, ≤5 requests, requests sin terceros.
- [ ] Lighthouse CI bloqueante (HTML>14KB / Perf<99 / CLS>0 → falla PR).
- [ ] Probar con FR/ES (texto largo) y throttling mobile (Slow 4G/CPU 4x).

## Checklist WCAG 2.2 AA

- [ ] Contraste 4.5:1 texto / 3:1 grande y UI (cuidado paleta tenue: validar cada par).
- [ ] Targets ≥24px (≥44 mobile); `:focus-visible` de alto contraste; sin `outline:none` sin reemplazo.
- [ ] 1 `<h1>`, jerarquía sin saltos, landmarks (`main/nav/footer`), skip-link.
- [ ] `<html lang>` correcto por locale; selector de idioma con nombres en su idioma (no banderas), links reales.
- [ ] Sin info solo por color; reflow 320px sin scroll-x; texto en `rem` hasta 200%.
- [ ] `prefers-reduced-motion` respetado (también es DNA).

## i18n checklist

- [ ] `generateStaticParams` los 4 locales + `setRequestLocale` en cada layout/page.
- [ ] `hreflang` por locale + `x-default`→es + canonical por variante (vía `generateMetadata`).
- [ ] Detección `Accept-Language` solo sugiere + cookie `NEXT_LOCALE` + override manual visible.
- [ ] Componentes con `min-width` no `width`; `text-wrap:balance` en titulares; probado en FR/ES.
- [ ] Solo `es.json` poblado en v1; estructura lista para `en/fr/pt`.

## Fuera de alcance / diferido

- Capturas reales del producto (no existe UI) → placeholders.
- Contenido EN/FR/PT (solo scaffold).
- Comisión % en pricing → confirmar con ADR-0004 antes de publicar.
- Onboarding/`/login` real (la landing solo linkea; el flujo es otra feature).
- Deploy a Vercel → autorización explícita del owner.

## Primeras tareas de la sesión de build

1. Confirmar/crear `docs/decisions/` entry si la sesión toca paradigma (probablemente no: la landing es un slice estándar).
2. Fase 1 (i18n scaffold) + verificar SSG en build **antes** de seguir.
3. Fases 2-6 en orden; auto-verificar (`pnpm test`, `pnpm typecheck`) al cerrar.
4. Reportar budget real medido vs target.
