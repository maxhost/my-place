# Edit-session token: relajar la ventana de 60s desde "save" a "open"

**Fecha:** 2026-04-21
**Milestone:** Fase 5 / C.F.2 (hotfix post C.F)
**Autor:** Max
**Estado:** Implementada (2026-04-21)

## Contexto

El spec §8 invariante 1 exigía que el autor solo pudiera editar un Post/Comment dentro de los **60 segundos desde `createdAt`**, medidos en el momento del save. Intención original: permitir un fix tipográfico inmediato sin abrir una ventana de edición revisionista.

En QA real del C.F el autor reportó el flujo fallando:

1. Publica un Post.
2. A los 50s nota una errata, clickea "Editar".
3. Abre el form y tipea una corrección más larga de lo planeado.
4. Al guardar pasaron 72s. `editPostAction` rechaza con `AuthorizationError`.
5. El form se cierra, se pierde el draft, el autor tiene que copiar/pegar manualmente.

El chequeo es correcto según la regla literal, pero la experiencia castiga al autor que tipea a velocidad humana. La spec se había escrito pensando en "60s para reaccionar", no "60s para terminar de tipear un párrafo".

## Decisión

La ventana de 60s ya no se mide en el save — se mide en **el momento en que se abre el formulario de edición**. Desde ese momento el autor tiene un **grace window de 5 minutos** para enviar el cambio. El sistema implementa esta política con un token firmado, sin sesiones persistentes:

1. **`openPostEditSession` / `openCommentEditSession`** — server actions que:
   - Validan que el actor es el autor (admins del Post obtienen `adminBypass: true` sin token; comments no tienen admin-edit).
   - Validan la ventana de 60s clásica sobre `createdAt` **en el momento de apertura**.
   - Firman un HMAC-SHA256 sobre `${subjectType}|${subjectId}|${userId}|${openedAt}` con `APP_EDIT_SESSION_SECRET`.
   - Devuelven `{ token, openedAt, graceMs: 5 * 60 * 1000 }`.

2. **`editPostAction` / `editCommentAction`** aceptan `session?: { token, openedAt }` en el input:
   - **Sin token (fallback):** se mantiene el chequeo clásico `editWindowOpen(createdAt, now)`. Esto preserva un camino válido para clientes que no pasan session y elimina un flanco de compatibilidad.
   - **Con token:** se verifica firma en tiempo constante (`timingSafeEqual`), que `now - openedAt ≤ 5min` (grace), que `openedAt` no viene del futuro (tolerancia 5s de skew), y que el token cierra sobre `(subjectType, subjectId, userId)` actuales. Si todo pasa, se re-chequea que `openedAt` esté dentro de los 60s desde `createdAt` — garantiza que el token no fue emitido ilegalmente desde otro momento.
   - **Admin edit de Post:** ignora token y session (admin no tiene ventana).

3. **`EditSessionInvalid`** (`AuthorizationError` domain subtype) con `context.reason: 'malformed' | 'bad_signature' | 'expired' | 'future_opened_at' | 'subject_mismatch'` — permite telemetría y UX diferenciada por caso.

4. **Cliente:** al entrar en modo edición, `EditWindowActions.EditForm` y `PostComposer` (edit mode) disparan el `open*` action en `useEffect`. Almacenan `{ token, openedAt }` en state y lo pasan al `edit*Action` al guardar. Si el open falla (autor que llegó past-60s), se muestra feedback y se vuelve a idle. El form se mantiene montado mientras `mode === 'edit'`, incluso si el contador visible llegó a cero — es la sesión lo que autoriza, no el timer del componente.

## Alternativas consideradas

**A — Sesiones persistidas en DB.** Una tabla `EditSession(postId|commentId, userId, openedAt, expiresAt)`. Validar en save buscando la fila. Rechazada: dos queries extra por edit (open+save), cleanup periódico de filas vencidas, y sin ventaja real sobre HMAC — el secret ya se rota si se compromete.

**B — JWT.** Equivalente funcional del token HMAC, pero más peso (JSON de claims + base64) y una dependencia más. Sin beneficio.

**C — Extender la ventana a 5 minutos "flat".** Simple, pero abre la puerta a editar un post publicado hace 4 minutos sin tocarlo, lo cual es exactamente lo que la ventana de 60s quería cerrar (ediciones revisionistas sin el contexto del turno original). Rechazada: pierde la intención de §8.

**D — Elegida.** Token HMAC firmado. Sin DB, stateless, 5min es solo "tiempo de tipeo", no "tiempo para reconsiderar".

## Tradeoffs aceptados

- **El autor puede completar un edit hasta 5min después del publish.** Esto es un aflojamiento real respecto del spec original. Lo aceptamos porque la intención del invariante era UX (fix rápido, no ventana de revisión) y 5min de tipeo cumple la misma función sin penalizar al autor lento.
- **Un admin que roba el token de un autor podría editar en nombre del autor durante el grace.** Mitigación: los tokens no viajan fuera del navegador del autor (nunca se loguean, nunca se serializan en URLs). Si el secret mismo se compromete, cualquiera puede forjar tokens — pero ese es el mismo modelo de amenaza que cualquier HMAC server-side. Rotar `APP_EDIT_SESSION_SECRET` invalida todos los tokens emitidos al instante.
- **Reloj del cliente y del servidor pueden divergir.** `openedAt` se fija server-side al emitir el token, así que no depende del reloj del cliente. Solo entra skew al verificar "no-futuro" — toleramos 5s.

## Operación

- `APP_EDIT_SESSION_SECRET` es opcional en dev (si no está seteado, `openPostEditSession`/`openCommentEditSession` tiran error explícito). **Obligatorio en producción** — `assertProductionMailerConfig` incluye el check.
- Generar con `openssl rand -base64 48`.
- Rotación: cambiar el valor invalida tokens en curso. Los autores que tenían un form abierto reciben `EditSessionInvalid` al guardar; el cliente muestra feedback genérico y vuelve a idle. Aceptable ante una rotación planificada.
- Ningún log incluye el token.

## Referencias

- `src/shared/lib/edit-session-token.ts` — firma, verificación, `EditSessionInvalid`.
- `src/features/discussions/server/actions/posts.ts` — `openPostEditSession`, `editPostAction` con rama `data.session`.
- `src/features/discussions/server/actions/comments.ts` — `openCommentEditSession`, `editCommentAction` idem.
- `src/features/discussions/ui/edit-window-actions.tsx` — `EditForm` abre sesión al montar.
- `src/features/discussions/ui/post-composer.tsx` — edit mode abre sesión en mount.
- `docs/features/discussions/spec.md` §8 invariante 1 — enunciado actualizado.
