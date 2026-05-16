import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Inter, Fraunces } from "next/font/google";
import { routing, type Locale } from "@/i18n/routing";
import "../globals.css";

// Inter (cuerpo) + Fraunces (titulares), self-hosted vía next/font, subset
// latin, display swap → CLS ~0. Pesos mínimos: Inter 400/500, Fraunces 400.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://place.community";

// SSG: prerender de los 4 locales en build.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "meta" });

  // hreflang por locale + x-default → es + canonical por variante.
  const languages: Record<string, string> = Object.fromEntries(
    routing.locales.map((l) => [l, `${SITE_URL}/${l}`]),
  );
  languages["x-default"] = `${SITE_URL}/${routing.defaultLocale}`;

  return {
    metadataBase: new URL(SITE_URL),
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: `${SITE_URL}/${locale}`,
      languages,
    },
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Habilita el render estático de este árbol (sin esto el SSG se rompe en
  // prod, no en dev — trampa #1 del README).
  setRequestLocale(locale as Locale);

  const t = await getTranslations({ locale, namespace: "a11y" });

  return (
    <html lang={locale}>
      <body className={`${inter.variable} ${fraunces.variable} antialiased`}>
        <a href="#contenido" className="skip-link">
          {t("skipToContent")}
        </a>
        {children}
      </body>
    </html>
  );
}
