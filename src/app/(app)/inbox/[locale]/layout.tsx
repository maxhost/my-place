import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { type Locale, routing } from "@/i18n/routing";
import "../../../globals.css";

// Layout del Hub (S5a del Hub V1, `docs/features/inbox/spec.md` §"Estructura
// de routes"). Multi-root: la zona `(app)` provee su `<html>` por sub-grupo
// (Next 16, `docs/multi-tenancy.md`); el de la zona Hub vive acá. El i18n
// del Hub está en la URL — path prefix obligatorio (`/{locale}/...`) →
// `lang` dinámico del segmento `[locale]`. El `NavHubLayout` (topbar +
// sidebar) lo monta el page del Hub (S5b); este layout sólo establece el
// documento HTML + valida el locale.

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function InboxLocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  // Habilita render estático del árbol Hub (sin esto el SSG se rompe en
  // prod, no en dev — trampa #1 del README de next-intl).
  setRequestLocale(locale as Locale);

  return (
    <html lang={locale}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
