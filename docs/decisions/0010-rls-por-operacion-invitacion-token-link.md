# 0010 — RLS por-operación + invitación solo por token-link

- **Fecha:** 2026-05-17
- **Estado:** Aceptada
- **Alcance:** auth (fundamento), multi-tenancy (RLS), producto (invitación), modelo de datos
- **Refina:** ADR-0006 §2 (predicado base → modelo por-operación). **Supersede:** ADR-0009 §1 (lookup de invitaciones por email). **Ajusta:** ADR-0008 (rama "Unirme").

Las ADR son registro histórico: no se editan, se reemplazan/cierran con una nueva ADR.

## Contexto

Al cerrar el diseño de auth/RLS (el punto crítico — si falla, nada de lo que viene sirve), dos puntos se refinaron con el owner:

1. ADR-0006 expresó la RLS base como un único predicado owner (vía `place_ownership`). Eso genera un falso problema de "huevo y gallina" al **crear** un place (la fila de ownership aún no existe). La resolución correcta no es una función ni un `WITH CHECK` rebuscado: es escribir la RLS **por operación**.
2. El acceso a una invitación es por **el token** (capability que solo llega al email), no por la identidad/email del usuario. Una regla RLS "por email" sería justamente el "traer invitaciones inyectando un email" que se quiere evitar; además agrega fricción de verificación sin sumar seguridad (quien tiene el token ya controla ese inbox).

## Decisión

### 1. RLS por-operación (refina ADR-0006 §2)

Las policies se declaran **por operación**, no una sola para todo:

- **`place` / `membership` / `place_ownership` — INSERT:** permitido a **cualquier usuario autenticado**, con `WITH CHECK` que garantiza que **solo se inserta a sí mismo** como owner/miembro de un place que está creando (no puede crear ownership/membership a nombre de otro ni en place ajeno). Crear tu propio place no toca ninguna fila ajena → no hay huevo-y-gallina, no hace falta función privilegiada.
- **`place` / `membership` / `place_ownership` — SELECT/UPDATE/DELETE:** solo el **owner** del place (predicado vía `place_ownership`, como ADR-0006). El acceso de **miembros** se agrega por-feature, encima, después.
- **`app_user` — todas:** solo la propia fila (`auth.user_id() = auth_user_id`), como ADR-0006.

### 2. Invitación SOLO por token-link

- **`invitation` queda 100% owner-only en RLS** (todas las operaciones). **No** hay policy por email. **No** se requiere email verificado. **No** existe "listar mis invitaciones por email".
- La invitación se accede y acepta **únicamente entrando por su link con token** (`{slug}.place.community/invite/{token}` o `https://{custom-domain}/invite/{token}`). El token (alta entropía, un solo uso) **es** la autorización.
- La validación y aceptación van por una **función de confianza server-side** (`SECURITY DEFINER`, `EXECUTE` solo para `app_system`), porque un secreto no se expresa como regla RLS de identidad y la fila `invitation` es del owner. Pasos:
  1. **Display (solo-lectura):** la función valida el token (existe / no vencido / no usado). Inválido → error amable, **nada en la DB**. Válido → se muestra a qué place lo invitan.
  2. **Aceptar → form de cuenta → Crear:** recién en el submit final, en **una operación atómica**: `ensureAppUser` (crea `app_user` si no existe) → crea `membership` → invalida la invitación (`accepted_at` NULL→now() con **test-and-set**: solo si seguía NULL).
- **Una sola vez / carrera:** el test-and-set atómico del `accepted_at` (UPDATE … WHERE `accepted_at IS NULL` RETURNING) hace el token de un solo uso y resuelve dos aceptaciones simultáneas. `UNIQUE(user_id, place_id)` respalda contra doble membership. Re-validar token al mostrar **y** al crear (cubre vencimiento entre medio).
- **Email match:** el email de la cuenta creada debe ser el de `invitation.email` (estricto, ADR-0008) — se prefija/bloquea en el form de aceptación. (Detalle de la UI de aceptación, diferida a sesión propia.)

### 3. Ajuste a ADR-0008 (rama "Unirme")

Se **elimina** el sub-flujo "Acceso → Unirme → ver si hay invitación enviada a mi email" (requería acceso por email, incompatible con §2). En la vía "Acceso", tras el signup account-first: **"Crear mi place"** (funcional) y **"Unirme"** = únicamente **directorio**, que no existe → se muestra **deshabilitado/"próximamente"** (consistente con ADR-0009 §2). Las invitaciones NO se acceden desde el menú "Acceso": se entra por el link del email.

## Alternativas rechazadas

- **Predicado RLS único (ADR-0006 tal cual) para todas las operaciones.** Genera el falso huevo-y-gallina al crear place. Rechazada; se refina a por-operación.
- **Policy RLS de `invitation` por email del usuario** (ADR-0009 §1) y/o **requerir email verificado.** Es el "traer por email" a evitar; fricción sin seguridad real (el token ya prueba acceso al inbox). Rechazada/superseded.
- **Server Action que lista invitaciones por email** (ADR-0009 §1). Sin "listar mis invitaciones", innecesario. Superseded.
- **Función "todo-en-uno" enorme.** Acotada a validar token + crear (ensureAppUser+membership) + test-and-set; mínima y auditable.

## Consecuencias

- `multi-tenancy.md` § RLS / RLS e invitaciones: reescribir a modelo por-operación + invitación token-link; eliminar el bullet de "lookup por email".
- `docs/features/onboarding/`: §5 (RLS por-operación), §6 (invitación token-link, sin email lookup, sin verified-email), banner ADR-0008/0009 → cerrado por ADR-0010; "Unirme" = solo directorio futuro (deshabilitado).
- ADR-0006 sigue válido salvo que su predicado base se lee **por operación** (esta ADR es la canónica de cómo).
- No cambia el modelo rol/JWT, la cookie apex, ni `ensureAppUser`.

## Detalle operativo canónico

- RLS por-operación, invitación, rol/JWT: `docs/multi-tenancy.md` § RLS.
- Flujo de onboarding/invitación: `docs/features/onboarding/`.
- Base de identidad/RLS: ADR-0006. Vías de entrada: ADR-0008.
