# `getTranslations({locale})` override desde page sin `[locale]` en URL

> Verificado empíricamente 2026-05-21 (smoke S1.5 del feature `settings`, dev local sobre `:3000` con `Host: test.localhost:3000`, Next 16.2.6 / next-intl 4.12.0).

## Síntoma anticipado (no observado en producción todavía)

Las pages del árbol `(app)/place/[placeSlug]/...` (zona "place" host-based, `docs/multi-tenancy.md`) NO tienen segment `[locale]` en la URL. El locale activo del place vive en DB (`place.default_locale` — ADR-0022, S2a futura). Una page que renderea ahí (futura `/settings/`, eventual chrome del place) necesita resolver i18n contra ese locale **leído de DB**, no contra el path.

La duda razonable: `next-intl` está pensado primariamente para layouts con `[locale]` segment + middleware que setea `requestLocale` desde el path. ¿Funciona `getTranslations({locale: X})` cuando (a) la URL no tiene `[locale]`, y (b) el middleware `next-intl` ni siquiera corrió para esta request?

El gotcha confuso sería: el código compila, los tests unitarios pasan (request.ts está testeable aislado vía deep-merge), pero el SSR renderea string vacío / crashea con `MISSING_MESSAGE` / arroja `Unable to find next-intl locale`. Sin verificar contra el runtime real de Next + el proxy real, no hay forma de descartar el caso.

## Diagnóstico empírico

En este proyecto el `src/proxy.ts` clasifica hosts en 3 zonas (`marketing | inbox | place`, `src/shared/lib/host-routing.ts`):

- **marketing**: corre `intlMiddleware` → con `localePrefix: "always"` redirige al prefix `/{locale}/...`.
- **inbox**: compone intl + rewrite a `/inbox/{locale}/`.
- **place**: **rewrite plano** a `/place/{slug}{path}` SIN invocar intl middleware.

Esto significa que para cualquier request a `{slug}.place.community/...` (zona place), el `getRequestConfig` de `src/i18n/request.ts` se invoca con `requestLocale` **undefined** — el middleware no setea el header `x-next-intl-locale` que normalmente lo carga. La pregunta empírica: ¿next-intl resuelve el locale activo desde el override de `getTranslations({locale: X})`, o falla porque no hay un locale base que overridear?

**Resultado verificado**: `getTranslations({locale: X, namespace: Y})` funciona perfectamente desde una page sin `[locale]` en URL. El argumento `locale` es el ÚNICO driver — no necesita un `requestLocale` previo. Internamente next-intl invoca el `getRequestConfig` con `requestLocale = Promise<X>` (el override pasado), y todo el pipeline (deep-merge, try/catch defensivo, etc.) corre normal.

## Patrón verificado

Smoke ejecutado: page temporal en `src/app/(app)/place/[placeSlug]/test-locale-override/page.tsx` (borrada al cierre del S1.5) llamando `getTranslations` para 3 locales:

```tsx
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const tDe = await getTranslations({ locale: "de", namespace: "inbox" });
  const tEs = await getTranslations({ locale: "es", namespace: "inbox" });
  const tEn = await getTranslations({ locale: "en", namespace: "inbox" });
  return (
    <main>
      <p>de.viewTitle={tDe("viewTitle")}</p>
      <p>es.viewTitle={tEs("viewTitle")}</p>
      <p>en.viewTitle={tEn("viewTitle")}</p>
    </main>
  );
}
```

Servido via `curl -s -H "Host: test.localhost:3000" http://localhost:3000/test-locale-override` (zona "place" forzada por el `Host` header → proxy rewrite directo a `/place/test/test-locale-override`, sin intl middleware).

**Output observado** (HTTP 200):

```html
<p data-testid="de">de.viewTitle=Tus lugares</p>
<p data-testid="es">es.viewTitle=Tus lugares</p>
<p data-testid="en">en.viewTitle=Tus lugares</p>
```

Las 3 cadenas son "Tus lugares" porque hoy `de.json` es copia byte-exact de `es.json` (S1.a, stub denso per ADR-0024 §94) y `en.json` no existe físicamente → el try/catch defensivo de `src/i18n/request.ts` lo degrada al `defaultLocale` (ADR-0024 §38 prefer-degrade > fail-loud). Las 3 ramas del request config quedaron ejercitadas en un solo smoke:

1. `locale: "de"` → archivo físico presente → deep-merge runtime → 0 keys missing.
2. `locale: "es"` → `locale === routing.defaultLocale` → atajo trivial (return `defaultMessages` sin merge).
3. `locale: "en"` → `import(./messages/en.json)` rechaza con `Cannot find module` → catch → return `defaultMessages`.

## Cómo aplicar el patrón en `/settings/` (S6 futura)

```tsx
// src/app/(app)/place/[placeSlug]/settings/page.tsx (S6 — boceto)
import { getTranslations } from "next-intl/server";
import { loadPlaceBySlug } from "@/features/place/public";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

export default async function SettingsPage({ params }: { params: Promise<{ placeSlug: string }> }) {
  const { placeSlug } = await params;
  const place = await loadPlaceBySlug(/* ... */);
  if (!place) notFound();

  // El locale viene de DB (place.default_locale), NO del path.
  const t = await getTranslations({ locale: place.defaultLocale, namespace: "placeSettings" });

  return <NavPlaceLayout>{t("language.title")}</NavPlaceLayout>;
}
```

Importante: el `<html lang>` también debe ser dinámico (S6 lo aborda en `(app)/place/[placeSlug]/layout.tsx`); el `getTranslations({locale})` resuelve las traducciones, pero el atributo `lang` del documento es responsabilidad del layout.

## Notas

- **El smoke se hizo en zona "place" deliberadamente.** El plan-sesiones.md S1.5 proponía un dummy en `src/app/test-locale-override/page.tsx` (root, sin route-group). En este proyecto eso NO sirve como smoke real: zone "marketing" invoca el `intlMiddleware` que con `localePrefix: "always"` redirige `/test-locale-override` → `/{locale}/test-locale-override` → 404 (no existe esa ruta). El único escenario que replica producción (intl middleware bypassed) es la zona "place" — por eso el dummy vivió bajo `(app)/place/[placeSlug]/` y se accedió con `Host:` header.
- **Page borrada al cierre del S1.5.** El gotcha preserva el código + comando exacto verificado; el commit que cerró S1.5 sólo ships este doc + la línea en `gotchas/README.md`. La página temporal NO queda en el repo para no introducir endpoint zombi en `(app)/place/[placeSlug]/`.
- **Diferenciar override vs degrade.** Hoy las 3 ramas dan el mismo string ("Tus lugares") porque `de.json ≡ es.json` byte a byte (stub) y `en.json` no existe. Cuando `de.json` se traduzca in-place (operación de producto futura), la rama "de" empezará a divergir — y será visible en el HTML. Mientras tanto, `scripts/check-translations.mjs` (S1.b) reporta drift de forma informativa, no fail-closed.
- **El override NO ignora el `requestLocale` del middleware si éste corrió** — solamente prevalece cuando se pasa explícito. Para pages bajo `(marketing)/[locale]/...` donde el middleware sí setea `requestLocale`, llamar `getTranslations()` sin argumentos usa ese valor; pasarle `{locale: X}` lo overridea. No hay collision; son APIs ortogonales.
- **No bloquea S2/S3/S4/S5/S6.** La incógnita arquitectónica de S1.5 está resuelta: el patrón `getTranslations({locale: place.defaultLocale})` desde page sin `[locale]` segment + en zona "place" funciona en el runtime real, no sólo en unit tests.
