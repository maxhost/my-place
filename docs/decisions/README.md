# Decisiones de arquitectura (ADR)

Registro de decisiones arquitectónicas con fecha, alternativas rechazadas y consecuencias. Una ADR es histórica: no se edita, se supersede con una nueva.

- [0001 — Auth: OIDC IdP propio, identidad separada y custom domains](0001-auth-oidc-custom-domains.md) — 2026-05-15
- [0002 — Roles owner/miembro, reconocimiento de pertenencia, ciclo de vida del handle](0002-roles-gamificacion-handle.md) — 2026-05-16
- [0003 — Lifecycle de cuenta y de place; tombstone; reemplazo de los 365 días](0003-lifecycle-cuenta-place-tombstone.md) — 2026-05-16
- [0004 — Capa de acceso a datos: Drizzle ORM](0004-acceso-datos-drizzle.md) — 2026-05-16
- [0005 — Onboarding del owner: creación de place y cuenta](0005-onboarding-creacion-place.md) — 2026-05-16
- [0006 — Provisión de `app_user`, RLS base y modelo rol/JWT](0006-provision-appuser-rls-base-rol-jwt.md) — 2026-05-16
- [0007 — Ajuste: el LLM del onboarding no propone horario; horario default](0007-ajuste-llm-horario-default.md) — 2026-05-16
- [0008 — Dos vías de entrada: CTA (place-first) vs "Acceso" (login form, account-first)](0008-dos-vias-de-entrada.md) — 2026-05-16
- [0009 — Cierre de los sub-puntos abiertos de ADR-0008](0009-cierre-subpuntos-adr-0008.md) — 2026-05-16
- [0010 — RLS por-operación + invitación solo por token-link](0010-rls-por-operacion-invitacion-token-link.md) — 2026-05-17
- [0011 — Función de identidad RLS propia (`app.current_user_id()`)](0011-funcion-identidad-rls-propia.md) — 2026-05-17
- [0012 — Creación de place vía función `SECURITY DEFINER`; INSERT denegado por RLS](0012-creacion-place-via-funcion-definer.md) — 2026-05-17
- [0013 — Cambio de stack: Next.js 15 → 16 (prerequisito de S4)](0013-upgrade-next-16.md) — 2026-05-17
- [0014 — Split del slice `onboarding` en `place-creation` + `access`](0014-split-onboarding-place-creation-access.md) — 2026-05-18
- [0015 — Extraer la asistencia LLM a un slice propio `style-assist`](0015-extraer-slice-style-assist.md) — 2026-05-18
- [0016 — Extraer la UI del wizard a un slice propio `place-wizard`](0016-extraer-slice-place-wizard.md) — 2026-05-18

> Los números de ADR se asignan al redactarse, no se reservan por adelantado. La ADR de comisión/pricing (referida en `docs/landingpage/`) tomará el número que corresponda cuando se cierre.
