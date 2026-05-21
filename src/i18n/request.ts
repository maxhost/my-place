import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { deepMerge } from "@/shared/lib/deep-merge";
import { routing } from "./routing";

// Carga de mensajes con fallback runtime deep-merge (ADR-0024).
//
// Estrategia:
// 1. Cargar siempre `defaultLocale.json` (es.json) — red de seguridad. Si
//    cualquier key falta en el catálogo del locale activo, el merge la
//    preserva en español; UX nunca renderea una key cruda.
// 2. Si el locale activo es el default, devolver `defaultMessages` directo
//    (sin merge — atajo trivial).
// 3. Si no, intentar `import(./messages/{locale}.json)` y mergear. Si el
//    archivo no existe (ej. `en/fr/pt` no tienen catálogo físico todavía),
//    el try/catch atrapa el `Cannot find module` y degrada a
//    `defaultMessages`. Prefer-degrade > fail-loud (ADR-0024 §38).
//
// El bundle del cliente sólo ve el locale activo post-merge — next-intl
// filtra. Costo runtime medido <1ms (ADR-0024 §96).
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  const defaultMessages = (
    await import(`./messages/${routing.defaultLocale}.json`)
  ).default as Record<string, unknown>;

  if (locale === routing.defaultLocale) {
    return { locale, messages: defaultMessages };
  }

  try {
    const localeMessages = (await import(`./messages/${locale}.json`))
      .default as Record<string, unknown>;
    return {
      locale,
      messages: deepMerge(defaultMessages, localeMessages),
    };
  } catch {
    // Archivo `{locale}.json` no existe físicamente — operación de producto,
    // no de código (ADR-0024). El request entero degrada al defaultLocale
    // silenciosamente. `scripts/check-translations.mjs` (S1.b) reporta el
    // drift cuando se lo invoque manualmente.
    return { locale, messages: defaultMessages };
  }
});
