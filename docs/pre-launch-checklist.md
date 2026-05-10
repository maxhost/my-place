# Pre-launch checklist

Cosas que están en el repo a propósito **durante MVP / pre-launch** y que tienen que limpiarse antes del lanzamiento público (production final, abrir registro, etc.).

Cada entry: qué es, dónde vive, por qué se dejó, cómo revertirlo.

## Cómo usar este doc

- Antes de lanzar a prod final: leer entera, revertir cada item documentado, marcar como "removido" abajo (o borrar la entry).
- Cuando agregás algo "DEBUG TEMPORAL" o equivalente en una sesión: sumar entry acá con la fecha + commit + paths.
- El comentario en código debe linkear a este doc: `// DEBUG TEMPORAL — ver docs/pre-launch-checklist.md`.

## Pendientes

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

(otros items futuros van acá con su propio header `### Título — fecha`)
