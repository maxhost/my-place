# ADR — Rediseño layout de threads (R.6)

**Fecha**: 2026-04-26
**Estado**: Aprobado
**Sub-milestone**: R.6.0 (spec del rediseño)
**Referencias**: `docs/features/discussions/spec.md` § 21, `handoff/threads/`,
`handoff/threads-detail/`, `docs/decisions/2026-04-27-design-handoff-rebrand.md`
(F.G — tokens base), `docs/decisions/2026-04-26-events-as-thread-unified-url.md`
(F.F — URL canónica)

## Contexto

Tras R.1 (migración tokens `place-*` → tokens nuevos del rebrand F.G)
y R.2 (introducción del shell común), las pages de discussions
seguían con el layout heredado: cards uniformes con border completo,
sin section header chip, sin filter pills, sin featured thread, sin
reader avatars stacked en la lista.

El user lo notó visualmente al comparar con el handoff `threads/`: la
realidad NO coincide con el design canónico.

**Gap del roadmap macro original**: R.1 fue "migración visual de
tokens", no "rediseño de layout". El layout del handoff `threads/` +
`threads-detail/` quedó fuera de scope sin que se documentara
explícitamente. R.6 cubre ese gap.

El handoff define tres elementos centrales que faltan:

1. **Section header con chip emoji + título Fraunces 38** — comunica
   identidad de la zona en el contenido, no solo en los dots del shell.
2. **Featured thread card** (primer post destacado) — diferencia
   visual entre el thread más reciente y el resto.
3. **Thread rows simples sin border** con hairline divider — más
   denso y legible que cards apiladas.

Adicional: el thread detail necesita un **back button visible**
(crítico para UX touch mobile) y composer **sticky bottom** acorde al
handoff `threads-detail/`.

Adoptarlo tal cual conflictúa con 4 decisiones de producto ya tomadas:

1. `ReactionBar` con 6 emojis (decisión F.A) vs ♥ simple del handoff.
2. Sin schema change para `featured` — admin pinning sería work
   adicional.
3. Filtros (`Sin respuesta`, `En los que participo`) requieren
   extender query — work no trivial.
4. Header bar del thread detail vs el shell ya presente (138-136px
   chrome top combinado).

## Decisiones

Se consultaron al user las 4 decisiones bloqueantes antes de planear
(CLAUDE.md "Sin libertad para decisiones arquitectónicas").

### Decisión 1 — 6 emojis preservados (NO ♥ simple)

Mantener el `ReactionBar` con 6 emojis (👍 ❤️ 😂 🙏 🤔 😢). El
handoff muestra `♥ + count` solo como visualización compacta del like
total — pero el producto tiene una decisión de producto F.A explícita
de 6 emojis (`docs/features/discussions/spec.md` § 3, registro F.A).

**Rationale**:

- Cero migrations DB. La tabla `Reaction` con `emoji` enum se mantiene
  intacta.
