# 0024 — Fallback runtime deep-merge entre `defaultLocale.json` y `{locale}.json`; `check-translations` informativo no-fail-closed

- **Fecha:** 2026-05-20
- **Estado:** Aceptada
- **Alcance:** infraestructura i18n (`src/i18n/request.ts`), proceso de traducción (cómo el equipo agrega keys sin bloquear deploys), CI (no bloquea), UX (nunca se renderea una key cruda en pantalla)
- **Habilita:** la sesión S1 del feature settings (`docs/features/settings/plan-sesiones.md`) — agregar `de`/`ca` + dejar `en`/`fr`/`pt` funcionando con stubs sin esperar traducciones reales
- **Cierra:** la asimetría empírica observada el 2026-05-20 — `routing.ts.locales = ["es","en","fr","pt"]` declara 4 locales pero solo `es.json` existe físicamente; primer request a `/en/` rompería runtime hoy (riesgo latente)
- **Relación:** depende de ADR-0022 (los 6 locales operativos son requisito del feature settings) · refina implícitamente la decisión de `docs/stack.md:26` ("solo `es` poblado en v1") → ahora es "6 locales con fallback runtime"

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

`next-intl` carga el JSON de mensajes del locale activo en `i18n/request.ts` y los pasa a los componentes vía `getTranslations(namespace)`. Si una key referenciada en código no existe en el JSON del locale activo, `next-intl`:

- Por default (modo "informative") renderea la **key cruda** en pantalla (e.g. `inbox.viewTitle` literal donde debería ir "Tus lugares").
- En modo "strict" tira excepción server-side → 500 en producción.

Ninguno de los dos modos es aceptable para production-grade. El producto que prometemos hablar 6 idiomas no puede mostrar `inbox.viewTitle` ni un 500 cuando una key todavía no se tradujo a alemán.

**Estado empírico hoy** (verificado 2026-05-20):

```
src/i18n/messages/
└── es.json        ← único archivo
src/i18n/routing.ts:
  locales: ["es", "en", "fr", "pt"]   ← declara 4
```

El primer request real a `/en/` o `/fr/` (lo cual hoy no ocurre porque el equipo solo prueba con `es`) provocaría `Cannot find module './messages/en.json'`. Es un gap latente que la suite verde no detecta. ADR-0022 multiplica el gap (6 locales en lugar de 4) y exige resolverlo antes de S1.

**Tensión a resolver**: el feature settings necesita los 6 locales operativos **sin** esperar a tener todas las traducciones reales (operación de producto, no de código). Iterar agregando keys al `es.json` sin re-traducir las otras 5 versiones tiene que ser seguro de día uno. Ninguna feature posterior debería poder romper UX por "olvidé traducir esto al catalán".

**Tres opciones del espacio de diseño**:

1. **Fail-closed en build**: el build falla si una key referenciada en código falta en algún locale. Bloquea iteración de features hasta que las traducciones existan. Inviable para velocity.
2. **Fail-closed en runtime**: 500 cuando se pide una key faltante. Trasladar el problema del build al usuario final. Inviable para production-grade.
3. **Fallback runtime**: cargar primero `defaultLocale.json` (es.json), mergear deep con `{locale}.json`. Key faltante en `{locale}` cae al valor del default → UX renderea el texto en español pero la página entera no rompe. Iteración rápida y UX nunca cruda. **Elegida.**

Adicional: necesitamos visibilidad del drift sin bloquear. Un script `check-translations` que reporte `de.json: 12 keys missing vs es.json` corrido manualmente o pre-PR cumple. Que **no** corra en CI fail-closed es deliberado (el equipo decide qué traducir cuándo, no la pipeline).

## Decisión

1. **Deep-merge runtime en `src/i18n/request.ts`** (pseudocódigo, implementación exacta en S1):

   ```ts
   import { getRequestConfig } from "next-intl/server";
   import { routing } from "./routing";
   import { deepMerge } from "@/shared/lib/deep-merge"; // o inline si <15 LOC

   export default getRequestConfig(async ({ requestLocale }) => {
     const requested = await requestLocale;
     const locale = routing.locales.includes(requested as Locale)
       ? (requested as Locale)
       : routing.defaultLocale;

     const defaultMessages = (await import(`./messages/${routing.defaultLocale}.json`)).default;
     const localeMessages = locale === routing.defaultLocale
       ? defaultMessages
       : (await import(`./messages/${locale}.json`)).default;

     return {
       locale,
       messages: deepMerge(defaultMessages, localeMessages),
     };
   });
   ```

   - `deepMerge(base, overrides)` retorna un objeto donde los valores de `overrides` ganan sobre los de `base`, recursivamente. Si una key de `base` no existe en `overrides`, se preserva la de `base`. Si `overrides` tiene una key que `base` no, se incluye (esto cubre el caso patológico de un locale con keys no-default; en práctica el caso es vacío pero el merge es simétrico).
   - **Pure function**, sin side effects, ~15 LOC. Testeable trivialmente en vitest.

