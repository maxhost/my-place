import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Container } from "@/features/landing/public";

// not-found.tsx no recibe params; usa el locale por default (v1 solo ES).
export default async function NotFound() {
  const t = await getTranslations({
    locale: routing.defaultLocale,
    namespace: "notFound",
  });

  return (
    <main id="contenido">
      <Container className="flex min-h-[60vh] max-w-xl flex-col items-center justify-center text-center">
        <h1 className="text-4xl text-ink">{t("title")}</h1>
        <p className="mt-4 leading-relaxed text-muted">{t("body")}</p>
        <a
          href={`/${routing.defaultLocale}`}
          className="cta mt-8 inline-flex min-h-[3rem] items-center justify-center rounded-lg px-7 text-base font-medium"
        >
          {t("cta")}
        </a>
      </Container>
    </main>
  );
}
