# 0045 — Invite signup CTA via `/login?mode=signup` (supersede ADR-0044 §D3 extensión de `/crear`)

- **Fecha:** 2026-05-26
- **Estado:** Aceptada
- **Alcance:** ruta `src/app/(app)/place/[placeSlug]/invite/[token]/page.tsx` cambia `signupUrl` de `/crear?returnTo=…` a `/login?returnTo=…&mode=signup` (1 line + comment update) + `/login` (apex) acepta nuevo query param `?mode=login|signup` (whitelist, fallback `login`) y propaga al `<AccessFlow initialMode>` + `<AccessFlow>` acepta nuevo prop `initialMode?: "login" | "signup"` que se pasa a `useAccessForm` como state init (default `"login"` para backwards-compat) + tests del nuevo wiring (RTL `<AccessFlow>` con `initialMode="signup"` arranca con tab signup activo). **NO se toca `/crear`** (PlaceWizard queda 100% intacto). **NO se introduce nueva ADR para `/login`** — esta extensión es additiva (param opcional, default backwards-compat) y queda canónica acá.
- **Habilita:** que el invitee anónimo que clickea "Crear cuenta" desde la page de invite aterrice directamente en el form de signup pre-seleccionado (tab signup activo), con `returnTo` apuntando al invite URL absoluto — sin tener que clickear el tab signup manualmente, y sin tener que crear un place propio que no quiere. Cierra la coherencia semántica entre el label del CTA ("Crear cuenta") y el form que ve al aterrizar.
- **Supersede parcialmente:** ADR-0044 §D3 — la decisión de "Signup usa `/crear?returnTo=…`" + "extensión `/crear` para honrar returnTo post-signup en S5" queda reemplazada por esta ADR. ADR-0044 §D3 queda registro histórico inmutable (no se edita); este registro documenta el cambio de decisión durante la implementación de S5 antes de tocar código (canon CLAUDE.md §"Ante una desviación").
- **Refina parcialmente:** ADR-0033 (`validateLoginReturnTo`): el helper ya acepta absolutas same-registrable-domain matching `/invite/[token]` (S2). El nuevo query param `?mode=signup` es ortogonal al validator de returnTo — vive en el handling del page apex `/login`, no en el helper PURE.
- **No supersede:** ADR-0010 (capability + token-link), ADR-0033 (apex login returnTo allowlist), ADR-0034 (zone-aware DB helper), ADR-0044 §D1/D2/D4/D5/D6/D7 (las otras 6 decisiones de la ADR, intactas), ADR-0008/0009 (vías de entrada login + place-first), ADR-0014 (split onboarding access).

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede. ADR-0044 §D3 NO se edita; queda apuntando a la decisión que se planeó en S0 pero que durante S5 (mismo día, 2026-05-26) se repivoteó.

## Contexto

ADR-0044 §D3 (escrita en S0 de V1.1, 2026-05-26 mañana) estableció que el CTA "Crear cuenta" de la page de invite apuntaría a `/crear?returnTo=…`, con plan-sesiones §S5 dedicado a "extender `/crear` para honrar `returnTo` post-signup". La asunción implícita: `/crear` es un flow de signup que post-success podría redirigir a un URL externo.

Durante el diagnóstico pre-S5 (2026-05-26 tarde), la lectura del código real reveló que **`/crear` no es un signup flow** — es el **PlaceWizard** completo (`src/features/place-wizard/`), 3 pasos (Identidad, Estilo, Cuenta) en modo `place-first` (anónimo) que crea **cuenta + place propio del user** en two-phase via `signUpAccountAction` + `createPlaceAction`. Post-success renderiza `<SuccessPanel>` con CTA estático `<a href="https://{slug}.{rootDomain}">Abrir mi lugar</a>` — no es un redirect dinámico, es un link.

Implicaciones del path ADR-0044 §D3 as-written:

