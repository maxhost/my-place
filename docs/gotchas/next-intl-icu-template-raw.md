# next-intl tira `FORMATTING_ERROR` en mensajes con placeholders `{x}` resueltos client-side

> Verificado empíricamente 2026-05-18 (deploy Vercel, `/crear` y `/login`, Next 16.2.6 / next-intl).

## Síntoma

La página renderiza pero la consola se llena de errores como:

```
FORMATTING_ERROR: The intl string context variable "n" was not provided
to the string "Paso {n} de {total}"
    at CrearPage (src/app/(marketing)/[locale]/crear/page.tsx:48:15)
```

> El `file:line:col` arriba es **stack trace literal del runtime Next/next-intl** (evidencia reproducible del error en consola), NO un pointer al codebase como guía. No reemplazar por símbolo en cleanup de "drift-robust refs" (1.F, 2026-05-29) — el ":48:15" es lo que el lector verá en consola si reproduce el bug y debe matchear textualmente.

Uno por cada label que es una plantilla (`progress`, `slugHint`, `terms`, `successBody`). El código "se ve bien" (`t("progress")` es idéntico a `t("title")`, que no falla), por eso desorienta: el problema no es la llamada sino el **contenido** del mensaje.

## Causa

`t(key)` de next-intl **siempre corre el formatter ICU** sobre el mensaje. Si el string tiene un placeholder (`{n}`, `{slug}`, `{terms}`, `{url}`…) y no se le pasan los valores (`t("progress", { n, total })`), ICU aborta con `FORMATTING_ERROR`.

En este proyecto esas plantillas son **deliberadamente** rellenadas client-side, no por next-intl: el wizard hace `labels.progress.replace("{n}", …)`, `slugHint`/`successBody` con `.replace`, y `terms` se parte con `.split(/(\{terms\}|\{privacy\})/)` para intercalar `<a>`. La ruta (Server Component) solo necesita el **string crudo** de la plantilla, no formatearlo — pero `t()` no lo sabe e intenta formatear igual.

No es derivable del código del wizard: ahí el `.replace`/`.split` es correcto. El error nace en la ruta, en cómo se obtiene el label.

## Solución

Para todo mensaje cuyo placeholder se resuelve fuera de next-intl, usar **`t.raw(key)`** (y `w.raw(key)` para otros namespaces), que devuelve el mensaje sin pasar por ICU:

```ts
progress: t.raw("progress"),   // "Paso {n} de {total}" tal cual; el wizard lo rellena
title:    t("title"),          // sin placeholders → t() normal
```

Inventario actual (las 5 plantillas client-side, ver `src/i18n/messages/es.json`): `wizard.progress`, `wizard.slugHint`, `wizard.terms`, `wizard.successBody`, `access.terms`. Cableadas con `.raw` en `crear/page.tsx` y `login/page.tsx`.

**Regla al agregar un label nuevo:** si su valor contiene `{algo}` y lo rellena el cliente (`.replace`/`.split`), la ruta debe leerlo con `.raw`. Si en cambio se formatea con next-intl (se le pasan los valores), usar `t(key, vars)` normal.

## Notas

- No es un bug de next-intl: `t()` formatea por diseño; el contrato correcto es pedir `.raw` cuando uno mismo va a interpolar.
- `next build` **no** lo detecta (es runtime al renderizar la ruta) ni los tests del wizard (reciben `labels` ya como strings via fixture). Se ve solo al ejecutar la ruta real → verificar en preview Vercel, no solo en CI (mismo ethos que el gotcha de cookies `__Secure-`).
- Solo `es.json` está poblado (`src/i18n/request.ts`: todos los locales caen al default); cuando se traduzcan en/fr/pt, las mismas claves deben conservar los placeholders y seguir leyéndose con `.raw`.
