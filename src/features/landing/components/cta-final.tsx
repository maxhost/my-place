import { getLocale, getTranslations } from "next-intl/server";
import { Container, Section } from "./_ui";

// Tercera (y última) aparición del mismo CTA — invitación calmada, sin
// urgencia ni countdowns (README §10).
export async function CtaFinal() {
  const locale = await getLocale();
  const t = await getTranslations("ctaFinal");

  return (
    <Section>
      <Container className="flex flex-col items-center text-center">
        <h2 className="max-w-2xl text-3xl leading-tight text-ink md:text-4xl">
          {t("title")}
        </h2>
        <p className="mt-4 text-muted">{t("subhead")}</p>
        <a
          href={`/${locale}/login`}
          className="cta mt-10 inline-flex min-h-[3rem] items-center justify-center rounded-lg px-8 text-base font-medium"
        >
          {t("cta")}
        </a>
      </Container>
    </Section>
  );
}