1. **UX rota**: un invitee a un place ajeno se vería forzado a inventar nombre, slug, paleta y branding de un place PROPIO sólo para poder aceptar la invitación a OTRO place. Termina con 2 memberships (el propio creado por necesidad + el invitado). Rompe el principio "el subdomain es el place" del producto (el invitee ya tiene un lugar al cual fue invitado).
2. **Scope técnico mayor**: extender `/crear` para honrar `returnTo` post-success implica modificar (a) page `/crear` para parsear param, (b) `<PlaceWizard>` para aceptar prop nuevo, (c) `<SuccessPanel>` para hacer redirect dinámico en vez de link estático, (d) hook `use-create-submit` para propagar el callback, (e) tests del wizard. ~150 LOC cross-feature, blast radius en 2 slices (`place-wizard/` + `place-creation/`).
3. **Capability ya disponible en `/login`**: el page apex `/login` usa `<AccessFlow>` que ya tiene tab login + tab signup compartiendo `signUpAccountAction`, y **ya honra `returnTo`** desde S11.3 (ADR-0033) — `validateLoginReturnTo` valida + `onSuccess: () => navigate(returnTo ?? Hub)` redirige. El allowlist V1.1 S2 ya acepta absolutas matching `/invite/[token]`. **Sin agregar una sola línea de runtime auth, el invitee podría usar `/login` tab signup y llegar al invite URL post-signup**.

El único gap real para usar `/login` como destino de signup es **coherencia semántica del CTA**: el label dice "Crear cuenta" → el user espera aterrizar en un form de signup, no en un form de login con un tab signup a la derecha. Eso es un click extra (innocuous) + confusión cognitiva ("¿por qué me piden login si dije Crear cuenta?").

### Por qué repivot ahora y no implementar §D3 como estaba

- **Window de refinamiento sana**: ADR-0044 fue aceptada hoy mismo (2026-05-26), sin smoke en producción, sin feedback de users. Repivot pre-S6 (sin código del `/crear` extension shipeado, sin migration nueva, sin commits a tocar) tiene blast radius = 0. La canon CLAUDE.md §"Ante una desviación: pausá, no la implementes, consultá el motivo. Si se acuerda, se registra en `docs/decisions/` con fecha y razón **antes** de implementar" cubre exactamente este caso.
- **Discovery durante diagnóstico**: el principio "Diagnosticar antes de implementar" (CLAUDE.md §"Antes de implementar") forzó la lectura del código actual antes de tocarlo — y eso reveló el mismatch entre la asunción de ADR-0044 §D3 y la realidad de `/crear`. Implementar §D3 a ciegas habría requerido un revert + nueva ADR + nueva sesión.
- **No es feature creep ni scope drift**: el repivot no agrega capability nueva ni cambia el contrato del flow accept. Sólo cambia el page target del CTA signup (de `/crear` a `/login`). El flow user-facing es idéntico o mejor (sin obligación de crear place propio).

## Decisión

### D1 — Signup CTA de invite apunta a `/login?returnTo=…&mode=signup`, no a `/crear`

La page `src/app/(app)/place/[placeSlug]/invite/[token]/page.tsx` construye:

```ts
const signupUrl = `${baseLoginUrl}?returnTo=${returnToParam}&mode=signup`;
// baseLoginUrl = buildApexLoginUrl({ defaultLocale: locale }) — mismo helper que loginUrl.
```

Pre-ADR-0045 era `https://${rootDomain()}/${locale}/crear?returnTo=${returnToParam}`. Post-ADR-0045 ambos CTAs (login + signup) apuntan al mismo apex `/login`, diferenciados sólo por el query param `mode`. El comment §"i18n" del page se actualiza para reflejar la nueva semántica (sin referencia a "S5 extiende `/crear`").

### D2 — `/login` apex acepta nuevo query param `?mode=login|signup` con whitelist + fallback

`src/app/(marketing)/[locale]/login/page.tsx` parsea `searchParams.mode`:

```ts
const initialMode: "login" | "signup" =
  rawMode === "signup" ? "signup" : "login";
```

Whitelist strict (sólo `"signup"` switchea, cualquier otro valor — incluido `null`/`undefined`/`"login"`/typos — cae a `"login"` por default). Sin throw, sin validation error visible al user — un param inválido se ignora silenciosamente y el page renderiza el default login tab. Defensa contra: typo del developer, URL maliciosa con `mode=<script>`, browser history corruption.