- F.A formaliza que las reacciones son matiz emocional ("pulgar
  arriba", "corazón", "risa", "gracias", "pensativo", "tristeza"),
  no un solo gesto binario.
- El restyle visual del `ReactionBar` (gap 18px, sin background propio,
  count compacto al lado de cada emoji) cumple la intención compacta
  del handoff sin romper la decisión de producto.

**Implicación**: el "like count total" del handoff (singular) se
interpreta como sum de reactions de todos los emojis si producto
necesita un número agregado. F1 deja los counts implícitos por emoji.

### Decisión 2 — Featured heurístico (NO admin pinning)

El "featured thread" del handoff se determina por heurística simple:
**el primer thread por `lastActivityAt` queda como featured**. Sin
schema change, sin admin action.

**Rationale**:

- Cero schema change (no hace falta `Post.pinned bool` ni RLS extra).
- Heurística temporal simple, alineada con el principio "sin
  algoritmo de ranking" (CLAUDE.md). Es solo "el más reciente con
  actividad" — coincide con la cabeza natural de la lista.
- Admin pinning agrega trabajo (UI toggle, action, RLS, tests) sin
  valor claro F1 — diferido como follow-up si producto lo pide
  explícitamente.

**Implicación**: si no hay threads, no hay featured. El featured
cambia automáticamente cuando llega un comment a un thread más viejo
(reactiva su `lastActivityAt`).

### Decisión 3 — Filtros incrementales (solo "Todos" en R.6)

3 filter pills visibles (`Todos` / `Sin respuesta` / `En los que
participo`), pero solo `Todos` es funcional en R.6. Las otras dos
quedan con `aria-disabled="true"` + `title="Próximamente"`.

**Rationale**:

- Implementar los 3 requiere extender `listPostsByPlace` para aceptar
  `filter` arg, agregar lógica server-side, tests. Trabajo no trivial.
- "Sin respuesta" = `commentCount === 0` requiere agregar
  `commentCount` al `PostListView` (R.6.1 ya lo hace para el footer
  "{n} respuestas").
- "En los que participo" = viewer es autor del post O viewer hizo
  comment activo. Requiere subquery o join extra.
- División incremental: visual completo en R.6, filters como R.6.X
  follow-up con su propio ADR si producto prioriza.

**Implicación**: los pills son decorativos en R.6 (excepto `Todos`).
El user ve el chrome completo del handoff sin esperar al backend full.

### Decisión 4 — Header dentro del shell (suma chrome)

El `<ThreadHeaderBar>` del thread detail (back button + slot
overflow) se monta DENTRO del viewport del shell, sumando chrome:
TopBar (52px) + dots (28px) + ThreadHeaderBar (56px) = 136px arriba.

**Rationale**:

- Preserva el shell sin context drilling ni prop especial
  `hideShell`. R.2 quedó como inversión arquitectónica que no
  queremos revertir.
- El thread detail mantiene la consistencia del chrome (switcher,
  search, dots) además del back button.
- 136px arriba es alto para mobile pequeño (iPhone SE 568px viewport
  → 24% del alto) pero aceptable para R.6 v1.

**Implicación**: si en QA visual queda muy alto, evaluar como
follow-up reemplazar la TopBar+dots con el header bar del thread
detail SOLO en pages de detail (decisión 4 alternativa "header
reemplaza shell"). Por ahora se acepta el chrome adicional.

## Alternativas descartadas

1. **Like simple (♥)**: requeriría migrar `Reaction.emoji` enum a
   boolean. Rompe el modelo de matiz emocional decidido en F.A.
2. **Admin pinning**: schema change + admin UI + tests. Sin valor
   claro F1.
3. **Refactor de URL** (`/t/[threadId]` del handoff): rompe la
   decisión F.F validada (URL canónica `/conversations/[postSlug]`).
4. **Header reemplaza shell**: ocultar TopBar + dots SOLO en pages de
   detail requiere context, prop drilling o route group adicional.
   Más complejo y sin valor inmediato sobre la opción 4 elegida.
5. **Sin featured (todos como rows)**: pierde el hero visual que
   diferencia "el más reciente" del resto. El user lo eligió
   explícitamente.
6. **Skip filter pills enteros**: pierde la UX intent del handoff.
   Compromiso: visual presente, lógica incremental.

## Implicaciones

- **Rewrite extenso**: PostList + PostCard + PostDetail + CommentThread
  - CommentItem + QuotePreview + CommentComposer + ReactionBar +
    PostReadersBlock — todos con restyle visual (lógica intacta).
- **Backend extendido**: `PostListView` agrega `snippet`, `commentCount`,
  `readerSample`, `isFeatured`. Helper `richTextExcerpt` server-side.
  Performance ya validable con Promise.all (mismo patrón ya optimizado).
- **Componentes nuevos shared**: `<BackButton>` y `<ReaderStack>` en
  `shared/ui/` — primitivos puros agnósticos del dominio (mismo patrón
  Avatar/MemberAvatar ya validado en F.G).
- **Cero migración DB**: ningún cambio de schema. Featured derivado,
  filters diferidos.
- **Componentes intactos**: ThreadPresence, DwellTracker, RichTextEditor,
  RichTextRenderer, EventMetadataHeader (F.F), EditWindowActions,
  FlagButton, LoadMorePosts, PostAdminMenu (movido a slot del
  HeaderBar pero sin cambio de lógica).
- **Gap CRÍTICO R.6.4**: el shell viewport actual es `flex-1
overflow-hidden`, lo que bloquea `position: sticky bottom` para el
  composer. Resolver con uno de:
  - Cambiar viewport a `flex-1 overflow-y-auto` (scroll del shell).
  - Composer `fixed bottom-0` con padding del contenido.
  - Mini-ADR propio si requiere decisión adicional.

## Sub-fases R.6

- **R.6.0** (este doc + spec § 21) — Aprobado.
- **R.6.1**: helper `richTextExcerpt` + extensión `PostListView`.
- **R.6.2**: `<BackButton>` y `<ReaderStack>` en `shared/ui/`.
- **R.6.3**: rewrite list (5 componentes nuevos + reescritura de
  `<PostList>` + adaptación de page + tests + E2E).
- **R.6.4**: rewrite detail (`<ThreadHeaderBar>` + restyle de 7
  componentes + composer sticky + resolver gap viewport).
- **R.6.5**: cleanup + verificación + manual QA + roadmap update.

## Verificación

R.6.0 es spec-only. Sin código tocado. Verificación: lint pasa, spec

- ADR + roadmap están consistentes entre sí. Manual review humano del
  spec § 21.
