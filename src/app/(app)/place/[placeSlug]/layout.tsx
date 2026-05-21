import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { routing } from "@/i18n/routing";
import { getPlaceForZone } from "./_lib/get-place-for-zone";
import "../../../globals.css";

// Layout de la zona Place (multi-root, Next 16 — `docs/multi-tenancy.md`).
// Creado en S5a del Hub junto al restructure del árbol `(app)` (el layout
// común `(app)/layout.tsx` se eliminó: cada sub-grupo provee su `<html>`
// para soportar `lang` propio).
//
// Evolucionado en S6 del feature `settings` (`docs/features/settings/spec.md`
// + ADR-0022): el chrome de la zona-place se renderea en el idioma elegido
// por el owner (`place.default_locale` editable). Para sostener el contract
// `<html lang>` (a11y + SEO + i18n DB-based, ADR-0024), el layout carga el
// place vía el helper privado `getPlaceForZone(slug)` y deriva el `lang` del
// resultado. El helper está memoizado con `React.cache()` para deduplicar
// con la query equivalente del settings page (`/settings/page.tsx`) — 1
// sola lectura de cookie + 1 sola SELECT por request, aunque ambos
// consumidores estén en el mismo árbol.
//
// Fallback `lang="es"`: si el caller no tiene sesión (visitante público a la
// portada placeholder) o no es owner del place (RLS filtra), el helper
// retorna `null`. El layout NO falla — usa el default canónico de
// `routing.defaultLocale` para el `<html lang>`. El page del settings hace
// su propio guard sobre `null` (redirect/notFound según contexto, S6).
//
// Skip-link a11y: paralelo al pattern del marketing
// (`(marketing)/[locale]/layout.tsx`). Target = `#contenido`, presente en el
// `<main>` de las pages de la zona (settings + portada). Localizado con el
// `lang` derivado vía namespace `a11y`.

type Props = {
  children: ReactNode;
  params: Promise<{ placeSlug: string }>;
};

export default async function PlaceLayout({ children, params }: Props) {
  const { placeSlug } = await params;
  const place = await getPlaceForZone(placeSlug);
  const lang = place?.defaultLocale ?? routing.defaultLocale;
  const tA11y = await getTranslations({ locale: lang, namespace: "a11y" });

  return (
    <html lang={lang}>
      <body className="antialiased">
        <a href="#contenido" className="skip-link">
          {tA11y("skipToContent")}
        </a>
        {children}
      </body>
    </html>
  );
}