El page pasa `initialMode` como prop a `<AccessFlow>`. Sin el param, el comportamiento es idéntico al pre-ADR-0045 (`initialMode = "login"` default, backwards-compat con todos los entry points existentes: signup desde landing, login directo, cold-start SSO M1).

### D3 — `<AccessFlow>` extiende prop con `initialMode?: "login" | "signup"`, propaga al hook

`src/features/access/ui/access-flow.tsx` acepta prop opcional `initialMode?: "login" | "signup"` (default `"login"`). Lo pasa al `useAccessForm({ ..., initialMode })`. El hook usa el valor como `useState<Mode>(initialMode ?? "login")` — runtime cost = 0 (state init es lazy en React).

El user sigue pudiendo switchear entre tabs post-mount via los botones (`switchMode("login" | "signup")`). El prop sólo decide qué tab está activo al primer render.

### D4 — `<AccessFlow>` y `useAccessForm` son additivos: prop opcional + default backwards-compat

El cambio en el slice `access/` es 100% additivo:

- `useAccessForm` agrega 1 opt opcional (`initialMode?: Mode`).
- `<AccessFlow>` agrega 1 prop opcional.
- Todos los consumers existentes (que sólo pasan `labels`/`auth`/`locale`/`returnTo`/`termsHref`/`privacyHref`/`homeHref`/`navigate`) siguen funcionando idénticos sin cambio.
- Tests existentes (8 escenarios en `access-flow.test.tsx`) pasan sin modificación.

Sin cambio de versión interna, sin migration de consumers, sin breaking change ESLint.

### D5 — `/crear` NO se toca

El PlaceWizard queda 100% intacto. Sin nuevos props, sin nuevos params, sin nuevo handler. El flow place-first (landing CTA → `/crear` → 3 pasos → place + cuenta creados) sigue siendo la vía canónica para usuarios que quieren crear su propio place. El flow Hub authed (Hub estado vacío → `/crear?from=hub` → 2 pasos) también intacto. ADR-0044 §D3 propuso tocarlo; ADR-0045 cancela ese touch.

## Alternativas rechazadas

### 1. Implementar ADR-0044 §D3 as-written: extender `/crear` post-success para honrar `returnTo`

Descartada. Razones (in-extenso en §Contexto):

- **UX rota**: invitee crea place propio que no quiere para poder aceptar invitación a otro place. Rompe principio "el subdomain es el place".
- **Scope técnico mayor**: ~150 LOC cross-feature en 2 slices (`place-wizard/` + `place-creation/`).
- **Duplica capability ya en `/login`**: signup tab + returnTo handling ya existen.

### 2. Signup CTA → `/login?returnTo=…` sin `?mode=signup` (mantener tab login default)

Descartada. Razones:

- **Rompe contrato semántico del CTA "Crear cuenta"**: user clickea label que promete signup, aterriza en form de login con un tab signup discreto a la derecha. Confusión cognitiva + 1 click extra obligatorio.
- **Costo del fix es trivial (~10 LOC, 3 files)**: el `?mode` param + `initialMode` prop son additivos puros, sin breaking change ni tests rotos. La asimetría costo/beneficio favorece muy fuertemente incluirlo.
- **UX manda**: en una feature de onboarding (primer touch del invitee con el producto), cada friction cuenta. Tab signup pre-seleccionado es default obvio.

### 3. Página signup dedicada `/[locale]/signup` separada de `/login`

Descartada. Razones:

- **Duplica `<AccessFlow>`**: el componente ya tiene los dos modos. Una page nueva re-renderizaría el mismo flow + agregaría boilerplate (parsing returnTo + guard sesión + getTranslations + props down).
- **Convención existente del producto**: `/login` es el único entry point auth-related en apex. Mantener single entry point con modo configurable simplifica el modelo mental.
- **No agrega capability**: el `?mode=signup` query param ya cubre el caso "aterriza con signup activo". Página nueva sería mismo código bajo otra URL — sin reuse, sin desambiguación funcional.

### 4. Reverse — `/login` queda como está, mover CTA a `/signup` page nueva apuntada por el invite

Mismo caso que #3, con el CTA del invite apuntando a la página nueva. Descartada por las mismas razones + agrega friction de mantener 2 pages similares + cualquier nuevo entry point (e.g. magic-link onboarding futuro) tendría que decidir cuál de los dos `/login` o `/signup` consumir.

