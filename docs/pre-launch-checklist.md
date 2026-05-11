# Pre-launch checklist

Cosas que están en el repo a propósito **durante MVP / pre-launch** y que tienen que limpiarse antes del lanzamiento público (production final, abrir registro, etc.).

Cada entry: qué es, dónde vive, por qué se dejó, cómo revertirlo.

## Cómo usar este doc

- Antes de lanzar a prod final: leer entera, revertir cada item documentado, marcar como "removido" abajo (o borrar la entry).
- Cuando agregás algo "DEBUG TEMPORAL" o equivalente en una sesión: sumar entry acá con la fecha + commit + paths.
- El comentario en código debe linkear a este doc: `// DEBUG TEMPORAL — ver docs/pre-launch-checklist.md`.

## Pendientes

### Sistema de diagnóstico DiagnosticLog (2026-05-10)

**Origen:** sesión de hoy. Sistema de logging estructurado a tabla `DiagnosticLog` (Supabase) para debuggear flow auth (callbacks PKCE/invite, logout, getSession failures, 4xx). Reemplaza logs Pino transitorios — los entries persisten en DB y se queryean via MCP.

**Por qué se dejó:** debugging de bugs auth que aparecen solo bajo condiciones reales (mobile, cookies cross-subdomain residuales, race conditions con magic link). Pino → Vercel Logs tiene retention limitada y filtros por window de tiempo; DiagnosticLog persiste indefinidamente y permite queries por traceId/event/userId.

**Archivos a tocar (revertir):**

1. **Borrar directorio completo** `src/shared/lib/diag/`

   ```bash
   rm -rf src/shared/lib/diag/
   ```

2. **Borrar tabla `DiagnosticLog` en Supabase** via MCP:

   ```sql
   DROP TABLE IF EXISTS "DiagnosticLog";
   ```

   Y crear migration `prisma/migrations/<fecha>_drop_diagnostic_log/migration.sql` con la misma sentencia para mantener history sincronizada.

3. **Quitar el modelo `DiagnosticLog`** de `prisma/schema.prisma` (al final del archivo, claramente marcado como "TEMPORAL — Diagnóstico del flow de autenticación").

4. **Regenerar Prisma client:** `pnpm prisma generate`.

5. **Quitar todas las llamadas a `logDiag(...)`**:

   ```bash
   grep -rln 'logDiag\|diag/public' src/
   # Esperado en este momento:
   #   src/app/auth/callback/route.ts
   #   src/app/auth/invite-callback/route.ts
   #   src/app/logout/actions.ts
   #   src/shared/lib/auth-user.ts
   ```

   En cada archivo: borrar el `import { ... } from '@/shared/lib/diag/public'` y todas las llamadas `logDiag(...)`. Mantener los `log.info/warn/error` de Pino que siguen siendo útiles como observabilidad mínima.

6. **Borrar la migration local** `prisma/migrations/20260510020000_diagnostic_log/migration.sql` (opcional — no afecta el comportamiento si ya se aplicó).

**Cómo encontrar todos los callsites:**

```bash
grep -rln 'logDiag\|diag/public\|DiagnosticLog' src/ prisma/
```

Después del cleanup, este grep retorna 0.

**Test post-revert:** `pnpm typecheck` + `pnpm vitest run` deben quedar verdes. Cero comportamiento del producto cambia — solo se quita instrumentación de DB.

---

### Instrumentación de diagnóstico — error en /conversations (2026-05-09)

**Origen:** commit `7c329f4` (`chore(debug): instrumentar conversations + global error listener + smtp resend doc`).

**Por qué se dejó:** el bug de `cannot add presence callbacks ... after subscribe()` se identificó y fixeó en commit `1bba053`, pero los logs se mantienen a pedido del owner mientras el producto está en pre-launch — sirven como red de seguridad para diagnóstico inmediato si aparece OTRO síntoma client-side similar (throws masked por Next 15 en prod, runtime logs de Vercel vacíos por throws client).

**Archivos a tocar (revertir):**

1. **`src/app/layout.tsx`**
   - Quitar `import { GlobalErrorListener } from '@/shared/lib/diagnostics/global-error-listener-client'`.
   - Quitar `<GlobalErrorListener />` del `<body>`.
   - **Mantener** el `import '@/shared/config/zod-runtime'` y el `<ZodRuntime />` — son el fix real de CSP/Zod, NO debug.

