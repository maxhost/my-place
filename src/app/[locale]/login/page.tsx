import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({
  params,
}: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "login" });
  return { title: `${t("title")} — Place` };
}

// Placeholder: el onboarding / login real es otra feature (plan § Fuera de
// alcance). La landing solo linkea acá.
export default async function LoginPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "login" });

  return (
    <main
      id="contenido"
      className="flex min-h-screen items-center justify-center px-6"
    >
      <div className="max-w-md text-center">
        <h1 className="text-3xl text-ink">{t("title")}</h1>
        <p className="mt-4 leading-relaxed text-muted">{t("body")}</p>
        <a
          href={`/${locale}`}
          className="mt-8 inline-block text-sm text-accent-strong hover:underline"
        >
          {t("back")}
        </a>
      </div>
    </main>
  );
}
