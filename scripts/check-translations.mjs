#!/usr/bin/env node
// Diagnóstico informativo del drift entre catálogos de i18n (ADR-0024, S1.b
// del feature `settings`, 2026-05-21). Reporta keys faltantes/extra de cada
// locale frente al `defaultLocale` (`es.json`) — útil para detectar drift
// cuando se traduce un catálogo (de.json/ca.json hoy son copias literales de
// es.json; el día que se traduzcan in-place, este script seguirá detectando
// keys que se hayan olvidado).
//
// Reglas (ADR-0024 §96, §147, §152):
// 1. **Informativo, NUNCA fail-closed.** `process.exit(0)` siempre, incluso
//    si todos los locales tienen drift. Se invoca manualmente o como step
//    informativo en CI (job `translations` de `.github/workflows/tests.yml`,
//    ADR-0052 que refina ADR-0024 §87) — nunca en el build, nunca fail-fast.
//    El runtime ya tiene la red de seguridad real: deep-merge de
//    `defaultLocale` con `{locale}.json` en `src/i18n/request.ts` — UX nunca
//    renderea una key cruda por ausencia de traducción.
// 2. **Locales sin archivo físico** (`en/fr/pt` al momento de S1.b) se
//    reportan como `file missing — degrades to default at runtime`. No es un
//    error: es el comportamiento deliberado del try/catch defensivo en
//    `request.ts` (ADR-0024 §38 prefer-degrade > fail-loud).
// 3. **Comparación recursiva por path de hoja.** Recorre el árbol JSON y
//    extrae los paths terminales (ej. `crear.titulo`, `wizard.steps.style`).
//    Cualquier divergencia estructural (objeto en uno, hoja en otro, en el
//    mismo path) cuenta como "missing en uno + extra en el otro" — drift
//    semántico, no detalle.
// 4. **Sin dependencias de runtime.** Node ESM puro (`.mjs`), `fs`+`path`
//    sólo. NO importa de `src/shared/lib/deep-merge.ts` (es código TS dentro
//    del bundle de Next; este script vive aparte). El recorrido de paths es
//    una utilidad local, ~10 LOC.
//
// Uso: `node scripts/check-translations.mjs` desde la raíz del repo.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Locales operativos (ADR-0022, ADR-0024) — duplicado intencional del array
// de `src/i18n/routing.ts:13`. Si se agrega un locale a `routing.ts`, agregar
// acá también. La duplicación es deliberada (el script es Node ESM puro y
// `routing.ts` es código TS de Next — la frontera evita meter un bundler
// transitivo en `scripts/`).
const LOCALES = ["es", "en", "fr", "pt", "de", "ca"];
const DEFAULT_LOCALE = "es";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = join(__dirname, "..", "src", "i18n", "messages");

/**
 * Recorre un objeto JSON y emite los paths de las hojas (no-objeto) en
 * notación dot. Arrays cuentan como hoja (su contenido no se compara key por
 * key — el caso no aparece en los catálogos hoy, los valores son strings).
 *
 * @example
 *   collectLeafPaths({ a: { b: "x", c: "y" }, d: "z" })
 *   // → ["a.b", "a.c", "d"]
 */
function collectLeafPaths(value, prefix, out) {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const key of Object.keys(value)) {
      const next = prefix === "" ? key : `${prefix}.${key}`;
      collectLeafPaths(value[key], next, out);
    }
  } else {
    out.push(prefix);
  }
  return out;
}

function loadJson(locale) {
  const filepath = join(MESSAGES_DIR, `${locale}.json`);
  if (!existsSync(filepath)) {
    return { exists: false, filepath };
  }
  try {
    const raw = readFileSync(filepath, "utf8");
    return { exists: true, filepath, json: JSON.parse(raw) };
  } catch (err) {
    return { exists: true, filepath, parseError: err.message };
  }
}

const reference = loadJson(DEFAULT_LOCALE);
if (!reference.exists || reference.parseError) {
  console.error(
    `[check-translations] FATAL: defaultLocale "${DEFAULT_LOCALE}.json" no se pudo cargar (${reference.parseError ?? "missing"}). Aborto sin comparar.`,
  );
  // Aún así exit 0 — el script es informativo. Si el default no carga, es un
  // problema mucho más grave que este script no resuelve (el build mismo
  // fallaría al `import(./messages/${defaultLocale}.json)` en request.ts).
  process.exit(0);
}

const referencePaths = collectLeafPaths(reference.json, "", []);
const referenceSet = new Set(referencePaths);

console.log(
  `[check-translations] ${DEFAULT_LOCALE}.json: reference (${referencePaths.length} keys total)`,
);

for (const locale of LOCALES) {
  if (locale === DEFAULT_LOCALE) continue;

  const result = loadJson(locale);
  if (!result.exists) {
    console.log(
      `[check-translations] ${locale}.json: file missing — degrades to default at runtime (ADR-0024)`,
    );
    continue;
  }
  if (result.parseError) {
    console.log(
      `[check-translations] ${locale}.json: parse error — ${result.parseError}`,
    );
    continue;
  }

  const localePaths = collectLeafPaths(result.json, "", []);
  const localeSet = new Set(localePaths);

  const missing = referencePaths.filter((p) => !localeSet.has(p));
  const extras = localePaths.filter((p) => !referenceSet.has(p));

  console.log(
    `[check-translations] ${locale}.json: ${missing.length} keys missing, ${extras.length} extras`,
  );
  if (missing.length > 0) {
    for (const p of missing) console.log(`  - missing: ${p}`);
  }
  if (extras.length > 0) {
    for (const p of extras) console.log(`  + extra:   ${p}`);
  }
}

process.exit(0);