### 5. `?signup=1` (boolean) en lugar de `?mode=signup` (enum)

Descartada por menor extensibilidad: si V2 introduce un tercer modo (e.g. magic-link only, OAuth-only), `mode` enum extiende limpio mientras `signup=1` requeriría param nuevo + lógica de prioridad entre params. Coste cero de prevención.

### 6. Mantener el plan original §D3 + revisitar pre-ship si user feedback lo demanda

Descartada. Razones:

- **El gap de UX es estructural, no de pulido**: forzar al invitee a crear place propio no es algo que mejora con polish — requiere repensar el target del CTA.
- **Time-to-fix post-deploy es mayor**: una vez shipeado, los invitees usarían el flow rota; el fix requeriría revert + nuevo deploy + comunicación de cambio. Pre-ship es código de aplicación local, blast radius cero.
- **Canon CLAUDE.md §"Ante una desviación"**: forzar implementar una decisión que el diagnóstico mostró errónea viola el principio "pausá, no la implementes, consultá el motivo".

## Consecuencias

### Positivas

1. **Coherencia semántica CTA → form**: el user clickea "Crear cuenta" y aterriza en signup form. Sin friction, sin sorpresa.
2. **Blast radius mínimo**: ~10 LOC en `access/` (additivo) + 1 LOC en page invite + 1 LOC en test invite + ~30 LOC test nuevo. Sin tocar `place-wizard/` ni `place-creation/`.
3. **Sin `/crear` extension**: PlaceWizard intacto, sin posibilidad de regresiones en el flow place-first canónico (Feature A V1).
4. **Path apex unificado**: ambos CTAs del invite (login + signup) apuntan a `/login` con `mode` distinto. Modelo mental simple: el apex tiene 1 page auth, configurable por param.
5. **Pattern reusable**: cualquier futura entry point que quiera pre-seleccionar tab puede usar `?mode=signup` sin tocar el page apex (e.g. magic-link onboarding V1.2+, invite a co-owner V1.1+).
6. **ADR-0033 invariante**: `validateLoginReturnTo` no cambia. El nuevo param `mode` es ortogonal al validator del returnTo (vive en page handler, no en helper PURE).

### Neutras

1. **ADR-0044 §D3 superseded sin re-edición**: la ADR original queda intacta como registro histórico de la decisión inicial. Esta ADR documenta el cambio + razón. Lector futuro que llegue a §D3 ve la referencia "superseded by ADR-0045" en el índice `decisions/README.md` y entiende el contexto.
2. **Plan-sesiones §S5 cambia scope**: write-back a `docs/features/invitations/plan-sesiones.md` §S5 refleja el nuevo scope (5 files code + 3 docs) en vez del scope original ("extender `/crear`"). El plan original queda en git history.
3. **Spec `docs/features/invitations/spec.md` actualizado**: 4 referencias a `/crear` se actualizan a `/login?mode=signup` para mantener spec coherente con el código post-S5. Cambio editorial, no semántico (sigue siendo el mismo flow user-facing).

### Negativas

1. **Param `?mode=signup` requiere mantener whitelist actualizada**: si V2 agrega un tercer modo (e.g. `oauth`), hay que extender el whitelist en `login/page.tsx` + tipo en `<AccessFlow>` + estados en `useAccessForm`. Costo de evolución bajo (3 lines + 1 test) pero existe.
2. **Browser history puede acumular params decorativos**: un user que navega via tab switcher post-mount NO actualiza el query param de la URL (el `mode` sólo decide initial state, no es state sincronizado). Si el user copia la URL post-switch, comparte una URL con `mode=signup` aunque haya switched a login. Aceptable V1.1 (no afecta correctness — quien abra esa URL sólo ve initial tab signup, puede switchear igual). V1.2+ podría sincronizar con `router.replace` si UX-confusion aparece.
3. **Tab switcher manual UX queda igual**: si por alguna razón el user llega al apex `/login` desde otro entry point (e.g. cold-start SSO M1 con `returnTo=...sso-issue...`) y luego decide hacer signup en vez de login, tiene que clickear el tab. No es regresión (era así pre-ADR), pero ADR-0045 no aborda ese caso (out of scope — no es el flow del invite).

