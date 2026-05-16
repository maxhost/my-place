import { getLocale, getTranslations } from "next-intl/server";
import { Container, Section, Kicker, SectionTitle } from "./_ui";

type Plan = {
  id: string;
  name: string;
  price: string;
  period: string;
  description: string;
  cta: string;
  highlight?: boolean;
};

export async function Pricing() {
  const locale = await getLocale();
  const t = await getTranslations("pricing");
  const plans = t.raw("plans") as Plan[];

  return (
    <Section id="precios">
      <Container>
        <Kicker>{t("kicker")}</Kicker>
        <SectionTitle>{t("title")}</SectionTitle>
        <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink">
          {t("subhead")}
        </p>

        <div className="mt-10 rounded-xl border border-border bg-surface p-6">
          <p className="text-xl font-medium text-ink">{t("freeTrial")}</p>
          <p className="mt-1 text-muted">{t("freeTrialNote")}</p>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`flex flex-col rounded-xl border p-7 ${
                plan.highlight
                  ? "border-accent-strong bg-surface"
                  : "border-border bg-bg"
              }`}
            >
              <p className="text-sm font-medium tracking-wide text-muted uppercase">
                {plan.name}
              </p>
              <p className="mt-4">
                <span className="text-4xl text-ink">{plan.price}</span>
                <span className="text-muted">{plan.period}</span>
              </p>
              <p className="mt-3 grow leading-relaxed text-muted">
                {plan.description}
              </p>
              <a
                href={`/${locale}/login`}
                className={`mt-7 inline-flex min-h-[3rem] items-center justify-center rounded-lg px-6 text-base font-medium ${
                  plan.highlight
                    ? "cta"
                    : "border border-border text-ink hover:bg-surface"
                }`}
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>

        <p className="mt-8 text-lg text-ink">{t("commissionLine")}</p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          {t("footnote")}
        </p>
      </Container>
    </Section>
  );
}
