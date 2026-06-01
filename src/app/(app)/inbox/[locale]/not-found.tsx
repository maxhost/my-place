import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";

// 404 de la zona Hub (S5a del Hub V1, `docs/features/inbox/spec.md`
// §"Estructura de routes"). Lo dispara Next cuando el segmento `[locale]`
// no es un locale válido (`routing.locales.includes` falla en el layout) o
// cuando una sub-vista futura del Hub no existe (`/dms`, `/actividad`).
//
// i18n (Phase 2.G, 2026-05-31): copy desde el namespace `inbox.notFound`
// resuelto contra `routing.defaultLocale`, NO contra el segmento `[locale]`.
// Razón: `not-found.tsx` no recibe `params` (contract App Router) y el trigger
// dominante es justamente un `[locale]` inválido — confiar en él rebotaría a
// una key cruda. Mismo patrón que el sibling `(marketing)/[locale]/
// not-found.tsx`. Trade-off conocido: un 404 con locale válido (sub-vista
// inexistente) igual renderea en `es`; aceptable para una pantalla de error de
// borde y consistente con el sibling. Sin dependencia del slice landing —
// aislamiento `(app)`.
export default async function InboxNotFound() {
  const t = await getTranslations({
    locale: routing.defaultLocale,
    namespace: "inbox.notFound",
  });

  return (
    <main
      id="contenido"
      className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
    >
      <h1 className="text-4xl text-ink">{t("title")}</h1>
      <p className="mt-4 max-w-md leading-relaxed text-muted">{t("body")}</p>
      <a
        href="https://place.community"
        className="cta mt-8 inline-flex min-h-[3rem] items-center justify-center rounded-lg px-7 text-base font-medium"
      >
        {t("cta")}
      </a>
    </main>
  );
}
