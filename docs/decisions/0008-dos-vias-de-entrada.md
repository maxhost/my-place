# 0008 — Dos vías de entrada: CTA (place-first) vs "Acceso" (login form, account-first)

- **Fecha:** 2026-05-16
- **Estado:** Aceptada (con 2 sub-puntos abiertos, ver §Zonas a confirmar)
- **Alcance:** producto (onboarding/login), arquitectura (saga en dos modos), landing, modelo de datos (estado cuenta-sin-place)
- **Extiende:** ADR-0005 §1 (flujo único owner-first) y §4 (cuenta-sin-place como excepción)

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

ADR-0005 §1 definió **un** flujo: place-first, cuenta al final, single-submit. Al cerrar el diseño del `/login`, el owner definió que además hay una **segunda vía de entrada** distinta de los CTA de la landing. No se improvisa: se registra antes de implementar.

## Decisión

**1. Dos puntos de entrada en la landing, distintos:**

- **CTAs "Creá tu place" / "Empezá gratis"** (hero, pricing, cierre) → **flujo place-first** de ADR-0005 §1 (wizard, cuenta al final, single-submit saga). Sin cambios.
- **Nuevo item "Acceso" en el menú** de la landing (distinto de los CTA) → **formulario de login**.

**2. La vía "Acceso" es account-first:**

- El form de login permite **loguearse** o, si no hay cuenta, **crearla**.
- Crear cuenta acá pide **primero los datos de cuenta** (nombre, email, password, aceptar términos) → crea la identidad (Neon Auth `signUp` + `ensureAppUser`, **sin place**).
- Luego ofrece dos caminos:
  - **"Crear mi place"** → entra al **flujo de creación de place reutilizado, SIN el paso de cuenta** (ya autenticado): solo pasos place/slug + descripción/colores. 
  - **"Unirme a un place"** → (a) ver si hay **invitación enviada a su email**, o (b) **elegir un place del directorio**.

**3. La saga tiene dos modos** (ADR-0005 §2 + ADR-0006 siguen válidos; `ensureAppUser` hace ambos seguros):

- **Modo place-first (CTA):** unauth → `signUp` → `app_user` → `place`+`ownership`+`membership` (single submit, como ADR-0005 §1).
- **Modo authed (Acceso → "Crear mi place"):** el usuario ya tiene identidad y `app_user` (vía `ensureAppUser` idempotente) → la "saga" se reduce a la **tx de place**+`ownership`+`membership`. No re-pide cuenta.

**4. "Cuenta sin place" pasa a ser estado legítimo e intencional**, no solo resultado de falla parcial o excepción invitación/join. Ajusta el wording de ADR-0005 §4: la vía "Acceso" produce a propósito una cuenta antes de tener place, y desde ahí el usuario elige crear o unirse.

**5. Alcance en la tanda de registro:**

- **En alcance:** el form de login (login + signup account-first) y el modo authed de creación de place (reutilizar pasos sin el de cuenta).
- **Diferido (no en esta tanda):** la rama "Unirme" — la UI de aceptación de invitación ya se difirió a sesión propia post-tanda (decisión de sesión 2026-05-16); el **directorio no existe** (no hay places aún) → "elegir un place del directorio" es feature **futura**. En la tanda, "Unirme" puede mostrarse deshabilitado/"próximamente" o no mostrarse — a confirmar (§Zonas a confirmar).

## Zonas a confirmar (sub-puntos abiertos — decide el humano antes de implementar esas partes)

1. **Lookup de invitaciones por email del usuario.** "Ver si hay invitación enviada a su email" es un **acceso nuevo** no cubierto por el diseño cerrado de invitación (que era solo por token-capability vía link, ADR-0005 §4 / `multi-tenancy.md`). La RLS sobre `invitation` es owner-only; un invitado **no** puede `SELECT` sus invitaciones bajo su rol. Opciones: (a) **Server Action privilegiado** que liste invitaciones donde `invitation.email = email verificado del usuario actual` (recomendado: no amplía la RLS, valida el match server-side, coherente con la vía privilegiada ya diseñada); (b) policy RLS que permita `SELECT` en `invitation` cuando `email` = email del usuario (amplía superficie). **Recomendación: (a).** A confirmar; además, ¿requiere email verificado para listar? (recomendado: sí).
2. **Directorio.** No existe (no hay places). Confirmar que la rama "Unirme → elegir del directorio" queda **fuera de la tanda** y que "Unirme" en la tanda solo contempla (si algo) el camino de invitación-por-email diferido. ¿Se muestra "Unirme" deshabilitado/"próximamente" o se oculta hasta que exista directorio + UI de invitación?

## Alternativas rechazadas

- **Un único flujo (solo ADR-0005 §1).** El owner quiere explícitamente una vía de acceso/login separada con signup account-first y elección posterior. Rechazada por requisito de producto.
- **"Acceso" reusando el wizard place-first tal cual.** Pediría cuenta al final otra vez o duplicaría pasos; el modo authed evita re-pedir cuenta. Rechazada.
- **Resolver acá el lookup de invitaciones por email.** Es un acceso nuevo que toca la RLS recién cerrada; improvisarlo viola "no decidir arquitectura en caliente". Se deja como sub-punto a confirmar.

## Consecuencias

- `docs/features/onboarding/`: la spec y el plan de sesiones se re-sincronizan con las dos vías + el modo authed de la saga + lo diferido (tras confirmar los 2 sub-puntos).
- `landingpage/README.md` decisión 3b: se refina (CTA → crear; nuevo "Acceso" → login form; la bifurcación crear/unirse vive **después** del signup en la vía Acceso, no en `/login` genérico). El menú de la landing suma un item "Acceso" (la landing ya está construida → cambio de implementación futuro, anotado).
- `architecture.md` § Onboarding: documentar los dos modos de la saga.
- `data-model.md`: "cuenta sin place" es estado legítimo (no solo excepción).
- No cambia ADR-0006 (RLS/rol/JWT) ni la cookie apex; el modo authed sigue usando `ensureAppUser` + saga reducida.

## Detalle operativo canónico

- Flujo, modos de saga y alcance: `docs/features/onboarding/` (README + plan-sesiones), tras re-sync.
- Saga base e identidad: ADR-0005, ADR-0006.
- RLS e invitación (y el sub-punto 1 cuando se cierre): `docs/multi-tenancy.md` § RLS / RLS e invitaciones.
- Landing: `docs/landingpage/README.md`.
