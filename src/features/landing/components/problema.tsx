import { getTranslations } from "next-intl/server";
import { Container, Section, Kicker, SectionTitle } from "./_ui";

type Point = { title: string; body: string };

export async function Problema() {
  const t = await getTranslations("problema");
  const points = t.raw("points") as Point[];

  return (
    <Section>
      <Container>
        <Kicker>{t("kicker")}</Kicker>
        <SectionTitle>{t("title")}</SectionTitle>
        <div className="mt-12 grid gap-10 md:grid-cols-3">
          {points.map((p) => (
            <div key={p.title}>
              <h3 className="text-lg font-medium text-ink">{p.title}</h3>
              <p className="mt-3 leading-relaxed text-muted">{p.body}</p>
            </div>
          ))}
        </div>
      </Container>
    </Section>
  );
}
