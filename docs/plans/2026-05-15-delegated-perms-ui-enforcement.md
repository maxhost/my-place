# Plan — Permisos delegados alcanzables por UI (Hallazgo #1)

**Fecha**: 2026-05-15
**Estado**: APROBADO 2026-05-15 — se ejecuta DESPUÉS de Plan A
(seguridad primero). S4 (gate `/settings`) INCLUIDA por decisión del
owner.
**Severidad**: media-alta funcional. NO es escalada de privilegio (el
server bloquea bien). Es lo inverso: capacidades que el owner delega a
grupos custom son **invisibles/inalcanzables** por la UI normal.

## Contexto

El port G.3 (2026-05-09) cableó las server actions de moderación con
`hasPermission(actorId, placeId, permission)` — correcto y completo
server-side. Pero la capa UI sigue gateando visibilidad de controles
con `viewer.isAdmin` (= owner OR miembro del grupo preset
"Administradores"). `isAdmin` **no** equivale a "tiene permiso X" para un
grupo custom no-preset. Resultado: un owner delega `discussions:hide-post`
(o `delete-post`, `delete-comment`, `events:moderate`, `library:edit-item`,
`library:moderate-items`) a un grupo; ese grupo PUEDE ejecutar la acción
(server lo permite) pero NUNCA VE el botón.

**Patrón de referencia correcto (único bien resuelto)**:
`conversations/[postSlug]/edit/page.tsx:57-58` →
`viewer.isAdmin || await hasPermission(viewer.actorId, place.id,
'discussions:edit-post')`. Funciona porque es Server Component con gate
top-level. Se replica este patrón.

`hasPermission` está `React.cache`-wrapped (dedup per-request).
`resolveLibraryViewer` también. `resolveViewerForPlace` no, pero sus
primitives sí (cache-hit). Conclusión de perf: resolver **un objeto
`permissions` una sola vez por page** en el Server Component raíz y
pasarlo por props — auditable, sin awaits dispersos.

## Inventario de puntos a corregir (del diagnóstico)

### Discussions

| archivo:línea                                              | check actual                                      | permiso correcto                                    | SC/CC      |
| ---------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------- | ---------- |
| `_thread-header-actions.tsx:76`                            | `if(viewer.isAdmin)` monta `<PostAdminMenu>`      | `discussions:hide-post` + `discussions:delete-post` | SC         |
| `_thread-header-actions.tsx:69`                            | `...\|\| viewer.isAdmin` (event menu)             | `events:moderate`                                   | SC         |
| `_thread-content.tsx:56`                                   | `if(post.hiddenAt && !viewer.isAdmin) notFound()` | `discussions:hide-post` (data-gate)                 | SC         |
| `_comments-section.tsx:81,90`                              | `viewerIsAdmin`; `includeDeleted:viewerIsAdmin`   | `discussions:delete-comment`                        | SC         |
| `comment-item.tsx:106`                                     | `{viewerIsAdmin ? <CommentAdminMenu/>}`           | `discussions:delete-comment`                        | prop       |
| `comment-thread-live.tsx:44` / `load-more-comments.tsx:28` | propagan `viewerIsAdmin`                          | idem                                                | prop chain |
| `conversations/page.tsx:47`                                | `includeHidden: viewer.isAdmin`                   | `discussions:hide-post` (data-gate)                 | SC         |
| `edit-window-actions.tsx:43`                               | `showEdit = ... && !viewerIsAdmin`                | lógica invertida — revisar con `edit-post` delegado | prop       |

### Eventos

| `_thread-header-actions.tsx:69` | `isEventAuthor \|\| viewer.isAdmin` | `events:moderate` | SC |
| `events/[eventId]/edit/page.tsx:44` | `if(!isAuthor && !viewer.isAdmin) redirect()` | `events:moderate` | SC top-level |

### Biblioteca

| `_library-item-header-actions.tsx:36-39` | `canEditItem/canArchiveItem` (isAdmin+author) | `library:edit-item` / `library:moderate-items` | SC |
| `library/domain/permissions.ts:51,62` | `canEditCategory/canEditItem` puras solo `isAdmin` | `library:moderate-categories` / `edit-item`+`moderate-items` | puras |
| `[itemSlug]/edit/page.tsx:50-51` | `canEditItem; if(!canEdit) notFound()` | `library:edit-item` | SC top-level |
| `_library-item-content.tsx:56` | `if(archivedAt && !canArchiveItem) notFound()` | `library:moderate-items` (data-gate) | SC |
| `library/[categorySlug]/page.tsx:48-52` | `includeArchived: viewer.isAdmin` + archived notFound | `library:moderate-categories` (data-gate) | SC |
| `library/page.tsx:43` | `canManageCategories={viewer.isAdmin}` | `library:moderate-categories` | prop |

