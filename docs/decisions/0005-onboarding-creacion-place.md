# 0005 — Onboarding del owner: creación de place y cuenta

- **Fecha:** 2026-05-16
- **Estado:** Aceptada
- **Alcance:** producto (onboarding), arquitectura (saga signup, routing), modelo de datos, auth, billing (trial), IA
- **Ajusta:** el principio "Customización activa, no algorítmica" de `docs/producto.md` (ver §Decisión 6); no supersede ninguna ADR

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

Primera feature post-landing: el registro. Foco **owner-first**: el alta arranca creando el place, la cuenta se pide al final. Antes de implementar se cerró S0 (decisiones, esta ADR) con el owner, y se diagnosticó el estado real de Neon (no asumir).

### Diagnóstico Neon (hechos, 2026-05-16)

- Proyecto `prod-place` (`odd-mountain-73982304`), org "The No-Code Company" (plan free), branch `production`. **Región AWS `us-east-1`** (cierra el TBD de región de `stack.md`). Postgres 17.
- **Neon Auth ya provisionado, `auth_provider: better_auth`.** No hay auth legacy a migrar: el doc `neon.com/docs/auth/migrate/from-legacy-auth` es moot para este proyecto. Tablas auth en schema **`neon_auth`** (`user, session, account, verification, jwks` + plugin organization: `organization, member, invitation`), library-owned.
- Config actual: email+password on, email verification **off**, sender **"shared" de Neon** (no Resend). `jwks` presente → firma de tokens OIDC gestionada por Neon Auth (cierra el "TBD acotado" de ADR-0001).

## Decisión

**1. Flujo y host.** Wizard multi-paso en el apex `place.community` (la CTA de la landing ya apunta ahí), i18n bajo `[locale]` (contenido estático se traduce, `producto.md`). Pasos: (a) nombre del place + subdominio con preview de URL, (b) descripción "para quién" + colores + horario (con asistencia LLM, ver §5), (c) datos de cuenta: nombre completo, email, contraseña, aceptar términos. **Estado del wizard 100% client-side hasta el submit final** — sin draft en server → cero places huérfanos.

**2. Creación = saga ordenada, no transacción única.** Better Auth (Neon Auth) es dueño de la identidad de login en su propio sistema (`neon_auth`); `app_user` y el core viven en `public`. No hay BEGIN/COMMIT cross-system. Orden canónico al submit:

1. Better Auth crea la identidad de login (email+password).
2. Hook transaccional al signup crea `app_user` 1:1 (`app_user.auth_user_id` → `neon_auth.user.id`, referencia lógica cross-schema, sin FK hard) + handle random no-usado (ADR-0002).
3. Transacción de app (`public`): `place` + `place_ownership` + `membership` del owner, con invariantes (reserved-slugs, slug único, máx 150, mínimo 1 owner — `data-model.md`).

**Falla parcial:** si falla el paso 3, la cuenta (1–2) **queda creada** (ver §4). Si falla 1, no se persiste nada. La compensación/cleanup de un place a medio crear se maneja en el paso 3 dentro de su propia transacción (atómica de por sí). Idempotencia: reintentar el submit no duplica identidad (email único en Better Auth) ni `app_user` (`auth_user_id UNIQUE`).

**3. Billing trial.** Al crear el place: `billing_mode = 'OWNER_PAYS'`, `subscription_status = 'ACTIVE'`, y **`place.trial_ends_at = now() + 30 días`** (columna nueva, ver `data-model.md`). Durante el trial el place es 100% usable y no se pide nada de pagos. Al expirar el trial sin pago, el place entra al flujo **`PAYMENT_PENDING`** de ADR-0003 (paywall al owner: no entra, solo regularizar/transferir/cerrar). El mecanismo de cobro sigue TBD (Pagos, `stack.md`); lo decidido acá es el arranque y el disparador del paywall.

**4. La cuenta no existe sin place — con excepciones.** El alta del apex es siempre creación de place (owner). Una cuenta puede quedar **sin place solo si falla el paso 3 de la saga** (el usuario reintenta la creación del place; cae en un estado vacío "creá tu place", no en error fatal). **Excepciones de diseño** (flujos aparte, fuera del alcance owner-first de esta tanda): alta de cuenta desde **invitación a un place** o desde **"join" a un place del directorio** → ahí se crea cuenta + `membership`, sin crear place.

**5. Asistencia LLM en el onboarding (v1).** El LLM, a partir de la descripción libre "para quién es el place", **propone**: (a) paleta acotada, (b) borrador de descripción del place, (c) sugerencia de `opening_hours`. Vía **Vercel AI Gateway** (string `"provider/model"`, modelo chico/rápido con salida estructurada validada por Zod; modelo concreto se fija al implementar). **Toda salida es propuesta editable y confirmada por el humano; nada se auto-aplica.**

