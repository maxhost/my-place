import { getTranslations } from "next-intl/server";
import { Container, Section, Kicker, SectionTitle } from "./_ui";

type Row = { audience: string; community: string };

export async function Diferenciacion() {
  const t = await getTranslations("diferenciacion");
  const comparison = t.raw("comparison") as {
    audienceLabel: string;
    communityLabel: string;
    rows: Row[];
  };

  return (
    <Section id="diferencia">
      <Container>
        <Kicker>{t("kicker")}</Kicker>
        <SectionTitle>{t("title")}</SectionTitle>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink">
          {t("body")}
        </p>

        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-2">
          <div className="bg-bg p-6">
            <p className="text-sm font-medium tracking-wide text-muted uppercase">
              {comparison.audienceLabel}
            </p>
            <ul className="mt-4 flex flex-col gap-3">
              {comparison.rows.map((r) => (
                <li key={r.audience} className="text-muted">
                  {r.audience}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-surface p-6">
            <p className="text-sm font-medium tracking-wide text-accent-strong uppercase">
              {comparison.communityLabel}
            </p>
            <ul className="mt-4 flex flex-col gap-3">
              {comparison.rows.map((r) => (
                <li key={r.community} className="text-ink">
                  {r.community}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-8 max-w-2xl leading-relaxed text-muted">
          {t("dunbar")}
        </p>
      </Container>
    </Section>
  );
}