**Dependencia separada**: el route group `/settings` (`settings/layout.tsx:41`)
gatea `perms.isAdmin` (preset only). Para que `library:moderate-categories`
delegado sea alcanzable (panels de categoría viven bajo `/settings/library`)
ese gate también debe contemplar el permiso. Se trata como sesión propia
(toca todo `/settings`, scope mayor — decisión del owner si se incluye).

## Decisiones arquitectónicas (fijadas)

| #   | Decisión                                                                                                                                                        | Razón                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Patrón: SC raíz resuelve **objeto `permissions` una vez** y lo pasa por props a los CC                                                                          | `hasPermission` cacheado pero el objeto explícito hace el patrón auditable y evita N awaits dispersos                                                     |
| B   | SC con gate top-level (`events/[id]/edit`, `library/.../[itemSlug]/edit`) → fix directo replicando `conversations/.../edit/page.tsx`                            | Patrón ya probado                                                                                                                                         |
| C   | Library: enriquecer `LibraryViewer` (`server/viewer.ts`) con permisos resueltos, NO componer `hasPermission` en cada call-site                                  | 1 punto de cambio, mantiene boundary de slice, `canEditItem`/`canArchiveItem` puras siguen recibiendo el viewer enriquecido sin cambiar su firma de fondo |
| D   | **Data-gates se corrigen JUNTO con visibility-gates**                                                                                                           | Mostrar el botón sin la data (`includeHidden`/`includeDeleted`/archived gateados por isAdmin) deja la capacidad igual de inalcanzable. Inseparables.      |
| E   | Comments: el flag de permiso viaja **exactamente por la cadena que hoy usa `viewerIsAdmin`** (`_comments-section`→`CommentThread`→`CommentItem`+live+load-more) | Mínimo cambio estructural, sin nueva cadena de props                                                                                                      |
| F   | NO se toca ninguna server action (consolidadas y correctas post-G.3)                                                                                            | El gap es solo UI; el server ya está bien                                                                                                                 |

## Sesiones

### S1 — Discussions (posts + comments + data-gates)

- `_thread-header-actions.tsx`: resolver `{ canHidePost, canDeletePost,
canModerateEvents }` vía `isOwner || hasPermission(...)`; pasar a
  `<PostAdminMenu>` (gate del kebab por permiso, no isAdmin) y
  `showEventMenu`.
- `_thread-content.tsx:56` + `conversations/page.tsx:47`: data-gate
  hidden por `canHidePost` en vez de isAdmin.
- Cadena comments: `_comments-section` resuelve `canDeleteComment` +
  `includeDeleted` por ese permiso; viaja por `CommentThread` →
  `CommentItem` (+ live + load-more) reemplazando/duplicando el flujo de
  `viewerIsAdmin`. `comment-item.tsx:106` gatea `<CommentAdminMenu>` por
  `canDeleteComment`.
- `edit-window-actions.tsx:43`: revisar lógica invertida con `edit-post`
  delegado (grupo no-admin con edit-post vería botón ventana + kebab).
- TDD donde haya tests de estos componentes; typecheck + suite verde.

### S2 — Eventos

- `_thread-header-actions.tsx:69`: `canModerateEvents` (ya resuelto en
  S1 si es el mismo SC — coordinar; el archivo es compartido
  discussions/events).
- `events/[eventId]/edit/page.tsx:44`: gate top-level
  `isAuthor || isOwner || hasPermission('events:moderate')`.

### S3 — Biblioteca

- `library/server/viewer.ts`: enriquecer `LibraryViewer` con
  `canEditItem`/`canArchiveItem`/`canModerateCategories` resueltos
  (decisión C). `library/domain/permissions.ts` usa esos flags.
- `_library-item-header-actions.tsx`, `[itemSlug]/edit/page.tsx`,
  `_library-item-content.tsx:56`, `library/[categorySlug]/page.tsx:48-52`,
  `library/page.tsx:43`: consumir el viewer enriquecido (incluye
  data-gates archived).
- TDD.

### S4 — Dependencia `/settings` + ADR (opcional, decisión del owner)

- `settings/layout.tsx`: contemplar permisos delegables además de
  `perms.isAdmin` para las sub-pages que correspondan (ej.
  `/settings/library` con `library:moderate-categories`). Scope mayor —
  solo si el owner lo quiere en este plan.
- ADR `2026-05-15-delegated-perms-ui.md`: decisiones A–F, patrón de
  referencia, por qué el server ya estaba bien.

## Regla de oro

Cero regresión. NO se tocan server actions (consolidadas). El owner/
preset sigue viendo todo (el OR con `isOwner||isAdmin` se preserva). El
único cambio de comportamiento intencional: grupos custom con permiso
delegado ahora VEN sus controles. Cada sesión: TDD, typecheck + suite
verde, commit aislado, sin refactor no solicitado, sin dividir archivos.

**LOC estimado**: S1 ~220, S2 ~60, S3 ~180, S4 ~150. Total ~610,
4 commits. Ningún archivo supera 300 LOC.
