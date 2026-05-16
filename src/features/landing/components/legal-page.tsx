import { getLocale, getTranslations } from "next-intl/server";
import { Container } from "./_ui";

// Páginas legales mínimas (Términos, Privacidad). Contenido definitivo se
// redacta antes del lanzamiento público (plan § Fuera de alcance).
export async function LegalPage({ doc }: { doc: "terminos" | "privacidad" }) {
  const locale = await getLocale();
  const t = await getTranslations(`legal.${doc}`);
  const nav = await getTranslations("notFound");

  return (
    <main id="contenido">
      <Container className="max-w-2xl py-20 md:py-28">
        <a
          href={`/${locale}`}
          className="text-sm text-accent-strong hover:underline"
        >
          ← {nav("cta")}
        </a>
        <h1 className="mt-8 text-4xl text-ink">{t("title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("updated")}</p>
        <p className="mt-8 leading-relaxed text-muted">{t("body")}</p>
      </Container>
    </main>
  );
}
