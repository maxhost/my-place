# `revalidatePath` necesita el prefijo literal `/place/` — `/${placeSlug}/...` es no-op silencioso

**Detectado:** 2026-06-11 (review production-grade pre-pivot). **Fix:** sesión S1 post-review.

## Síntoma

Una Server Action muta datos, retorna `{ok: true}`, no hay error en ningún lado — pero la invalidación de cache nunca ocurre. El string `revalidatePath(\`/${placeSlug}/settings/members\`)` no matchea ninguna ruta del file-system routing, y Next **no avisa**: invalidar un path inexistente es silencioso. El síntoma queda enmascarado además porque las pages afectadas son `force-dynamic` (el SSR roundtrip refresca igual), así que el bug solo se manifestaría al introducir caching estático/ISR — mordería justo cuando empecemos con las páginas públicas del pivot.

## Causa

Las rutas de la zona place viven en `src/app/(app)/place/[placeSlug]/...`. El route group `(app)` se elide del path, pero **`place` es un segmento literal**: el path interno real es `/place/{slug}/settings/members`. El canon viejo (`/${placeSlug}/...`, de cuando la estructura era `src/app/[placeSlug]/...` pre-reset) sobrevivió en 7 actions (invitations ×2, members, place-ownership-actions ×3, member-profile) y hasta en comentarios que lo afirmaban como regla, mientras las actions hermanas (place-settings, custom-domain) ya usaban el prefijo correcto.

## Regla

- URLs para el **browser** (`<a href>`, `router.push`, `redirect`): sin slug — el place va en el subdominio (`/settings/members`).
- Keys para **`revalidatePath`**: path interno del file-system routing — `/place/${placeSlug}/settings/members`.
- Grep de guardia antes de commit: `revalidatePath(\`/\${` — todo hit que no empiece con `/place/` es bug.

Callsite canónico a imitar: `src/features/place-settings/actions/update-default-locale.ts`.
