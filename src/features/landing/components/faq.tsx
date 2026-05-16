import { getTranslations } from "next-intl/server";
import { Container, Section, Kicker, SectionTitle } from "./_ui";

type Item = { q: string; a: string };

// <details>/<summary>: colapsable accesible nativo, cero JS.
export async function Faq() {
  const t = await getTranslations("faq");
  const items = t.raw("items") as Item[];

  return (
    <Section id="faq" surface>
      <Container>
        <Kicker>{t("kicker")}</Kicker>
        <SectionTitle>{t("title")}</SectionTitle>
        <div className="mt-10 flex max-w-2xl flex-col divide-y divide-border border-y border-border">
          {items.map((item) => (
            <details key={item.q} className="group py-2">
              <summary className="flex min-h-[2.75rem] cursor-pointer items-center justify-between gap-4 py-2 text-lg text-ink marker:content-none">
                {item.q}
                <span
                  aria-hidden="true"
                  className="text-muted transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="pb-3 leading-relaxed text-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </Container>
    </Section>
  );
}