## Plan de implementación (S5)

Re-scope del plan-sesiones §S5 (write-back canon):

**Files (5 code + 2 tests + 3 docs)**:

```
src/features/access/ui/
├── use-access-form.ts                            [M: +3 LOC]    (opt initialMode)
├── access-flow.tsx                               [M: +4 LOC]    (prop initialMode pass-through)
└── __tests__/
    └── access-flow.test.tsx                      [M: +~30 LOC]  (1 test nuevo: initialMode="signup")

src/app/(marketing)/[locale]/login/
└── page.tsx                                      [M: +6 LOC]    (parse searchParams.mode + pass)

src/app/(app)/place/[placeSlug]/invite/[token]/
├── page.tsx                                      [M: ~3 LOC]    (signupUrl + comment update)
└── _components/__tests__/
    └── invite-acceptance-panel.test.tsx          [M: ~1 LOC]    (baseProps.signupUrl literal)

docs/
├── decisions/0045-invite-signup-cta-via-login-mode-signup.md  [N: ~150 LOC]  (esta ADR)
├── decisions/README.md                           [M: +1 entry]
├── features/invitations/spec.md                  [M: ~6 lines]  (referencias /crear → /login?mode=signup)
└── features/invitations/plan-sesiones.md         [M: ~30 lines] (write-back §S5 scope)
```

**LOC total**: ~50 code + ~30 test + ~190 docs = ~270 LOC.

**Verificación pre-commit**:

- `pnpm typecheck`: clean.
- `pnpm lint`: clean.
- `pnpm test`: suite verde + nuevo test `initialMode="signup"` + 8 tests existentes de access-flow intactos + 8 tests del invite panel intactos (cambio sólo en string literal).
- Sin browser smoke en S5 — smoke E2E manual contra prod en S6 (canon plan-sesiones).

**Commit**: `feat(access): /login acepta ?mode=signup + invite CTA signup → /login (V1.1 S5, supersede ADR-0044 §D3)`.

**Tag**: `baseline/feature-e-invite-accept-s5-done`.

**Rollback S5**: `git reset --hard baseline/feature-e-invite-accept-s4-done`.

## Pointers operacionales

- **ADR superseded parcialmente**: [`./0044-invite-accept-flow.md`](./0044-invite-accept-flow.md) §D3 (decision sólo del Signup CTA path; §D1/D2/D4/D5/D6/D7 intactas).
- **ADRs canónicas pre-V1 del slot relevantes**:
  - [`./0033-apex-login-honors-returnto.md`](./0033-apex-login-honors-returnto.md) — `validateLoginReturnTo` allowlist (ortogonal al nuevo `?mode=signup`).
  - [`./0008-dos-vias-de-entrada.md`](./0008-dos-vias-de-entrada.md) + [`./0009-cierre-subpuntos-adr-0008.md`](./0009-cierre-subpuntos-adr-0008.md) — vías de entrada login + place-first.
  - [`./0014-split-onboarding-place-creation-access.md`](./0014-split-onboarding-place-creation-access.md) — split del slice `onboarding/` en `place-creation/` + `access/`.
- **Patrón consumido**:
  - `<AccessFlow>` + `useAccessForm` (slice `access/`) — extendido additivamente con prop `initialMode`.
  - `/login` page apex — extendido additivamente con param `?mode=login|signup`.
- **Files NO tocados (decisión explícita)**:
  - `src/app/(marketing)/[locale]/crear/page.tsx`.
  - `src/features/place-wizard/` (entire slice).
  - `src/features/place-creation/` (entire slice).
- **Write-back canónico**:
  - [`../features/invitations/plan-sesiones.md`](../features/invitations/plan-sesiones.md) §S5 — scope nuevo reflejado.
  - [`../features/invitations/spec.md`](../features/invitations/spec.md) — 4 refs `/crear` → `/login?mode=signup`.
- **Save point**: `baseline/feature-e-invite-accept-s4-done` = `f1368ca` (post S4 i18n placeInvitation × 6).
- **Tag final V1.1**: `baseline/feature-e-invite-accept-done` (asignado en S6 post-push, sin cambio por ADR-0045).