2. **`src/shared/lib/diagnostics/global-error-listener-client.tsx`** — **borrar el archivo completo**. El directorio `diagnostics/` queda vacío, considerar borrar también.

3. **`src/shared/config/zod-runtime.ts`**
   - Quitar el bloque `if (typeof console !== 'undefined') { console.log('[zod-runtime] jitless bootstrapped', ...) }` (DEBUG TEMPORAL).
   - **Mantener** el `z.config({ jitless: true })` — es el fix real.

4. **`src/app/[placeSlug]/(gated)/conversations/error.tsx`**
   - Volver al `useEffect` minimal que sólo loguea `error.message + digest + stack + name` (versión del commit `a994f24`).
   - Quitar el `console.group`, el `Object.fromEntries(Object.entries(error))`, el `context: { url, timestamp, userAgent }`.
   - **Mantener** el render del `digest` y `message` en la UI — es observabilidad mínima útil para usuarios reportando bugs (también está en el commit `a994f24` original).

5. **`src/app/[placeSlug]/(gated)/conversations/[postSlug]/page.tsx`**
   - Quitar los `.catch(...)` con `logger.error` alrededor de `loadPlaceBySlug` y `findPostBySlug` — vuelven a ser `await` directos.
   - Quitar el `import { logger } from '@/shared/lib/logger'` si no queda otro uso.

6. **`src/app/[placeSlug]/(gated)/conversations/[postSlug]/_thread-content.tsx`**
   - Inline el `renderThreadContent` de vuelta dentro de `ThreadContent`, removiendo el wrapper try/catch + `logger.error`.
   - El `getEvent(...).catch(...)` interno **se mantiene** — eso es manejo de error legítimo, no debug.

7. **`src/app/[placeSlug]/(gated)/conversations/[postSlug]/_comments-section.tsx`** — mismo patrón: inline `renderCommentsSection` de vuelta, quitar try/catch + logger.

8. **`src/app/[placeSlug]/(gated)/conversations/[postSlug]/_thread-header-actions.tsx`** — mismo: inline `renderThreadHeaderActions`, quitar wrapper.

**Cómo encontrar todos:** `grep -rn "DEBUG TEMPORAL" src/` debería devolver 0 entradas después de la limpieza (ahora devuelve ~7 bullets).

**Test post-revert:** `pnpm typecheck` + `pnpm test` deben quedar verdes. Ningún funcionalidad cambia — sólo se quita instrumentación.

---

### Smoke check exhaustivo G.3 atomic permissions (2026-05-09)

**Origen:** plan G.3 port `docs/plans/2026-05-09-g3-debt-port-to-legacy.md` § 4. El port se completó (commits `860e15a` + `dd42afc` + `875b14b`) pero el smoke manual exhaustivo NO se ejecutó por costo (setup en producción + 3 users de prueba con grupos custom).

**Por qué se dejó:** la pre-flight via MCP supabase confirmó que la deuda es PREVENTIVA, no activa: `SELECT COUNT(*) FROM "PermissionGroup" WHERE "isPreset" = false AND array_length(permissions, 1) > 0` retornó 2 (ambos del seed E2E `place_e2e_palermo`, ningún owner real había creado un grupo custom delegado todavía). El port cierra el agujero antes de que aparezca un caso de uso real.

**Cuándo hacer el smoke:**

- **Antes del lanzamiento público** (más probable cierre).
- **Antes del primer owner real que cree un grupo custom delegado** (event-driven — query MCP periódica para detectar `COUNT > 2`).

**Checklist (de `docs/plans/2026-05-09-g3-debt-port-to-legacy.md` § 4):**

