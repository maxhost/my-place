# 0009 — Cierre de los sub-puntos abiertos de ADR-0008

- **Fecha:** 2026-05-16
- **Estado:** Aceptada
- **Alcance:** producto (vía "Acceso"/unirse), arquitectura (RLS/invitación), feature onboarding
- **Cierra:** los 2 sub-puntos marcados "a confirmar" en ADR-0008 § Zonas a confirmar

Las ADR son registro histórico: no se editan, se reemplazan/cierran con una nueva ADR.

## Contexto

ADR-0008 quedó "Aceptada con 2 sub-puntos abiertos". El owner los resolvió (2026-05-16).

## Decisión

**1. Lookup de invitaciones por email = Server Action privilegiado (no policy RLS).** "Ver si hay invitación enviada a mi email" se resuelve con un **Server Action privilegiado** que lista las invitaciones donde `invitation.email` = el **email verificado** del usuario autenticado. La RLS sobre `invitation` **sigue owner-only** (no se amplía la superficie de `SELECT`); el match por email se valida server-side. Requisito: el usuario debe tener el **email verificado** para listar invitaciones por email (coherente con que `emailVerified` gatea acciones sensibles; evita enumeración por cuentas no verificadas). Coherente con la vía privilegiada de aceptación ya diseñada (ADR-0005 §4, `multi-tenancy.md`).

**2. "Unirme a un place" se muestra deshabilitado / "próximamente"** en la vía Acceso durante esta tanda. Tras el signup account-first se ofrece "Crear mi place" (funcional) y "Unirme" **visible pero inactivo** con indicación de que viene pronto. Razón: comunica el modelo completo sin exponer algo no funcional (el directorio no existe; la UI de aceptación de invitación está diferida a sesión propia). Cuando existan directorio + UI de invitación, "Unirme" se activa.

## Consecuencias

- `multi-tenancy.md` § RLS e invitaciones: se documenta el Server Action privilegiado de lookup por email (además del de aceptación por token) y que requiere email verificado; la RLS de `invitation` queda owner-only sin cambios.
- `docs/features/onboarding/`: el banner de re-sync de ADR-0008 se actualiza — los 2 sub-puntos quedan cerrados; al re-sincronizar la spec, "Unirme" = deshabilitado/"próximamente", y el lookup por email = Server Action privilegiado (email verificado).
- No cambia la RLS base ni ADR-0006. El Server Action privilegiado es análogo al de aceptación: vía controlada server-side, no por el rol del usuario.

## Detalle operativo canónico

- Vías de entrada y modos de saga: ADR-0008 + `docs/features/onboarding/`.
- RLS e invitación (lookup + aceptación): `docs/multi-tenancy.md` § RLS e invitaciones.
