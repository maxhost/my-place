# 0050 — Slice `member-profile` comprometido a V1.3 (modal de perfil contextual)

- **Fecha:** 2026-06-05
- **Estado:** Aceptada
- **Alcance:** scope/producto (perfil contextual del miembro), arquitectura (cierra el estado huérfano del slice `member-profile`), tech-debt (Phase 3.A — decisión de scope)
- **Refina:** ADR-0042 (extracción del slice — confirma y fija su consumer destino, que la ADR de extracción dejó como "reserva V1.1+"), ADR-0036 §47 (la UI de edición del `headline`, diferida genéricamente a "V1.1+", queda fijada a **V1.3** con mount point explícito)
- **No supersede:** nada. El slice se mantiene intacto; esta ADR sólo resuelve su scope (montar vs parking-lot vs remover) decidido en Phase 3.A.
- **Origen:** Phase 3.A del tracker de tech-debt pre-V1.3 (`docs/tech-debt-pre-v1.3.md` §"Sesión 3.A — Scope decisions").

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

El audit de tech-debt post-V1.2 identificó `src/features/member-profile/` (589 LOC) como **slice huérfano**: expone 1 Server Action (`updateMyHeadlineAction`), 1 Client Component (`<HeadlineEditor />`) y tipos, todo **completamente testeado** (schemas, map-headline-error, headline-editor RTL) y conforme al paradigma vertical-slice (ESLint ADR-0039), pero `<HeadlineEditor />` **no está montado en producción**.

El no-mount es deliberado y está documentado en `members-page-shell.tsx` § comentario "HeadlineEditor": la spec ubica la edición del headline en el **perfil contextual del miembro** (modal disparado al tappear el propio avatar), NO en `/settings/members`. Las keys i18n `placeMembers.headline.*` ya están en el catálogo esperando el mount. ADR-0036 §47 ya había diferido esa UI a "V1.1+" sin fijar versión ni page concreta.

Phase 3.A obliga a cerrar el estado huérfano con una de tres opciones: (A) comprometer a V1.3 con mount point, (B) parking-lot dormido con ADR, (C) remover el slice. A diferencia de `style-assist` (ADR-0051), `member-profile` **no arrastra ninguna dependencia** — su costo de mantenerse es sólo LOC de un slice aislado y testeado, y es código member-facing con casa designada por la ontología (ADR-0036).

**Decisión del owner (2026-06-05):** Opción A — comprometer a V1.3.

## Decisión

1. **`member-profile/` se compromete a V1.3.** El slice se mantiene intacto (sin tocar código ni tests). Deja de ser "huérfano sin destino" para ser "slice listo, consumer comprometido a V1.3".

2. **Mount point canónico:** modal de **perfil contextual del miembro**, disparado al tappear el **propio avatar** del miembro (consistente con ADR-0036 §"perfil contextual" + el comentario de `members-page-shell.tsx`). NO se monta en `/settings/members` (esa page es curaduría owner→miembros; el headline es self-edit, asimetría que justificó la extracción del slice en ADR-0042).

3. **Phase 3.A NO monta físicamente el componente.** Construir el modal de perfil contextual es una **feature de V1.3**, no una tarea de cierre de tech-debt — requiere diseñar el modal, su trigger desde el avatar, y su ensamblado con la sección de contribuciones acumuladas (el centro de gravedad del perfil, ADR-0036 §40). Esta ADR fija el **compromiso + destino**; la sesión de V1.3 que construya el modal montará `<HeadlineEditor />` como su contenido de edición.

4. **Autorización ya resuelta:** `updateMyHeadlineAction` ya impone `caller.user_id = membership.user_id` (self-edit only, ADR-0036 §45). El mount V1.3 no requiere policy RLS nueva (ADR-0036 §47 lo cubre con autorización app-side + WHERE explícito).

5. **Corrección del header del slice:** `member-profile/public.ts` afirmaba incorrectamente "Consumer principal: page S11 `/settings/members` que monta `<HeadlineEditor />`". Se corrige para reflejar el destino real (modal de perfil contextual, comprometido V1.3 por esta ADR).

## Alternativas rechazadas

- **(B) Parking-lot dormido con ADR.** Declarar el slice dormido recuperable (como `style-assist` hoy) sin comprometer versión. Rechazada: el headline es identidad personal del miembro (ADR-0036), parte del perfil contextual que V1.3 va a construir de todos modos — dejarlo "dormido sin fecha" duplicaría la decisión más adelante. El owner prefiere fijar el compromiso ahora.

- **(C) Remover el slice (`git rm`) + recuperar de git history si V1.3 lo quiere.** Máxima limpieza del repo. Rechazada: descarta código testeado y member-facing con casa designada por la ontología, para ahorrar 589 LOC sin costo de dependencias. El path de recuperación de git history (válido para `style-assist` cuya UI glue ya fue removida) acá significaría reconstruir un slice completo que ya está validado — peor ROI que mantenerlo.

## Consecuencias

- **`member-profile/` deja de ser huérfano** en el inventario de tech-debt: pasa a "slice listo, mount comprometido V1.3".
- **Sin cambio de dependencias** — el slice no arrastra ninguna (a diferencia de ADR-0051).
- **Header de `public.ts` corregido** — el destino documentado ahora coincide con la realidad (modal de perfil contextual, no `/settings/members`).
- **V1.3 hereda una tarea concreta:** construir el modal de perfil contextual y montar `<HeadlineEditor />` como su pane de edición. El slice (action + componente + tests + keys i18n) está 100% listo — la feature V1.3 es el modal contenedor + su trigger, no el editor.
- **ADR-0042 y ADR-0036 NO se editan** (inmutabilidad); esta ADR fija lo que aquéllas dejaron como reserva/diferido.