1. **Setup:** crear 3 grupos custom + 3 users de prueba (User-A → "Moderadores Discusiones", User-B → "Moderadores Library" scopeado a 1 categoría, User-C → "Mod Eventos + Flags"). Asignar permisos atómicos correspondientes. NO asignar al preset "Administradores" — el smoke valida que el custom group basta.
2. **Owner (control)**: hide/delete posts y comments ajenos, edit posts ajenos (con `discussions:edit-post`), update/cancel eventos ajenos, review flags, archive/update categorías → todo OK.
3. **User-A** (custom moderation discusiones): hide/unhide post ajeno OK, delete post ajeno OK, delete comment ajeno OK, edit post ajeno OK (G.3-aligned con override ADR §2), update evento ajeno → 403, review flag → 403.
4. **User-B** (custom moderation library, scoped): archive categoría scopeada OK, archive categoría no scopeada → 403, update categoría scopeada OK, edit item ajeno en categoría scopeada OK (`library:edit-item` nuevo), edit item en categoría no scopeada → 403.
5. **User-C** (eventos + flags): update/cancel evento ajeno OK, review flag OK, hide post → 403, archive categoría → 403.
6. **Audit logs**: verificar que `pino` log de `postDeleted`/`postHidden` registra `actorId: user-X` y `byAdmin: true` cuando el moderador es custom group (no solo owner/preset).
7. **RLS sanity**: cero 500 por RLS en preview al hacer las acciones de B/C/D.

**Criterio pass/fail:**

- **Pass**: todos los items verdes. Cierre del item.
- **Fail**: cualquier ítem CRÍTICO falla → identificar la sub-fase responsable (A1-A6 o A0) y revertir vía `git revert <hash>` ese commit puntual.

**Comandos útiles para el setup:**

```bash
# Verificar status actual de grupos custom delegados antes de lanzamiento
pnpm dotenv -e .env.local -- node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DIRECT_URL });
(async () => {
  const r = await pool.query(\`SELECT COUNT(*)::int AS n FROM \\\"PermissionGroup\\\" WHERE \\\"isPreset\\\" = false AND array_length(permissions, 1) > 0\`);
  console.log('Custom groups con permisos delegados:', r.rows[0].n);
  await pool.end();
})();
"
```

Si COUNT > 2 (más allá del seed E2E), priorizar el smoke porque hay users reales potencialmente afectados.

---

### Smoke test del flow auth post-deploy (2026-05-10)

**Origen:** ADR `docs/decisions/2026-05-10-auth-callbacks-on-apex.md` — refactor de `/auth/callback` y `/auth/invite-callback` para correr en apex + host-aware redirect post-callback + cookie cleanup defensivo (commits `7189f80`, `8b9a2ba`).

**Cuándo:** correr **una vez después del deploy de S2** (`8b9a2ba`) para confirmar que ambos flows están green en prod.

**Checklist:**

1. **Invite flow (browser nuevo / incógnito):** admin envía invite desde `/settings/access` a un email externo → user click email → debe llegar a `/invite/accept/<tok>` autenticado (sin pasar por `/login`). Click "Aceptar" → `acceptedAt` se llena en `Invitation` (verificable via `mcp__supabase-place__execute_sql`).

2. **Login magic link (browser nuevo / incógnito):** user existente va a `app.<apex>/login` → tipea email → recibe magic link → click → llega al destino (`/inbox` o el path original que disparó el gate) autenticado.

3. **Cookie cleanup defensivo (browser con sesión vieja):** user con sesión pre-2026-05-10 (cookies `Domain=app.place.community`) hace logout y login de nuevo → debería loguearse OK; verificar en DevTools que las cookies viejas se limpiaron y solo queda `sb-*-auth-token; Domain=place.community`.

4. **Logs Supabase + Vercel:**
   - `mcp__supabase-place__get_logs auth` muestra `Login` event + `auth.sessions` row created en el momento del flow.
   - Vercel runtime logs: `invite_callback_success` o `callback_success` (level info), seguido del request al destino con sesión válida (no más `307 → /login`).

**Pass/Fail:**

- **Pass**: ambos flows verde + cookie cleanup confirmado → cierre del item, no hace falta acción.
- **Fail (cualquier flow rompe)**: investigar con MCPs antes de revertir; el refactor está cubierto por 1953 tests verde + ADR documenta trade-offs. Considerar rollback al commit anterior (`42200e6`) si reproducible.

**Cleanup posterior** (no bloqueante):

- Auditoría de otros consumers de `clientEnv.NEXT_PUBLIC_APP_URL` en el repo que asuman subdomain. Si ningún code path lo necesita en subdomain post-S2, considerar cambiar el env var en Vercel a `https://place.community` (apex) para consistencia.
- E2E test automatizado del invite + login flow (necesita harness de email mock/intercept; no incluido en S1-S3).

---

(otros items futuros van acá con su propio header `### Título — fecha`)
