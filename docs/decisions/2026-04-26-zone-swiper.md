# ADR — Swipe horizontal entre zonas (R.2.5)

**Fecha**: 2026-04-26
**Estado**: Aprobado
**Sub-milestone**: R.2.5.0 (spec del swiper)
**Referencias**: `docs/features/shell/spec.md` § 16,
`docs/decisions/2026-04-26-shell-introduction.md` (R.2 — shell base),
`docs/decisions/2026-04-22-mobile-safari-webkit-flows.md` (gotcha
WebKit emulado vs nativo), `CLAUDE.md` § Gotchas (Next 15 / dev
server / Realtime channels)

## Contexto

R.2 (commits `5993887` → `c96aefd`) introdujo el shell común con
TopBar + SectionDots + main viewport. Los **dots son `<Link>` plenos**:
click navega cross-page con SSR completo y skeleton de `loading.tsx`.
Ya en R.2.0 se documentó como follow-up obligatorio: swipe horizontal
entre zonas con su propio ADR.

Tres requirements del usuario en esta sesión:

1. **Production-robust** — sin atajos de gesture handling, sin bugs
   conocidos en iOS Safari. Coherente con la política del proyecto:
   F.G adoptó lucide y Radix por la misma razón (dependencias maduras
   vs reinventar).
2. **Reactivo** — al cambiar de zona, ver contenido fresco; no
   quedarse con datos cacheados de hace minutos.
3. **Fluido como app, sin skeleton ni carga demorada** — la
   transición debe sentirse instantánea; el `loading.tsx` actual
   rompe la sensación de "una sola app".

**Restricción adicional explicitada**: NO desperdiciar bandwidth ni
inflar costos infra. Realtime per-zona descartado (5K mensajes WS
extra/place no se justifican). Refresh-on-every-swipe descartado
(redundante).

## Decisiones

### Decisión 1 — `framer-motion@^11` sobre @use-gesture o hand-rolled

**Justificación**: madura, ~30KB gz, resuelve `useDrag` + spring
physics + `dragElastic` en una sola lib. Coherente con la política del
proyecto: usar dependencias robustas (Radix, lucide) en vez de
reinventar. Hand-rolled tiene superficie de bugs alta en iOS Safari
(touch events, momentum scroll, multi-touch).

Pinear major: `framer-motion@^11`. APIs cambiaron entre v10 y v11.

**Validación bundle delta** en R.2.5.1 con `pnpm build`. Si excede
10% del First Load JS (~102KB → ~132KB), evaluar dynamic import del
swiper post-mount.

### Decisión 2 — Bounce elástico sobre hard-stop o cycle

**Justificación**: estándar iOS UX. El stripe se desplaza un poco
hacia el dedo y rebota a su posición original. Indica "no hay más"
sin animación de cycle confusa (que requiere pista visual de wraparound).

Spring suave (`stiffness: 350, damping: 35`) para no parecer
"playful" — alineado con cozytech tranquilo. Sin overshoot exagerado.

### Decisión 3 — Route-based + swiper wrapper sobre parallel routes

**Justificación**:

- Sub-pages (`/conversations/[postSlug]`, `/events/[id]`) rompen el
  modelo parallel route: el layout parallel-routed renderearía slots
  vacíos en sub-pages, agregando complejidad.
- `default.tsx` por slot multiplica boilerplate.
- La feature library R.5 agregaría 4ª zona — peor escalabilidad con
  parallel routes.

Cada zona conserva su URL canónica. El swiper wrappea `{children}` en
`(gated)/layout.tsx`. Cuando el swipe completa, dispara
`router.push(targetUrl, { scroll: false })`.

### Decisión 4 — Freshness vía Next route cache + refresh condicional

**Justificación**: Realtime per-zona costaría ~5K mensajes WS/place
sin valor proporcional para el caso típico (150 members, swipes
ocasionales). Refresh-on-every-swipe es redundante (datos no cambian
en sub-segundo).

**Modelo**:

- Next 15 route cache + `experimental.staleTimes.dynamic: 30` →
  swipes rápidos dentro de 30s = cache hit, instantáneo.
- `lastVisitedAt` Map en useRef del swiper → si el snap apunta a una
  zona con > 30s sin verse, dispara `router.refresh()` extra.
- Si ≤ 30s, confiar en route cache.

Realtime per-zona queda como follow-up post-R.2.5 con su propio ADR
si producto pide push-based updates.

### Decisión 5 — Configurar `experimental.staleTimes.dynamic: 30`

**Crítica**: Next 15 cambió el default route cache para dinámicas de
30s (Next 14) a **0s**. Sin esta config, cada navegación re-fetcha y
el modelo de freshness colapsa.

**Riesgo**: `experimental.staleTimes` es flag experimental. Si Next
la modifica entre minor versions (15.6, 15.7), puede romper. Plan B:
exportar `revalidate: 30` por cada page de zona (más opaco pero
estable).

### Decisión 6 — `loading.tsx` por zona root + skeleton estructural

