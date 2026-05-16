import { getLocale, getTranslations } from "next-intl/server";
import { Container, Section, Kicker, SectionTitle } from "./_ui";
import { PlaceholderCapture } from "../content/placeholder-capture";

type Mechanism = { title: string; body: string };

export async function ComoFunciona() {
  const locale = await getLocale();
  const t = await getTranslations("comoFunciona");
  const cap = await getTranslations("captures");
  const mechanisms = t.raw("mechanisms") as Mechanism[];

  return (
    <Section id="como-funciona" surface>
      <Container>
        <Kicker>{t("kicker")}</Kicker>
        <SectionTitle>{t("title")}</SectionTitle>
        <p className="mt-4 max-w-xl leading-relaxed text-muted">{t("intro")}</p>

        <div className="mt-12 grid gap-12 md:grid-cols-[1fr_1fr] md:items-start">
          <ul className="flex flex-col gap-8">
            {mechanisms.map((m) => (
              <li key={m.title}>
                <h3 className="text-lg font-medium text-ink">{m.title}</h3>
                <p className="mt-2 leading-relaxed text-muted">{m.body}</p>
              </li>
            ))}
          </ul>
          <div className="md:sticky md:top-24">
            <PlaceholderCapture label={cap("comoFunciona")} />
          </div>
        </div>

        <div className="mt-14">
          <a
            href={`/${locale}/login`}
            className="cta inline-flex min-h-[3rem] items-center justify-center rounded-lg px-7 text-base font-medium"
          >
            {t("cta")}
          </a>
        </div>
      </Container>
    </Section>
  );
}