**6. Reconciliación con "Customización activa, no algorítmica" (`producto.md`).** Ese principio prohíbe que el orden/la personalización los decida un algoritmo. El LLM acá **no decide**: sugiere un punto de partida que el owner edita y confirma explícitamente antes de persistir. La decisión sigue siendo humana y activa. Con esa restricción (propose-only + confirm obligatorio + nada auto-aplicado), el principio se mantiene. Si alguna vez se auto-aplicara salida de LLM sin confirmación, se violaría — está prohibido. (Precedente de ajuste de principio vía ADR: 0002.)

**7. `theme_config` = paleta acotada.** El owner setea **3 tokens**: `--accent`, `--bg`, `--ink`. El producto **deriva** `--surface`, `--muted`, `--border`, `--accent-strong`, `--accent-ink` de forma determinística en render (no se persisten los derivados; se persisten solo los inputs del owner). **Default = paleta "Papel" de marca** (mismos valores que la landing → continuidad visual marca↔place). Shape JSON canónico en `data-model.md`.

**8. Guardrail de contraste = auto-ajustar + avisar.** Si un par de colores (elegido por el owner o propuesto por el LLM) no cumple el contraste WCAG (mismos umbrales que la landing), el sistema **deriva una variante que sí cumple** (igual que `--accent-strong` en la landing) y **avisa al owner qué ajustó**. Nunca bloquea el guardado ni aplica un place inaccesible silenciosamente.

**9. Email verification.** El place se crea **sin** verificar email (no bloquea el alta). La verificación (vía **Resend** como email provider de Neon Auth, reemplaza el sender "shared") es **requisito para mutar `/settings`** del place: las acciones de settings chequean `neon_auth.user.emailVerified`. Lectura/uso del place durante el trial no requiere verificación. **Auth v1: email+password solamente** (sin social/Google por ahora, aunque Neon Auth lo trae disponible).

**10. Routing por subdominio entra en el alcance.** Se construye en esta tanda: estructura `(marketing)` / `(app)`, middleware host-based (apex → marketing/onboarding; `{slug}.place.community` → place; `app.` → inbox), wildcard DNS/Vercel. El place creado queda servible en `{slug}.place.community` de una. El middleware i18n actual (solo landing) se integra con el host-based. **No** se usan las tablas del plugin organization de Better Auth (`neon_auth.organization/member/invitation`) para modelar `place`: el place vive en `public` (`data-model.md`); esas tablas se ignoran para el dominio.

## Alternativas rechazadas

- **Transacción atómica única cuenta+place.** Imposible limpio: identidad de login en sistema separado (`neon_auth`). Rechazada; saga ordenada con falla parcial controlada.
- **Bloquear el alta hasta verificar email.** Más fricción en el momento de mayor intención; el valor (crear el place) se entrega ya y la verificación gatea solo la edición de settings. Rechazada por conversión.
- **LLM auto-aplica la config.** Viola "customización activa, no algorítmica". Rechazada; propose-only + confirm.
- **Owner setea todos los tokens / o solo acento+preset.** "Todos" → riesgo de places ilegibles y guardrails pesados; "solo acento+preset" → poca identidad. Se eligió el punto medio (acento+bg+ink, resto derivado) por expresividad con usabilidad garantizada.
- **Diferir el routing por subdominio.** Dejaría el place creado pero no servible en su URL canónica; se decidió incluirlo para que el resultado del onboarding sea funcional end-to-end.

## Consecuencias

- `data-model.md`: nueva columna `place.trial_ends_at`; shapes JSON canónicos de `theme_config` y `opening_hours`; nota de que las tablas auth viven en `neon_auth`.
- `stack.md`: región confirmada `us-east-1`; Email transaccional = Resend (cierra ese sub-TBD); IA = Vercel AI Gateway; Neon Auth provisionado (Better Auth).
- `architecture.md` / `multi-tenancy.md`: saga de signup; routing host-based + `(marketing)/(app)` entran al alcance.
- `producto.md`: nota de reconciliación del LLM propose-only (ref. esta ADR).
- TBD acotados que se cierran al implementar: modelo concreto del LLM en AI Gateway; rol Postgres no-admin para RLS (ADR-0004); `neon-http` vs `neon-websockets`; método de verificación de email de Neon Auth (OTP vs link) con Resend.
- Pagos sigue TBD: solo se definió el arranque del trial y el disparador del paywall, no el cobro.

## Detalle operativo canónico

- Schema (`trial_ends_at`, `theme_config`, `opening_hours`, esquemas): `docs/data-model.md`.
- Saga de signup y routing host-based: `docs/architecture.md`.
- Host del onboarding, subdominios, estructura de rutas: `docs/multi-tenancy.md`.
- Capa de datos (Drizzle) y RLS: ADR-0004.
- Lifecycle de place/trial→paywall: ADR-0003.
- Identidad separada, OIDC, custom domains: ADR-0001.