> **Pivote R.2.5.2-fix (2026-04-26)**: la decisión original era
> eliminar `loading.tsx` y usar `startTransition` + `<TopProgressBar>`.
> En la primera prueba con datos reales (dev mode + Supabase pgbouncer
> high-latency), el approach se sintió frozen 4-12s y el dot activo no
> actualizaba al snap (porque `usePathname()` queda en valor viejo
> durante transition). Ambos issues coupled. Pivot:

**Justificación actual**:

- **`router.push` directo** (sin envolver en `startTransition`) →
  `usePathname()` actualiza inmediato → el dot activo de
  `<SectionDots>` se sincroniza con el snap visual.
- **`loading.tsx` por zona root** con skeleton estructural acorde al
  handoff F.G — bloques `bg-soft` quietos, sin animaciones ruidosas.
  Production-honest: comunica "la app está trabajando" sin mentir
  sobre el tiempo. El skeleton renderiza DENTRO del swiper viewport
  (no en el chrome del shell) gracias a que el swiper resetea su
  transform a `x=0` con `useLayoutEffect` cuando `activeIndex`
  cambia — sin gap visual entre snap completion y skeleton.
- **`<TopProgressBar>` queda DEPRECATED** para R.2.5 — no se importa
  desde el swiper. El código del componente persiste en
  `shared/ui/top-progress-bar.tsx` por si futuro caller (otra feature)
  lo necesita; los tests siguen verde.

Sub-pages mantienen su `loading.tsx` (precedente: thread detail
R.6.4 ya tiene su flujo de espera; el swiper no actúa ahí).

### Decisión 7 — Per-zona scroll preservation con `scrollByZone` Map

**Justificación**: `scroll: false` en `router.push` evita
scroll-to-top automático, pero también deja el scrollY actual al
cambiar de zona — peor UX que el modelo Link (que reset-to-top
siempre).

Map `<ZoneIndex, number>` en useRef del swiper guarda scrollY al
salir de una zona y lo restaura al volver. Patrón estándar en SPAs
(Twitter, Instagram tabs).

### Decisión 8 — Error boundary alrededor del swiper

**Justificación**: si framer-motion crashea o el snap falla por
edge case desconocido, el swiper degrada a pass-through `{children}` +
log via pino. Los dots Link siguen funcionando. Cero downtime UX.

### Decisión 9 — `prefers-reduced-motion` respetado

**Justificación**: accesibilidad. Si el user tiene la preferencia
activa, el spring se reemplaza por snap instantáneo. El gesture sigue
funcional — solo cambia la animación de transición. framer-motion
respeta esto via `useReducedMotion()` hook.

## Alternativas evaluadas y rechazadas

- **Parallel routes** — sub-pages + library R.5 los rompen (ver
  Decisión 3).
- **Realtime per-zona (broadcast subscriptions)** — costo WS no
  justificado en R.2.5 (ver Decisión 4). Queda follow-up.
- **Refresh-on-every-swipe** — desperdicio bandwidth (ver Decisión 4).
- **Hand-rolled gesture handler** — superficie de bugs alta en iOS
  Safari (ver Decisión 1).
- **`revalidate: 30` por page** en vez de `staleTimes` global — más
  opaco que config centralizada (queda como Plan B si `staleTimes` se
  vuelve inestable).
- **Sin scroll preservation** — peor UX que el modelo Link actual
  (ver Decisión 7).
- **Sin error boundary** — riesgo de crash UX por bug en framer-motion
  o edge case del gesture; un error boundary defensivo es trivial y
  protege.

## Implicaciones

- **Dependency framer-motion@^11 adoptada**. Es el segundo paquete
  grande del repo después de `@tiptap/*`. Pinear major.
- **`experimental.staleTimes` en `next.config.ts`** — flag
  experimental. Monitorear release notes de Next; planear migración
  cuando se estabilice.
- **ADR menor en R.5** (library) para ajustar el array `ZONES` +
  behavior con 4ª zona.
- **Memory feedback nuevo** (si aplica): "Next 15 cambió route cache
  default — siempre verificar versión de Next antes de asumir behavior
  de cache".
- **Bundle First Load JS**: monitorear delta tras R.2.5.1.
- **Spec § 16 (`docs/features/shell/spec.md`)** documenta el modelo
  completo. Este ADR documenta el por qué de cada decisión.

## Sub-fases de implementación

Documentadas en spec § 16.10. Resumen:

| Sub                       | Deliverable                                                           |
| ------------------------- | --------------------------------------------------------------------- |
| **R.2.5.0** ✅ (este doc) | Spec § 16 + este ADR + roadmap update.                                |
| **R.2.5.1**               | Install framer-motion. Componentes nuevos + tests unit. Bundle delta. |
| **R.2.5.2**               | Configurar staleTimes. Mount en layout. Remover loading.tsx.          |
| **R.2.5.3**               | Prefetch + lastVisitedAt + refresh condicional + scroll preservation. |
| **R.2.5.4**               | E2E Playwright + manual QA mobile real + edge cases.                  |
| **R.2.5.5**               | Cleanup + docs + roadmap ✅.                                          |

**Total estimado**: 5-6 sesiones (1 spec + 4-5 implementación/QA).
