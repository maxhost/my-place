import { getLocale, getTranslations } from "next-intl/server";
import { Container } from "./_ui";
import { LangSwitcher } from "./lang-switcher";

export async function Footer() {
  const locale = await getLocale();
  const t = await getTranslations("footer");
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border py-16">
      <Container>
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <p className="text-lg font-medium text-ink">{t("rights")}</p>
            <p className="mt-2 max-w-xs leading-relaxed text-muted">
              {t("tagline")}
            </p>
          </div>

          <nav aria-label={t("navTitle")}>
            <p className="text-sm font-medium text-ink">{t("navTitle")}</p>
            <ul className="mt-3 flex flex-col gap-2 text-sm text-muted">
              <li>
                <a href="#como-funciona" className="hover:text-ink">
                  {t("comoFunciona")}
                </a>
              </li>
              <li>
                <a href="#precios" className="hover:text-ink">
                  {t("precios")}
                </a>
              </li>
              <li>
                <a href="#faq" className="hover:text-ink">
                  {t("faq")}
                </a>
              </li>
            </ul>
          </nav>

          <nav aria-label={t("legalTitle")}>
            <p className="text-sm font-medium text-ink">{t("legalTitle")}</p>
            <ul className="mt-3 flex flex-col gap-2 text-sm text-muted">
              <li>
                <a
                  href={`/${locale}/terminos`}
                  className="hover:text-ink"
                >
                  {t("terminos")}
                </a>
              </li>
              <li>
                <a
                  href={`/${locale}/privacidad`}
                  className="hover:text-ink"
                >
                  {t("privacidad")}
                </a>
              </li>
              <li>
                <a
                  href="mailto:hola@place.community"
                  className="hover:text-ink"
                >
                  {t("contacto")}
                </a>
              </li>
            </ul>
          </nav>

          <div>
            <p className="text-sm font-medium text-ink">
              {t("languageTitle")}
            </p>
            <div className="mt-3">
              <LangSwitcher />
            </div>
          </div>
        </div>

        <p className="mt-12 text-sm text-muted">
          © {year} {t("rights")}
        </p>
      </Container>
    </footer>
  );
}