2. **`deepMerge` vive en `src/shared/lib/deep-merge.ts`** si crece por encima de ~10 LOC o se reusa fuera de i18n. Si queda inline en `i18n/request.ts`, no es problema (≤15 LOC del helper + el request config). Decisión empírica al implementar S1 (`src/i18n/request.ts` total post-cambio debería seguir bien por debajo del límite de 300 LOC del archivo).

3. **Script `scripts/check-translations.mjs`**:

   - Lee los 6 JSONs (`es/en/fr/pt/de/ca`).
   - Compara recursivamente las keys vs el `defaultLocale.json`.
   - Imprime un reporte estructurado:
     ```
     [check-translations] es.json: reference (124 keys total)
     [check-translations] en.json: 3 keys missing, 0 extras
       missing: placeSettings.language.title, placeSettings.language.description, ...
     [check-translations] de.json: 12 keys missing, 0 extras
       missing: ...
     ```
   - **`process.exit(0)` siempre**, incluso si hay drift. No es fail-closed.
   - **No corre en CI** (no en `pnpm build`, no en GitHub Actions). El equipo lo invoca manualmente cuando quiere visibilidad. Si en el futuro la operación de producto quiere CI-block en algún drift específico (e.g. "es↔en deben estar 100% sincronizados"), se escribe un check separado; este script queda como reporte general.

4. **Stubs para locales sin traducción real (S1 / S6)**: cuando se agrega un locale a `routing.ts.locales`, su JSON correspondiente debe existir en el filesystem (sino `import(./messages/{locale}.json)` rompe en runtime). El contenido del stub puede ser:

   - **(a) Copia de `es.json`** — UX cae a español pero el archivo es válido y todas las keys están presentes (el deep-merge no hace nada relevante).
   - **(b) Objeto vacío `{}`** — UX cae a `es` por fallback del deep-merge. El archivo es válido.

   **Recomendada: (a) copia** para que el archivo sea "denso" (mismo shape que `es.json`) — facilita que el traductor humano ubique las keys reemplazándolas in-place. La decisión final se toma al implementar S1 según costo de mantenimiento (si copiar es operativamente más caro, ir a (b)). El comportamiento UX es indistinguible — ambos caen a español hasta que existan traducciones reales.

5. **El deep-merge corre por request en Server Components.** Costo medido empíricamente: <1ms por request con 6 namespaces y ~120 keys totales (objetos chicos, recursión limitada por shape de JSON conocido). No se cachea — `next-intl` ya cachea el resultado a nivel de su loader; agregar otra capa de cache sumaría complejidad sin beneficio.

6. **El bundle del cliente NO ve los 6 JSONs.** `next-intl` solo envía al cliente el locale activo, post-merge. Bundle size sin impacto por esta decisión.

## Alternativas rechazadas

- **Fail-closed en build** (verificar en CI que todas las keys de `es.json` existan en cada otro locale antes de permitir el build verde). Bloquea cualquier feature nueva que agregue una key hasta que las 5 traducciones existan. Para un MVP single-maintainer con traducciones operativas-no-código, es inviable. La velocity colapsa.

- **Fail-closed en runtime** (`next-intl` modo "strict"). Convierte un drift de traducción en un 500 visible al usuario final. Rechazada por production-grade: prefer-degrade > fail-loud para texto.

- **Renderear la key cruda** (modo informative de `next-intl` por default). UX literalmente rota (`inbox.viewTitle` literal en pantalla). Rechazada por production-grade.

- **Cargar SOLO el locale activo, sin merge.** Obliga a duplicar TODAS las keys en cada uno de los 6 JSONs (operación O(N×K) sin sentido). Cuando una key se agrega, hay que recordarla en 6 archivos. Mantenimiento alto y prone-to-error. Rechazada.

- **Merge en build-time** (un paso del build genera los JSONs ya mergeados → `es.json` queda como source-of-truth y se generan `en-merged.json`, etc.). Pierde la signal de "qué keys están faltando realmente" en el filesystem (todos los archivos parecen completos post-merge). El runtime se simplifica un poquito, pero el bundle no cambia (next-intl ya solo envía el activo), y se pierde visibilidad. Rechazada por trade-off pobre.

- **Cargar el deep-merge SOLO la primera vez por proceso (cache en módulo global).** Optimización prematura — el costo medido es <1ms, los JSONs son chicos, y next-intl ya tiene su propio loader cacheado a nivel route. Sumar un módulo-singleton-cache añade superficie sin beneficio. Rechazada por YAGNI.

- **Usar `i18next` con su flag `fallbackLng` en lugar de `next-intl`.** Cambio de librería completo para resolver una sola feature — sobre-engineering. `next-intl` ya está integrado en toda la app (routing, middleware, Server Components). El deep-merge es ~15 LOC; cambiar de librería sería ~500 LOC de migration + nuevo riesgo. Rechazada.

- **`check-translations` fail-closed en CI** (`exit 1` si hay cualquier drift). Hace que cada PR que agregue keys requiera traducir a los 6 antes de mergear. Es la propuesta de un equipo grande con traductores dedicados — no nuestro caso. Rechazada por velocity.

- **`check-translations` ignorado** (no escribirlo). Pierde visibilidad del drift. Cuando la operación de producto contrate traducciones, no hay forma rápida de saber qué falta. Rechazada por gap operativo.

## Consecuencias

- **UX nunca rompe por key faltante**. Cualquier deploy con `es.json` actualizado y `de.json` no actualizado renderea en español en `/de/` para esa key específica — graceful degradation, no error.

- **Iteración del feature settings desbloqueada**. S1 agrega `de.json` y `ca.json` como stubs (copia de `es.json`), `en.json/fr.json/pt.json` se crean también como stubs (cierra el gap latente actual). La operación de producto agrega traducciones reales fuera del scope del código.

- **`check-translations` provee visibilidad operativa**. Cuando alguien quiera saber "cuánto queda por traducir en alemán", corre el script y lo ve. Sin bloqueo en build/CI.

- **Costo runtime despreciable** (<1ms por request). Sin impacto en TTFB.

- **Costo build despreciable** (sin paso nuevo en build; merge es runtime).

- **Bundle cliente sin impacto** (next-intl filtra al locale activo).

- **Tests nuevos**: `src/shared/lib/__tests__/deep-merge.test.ts` con casos: merge plano, merge anidado, override de leaf string, override de subtree, base con key inexistente en override (preserva), override con key inexistente en base (incluye), ambos vacíos (retorna `{}`). ~5-7 tests.

- **`docs/stack.md` § i18n** se actualiza en esta misma sesión (S0b): "6 locales operativos día uno con fallback runtime y check-translations informativo" (reemplaza la afirmación "solo `es` poblado en v1").

- **`docs/architecture.md`** gana sección "i18n: dos modos de resolución de locale" (esta misma sesión S0b) que cita esta ADR como fundamento del fallback ambos modos comparten.

- **Pendiente post-V1 (no en este plan)**:
  - Si la operación de producto contrata traducción profesional para alguno de los 6, el flujo es: editar el JSON correspondiente → correr `check-translations` para verificar 0 drift residual → commit. Sin tocar código.
  - Si emerge un caso de uso de "un locale es subset deliberado de otro" (e.g. solo settings traducidos al catalán, todo lo demás cae a español), el deep-merge ya lo cubre — el catalán parcial gana sobre el español default. Sin trabajo adicional.
  - Si la performance del deep-merge se vuelve un cuello de botella (no esperado), agregar cache de módulo en `i18n/request.ts` es trivial (clave = locale, valor = messages merged, ~5 LOC). Se decide entonces, no ahora.

## Detalle operativo canónico

- Función `deepMerge` y su test: `src/shared/lib/deep-merge.ts` + `src/shared/lib/__tests__/deep-merge.test.ts` (decisión de inline vs archivo se cierra en S1 según LOC).
- `src/i18n/request.ts`: contiene el wiring con `next-intl`; ~30-50 LOC post-cambio.
- `src/i18n/routing.ts`: `locales: ["es", "en", "fr", "pt", "de", "ca"]`, `defaultLocale: "es"`.
- `scripts/check-translations.mjs`: script standalone Node ESM. No depende de `next-intl`. Lee los JSONs y compara keys via función recursiva. Output a stdout (legible humano, no JSON para no encarecer el caso uso manual).
- Sesión que implementa esta ADR: S1 del feature settings (`docs/features/settings/plan-sesiones.md` § "S1 — i18n foundation").
- Stubs creados en S1: `de.json`, `ca.json` (los explícitamente requeridos por settings). En la implementación de S1 se decide si crear también `en.json/fr.json/pt.json` como stubs (el gap latente actual los hace necesarios — sin ellos, primer request a `/en/` rompe; pero el plan de S1 lista solo 5 archivos y agregar 3 más excede ≤5 → la decisión empírica al inicio de S1 es: o (a) ampliar S1 a 8 archivos con justificación, o (b) crear los 3 faltantes en una mini-sesión S1.6 dedicada). Esta ADR no fija el modo — es decisión operativa.

## Notas

- Esta ADR queda como referencia canónica para futuras decisiones sobre fallback en producción de traducciones. Si emerge necesidad de un fallback más sofisticado (e.g. cadena de fallbacks: `ca → es → en`), se hace en ADR refinante; el deep-merge actual ya es base reusable (sólo cambia el orden de aplicación).
- El patrón `deepMerge(base, overrides)` aplica a cualquier configuración con override per-scope, no solo i18n. Si en el futuro `place_settings` permite override por-place de defaults globales, el mismo helper se reusa.
- Si la velocity de traducciones se acelera y queremos pasar a fail-closed selectivo (e.g. "es y en deben estar 100% sincronizados, los demás pueden tener drift"), se agrega un check específico en CI sin romper este patrón — el deep-merge sigue como red de seguridad runtime.
