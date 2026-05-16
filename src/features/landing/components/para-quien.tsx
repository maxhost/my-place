import { getLocale, getTranslations } from "next-intl/server";
import { Container, Section, Kicker, SectionTitle } from "./_ui";
import { PlaceholderCapture } from "../content/placeholder-capture";

type Tab = {
  id: string;
  label: string;
  headline: string;
  body: string;
  cta: string;
};

// Clases estáticas literales (Tailwind no detecta clases interpoladas).
// El orden del array coincide con el de tabs en es.json.
const TAB_STYLES: Record<
  string,
  { label: string; panel: string }
> = {
  creador: {
    label:
      "group-has-[#pq-creador:checked]:border-transparent group-has-[#pq-creador:checked]:bg-bg group-has-[#pq-creador:checked]:text-ink",
    panel: "group-has-[#pq-creador:checked]:grid",
  },
  organizacion: {
    label:
      "group-has-[#pq-organizacion:checked]:border-transparent group-has-[#pq-organizacion:checked]:bg-bg group-has-[#pq-organizacion:checked]:text-ink",
    panel: "group-has-[#pq-organizacion:checked]:grid",
  },
  empresa: {
    label:
      "group-has-[#pq-empresa:checked]:border-transparent group-has-[#pq-empresa:checked]:bg-bg group-has-[#pq-empresa:checked]:text-ink",
    panel: "group-has-[#pq-empresa:checked]:grid",
  },
};

// Selector de público sin JS: radios + CSS :has() (group-has). Reordena la
// vista y muestra 1 CTA por público (README §6).
export async function ParaQuien() {
  const locale = await getLocale();
  const t = await getTranslations("paraQuien");
  const cap = await getTranslations("captures");
  const tabs = t.raw("tabs") as Tab[];

  return (
    <Section surface>
      <Container>
        <Kicker>{t("kicker")}</Kicker>
        <SectionTitle>{t("title")}</SectionTitle>

        <fieldset className="group mt-10">
          <legend className="sr-only">{t("title")}</legend>

          {tabs.map((tab, i) => (
            <input
              key={tab.id}
              type="radio"
              name="para-quien"
              id={`pq-${tab.id}`}
              defaultChecked={i === 0}
              className="sr-only"
            />
          ))}

          <div role="presentation" className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <label
                key={tab.id}
                htmlFor={`pq-${tab.id}`}
                className={`min-h-[2.75rem] cursor-pointer rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-muted hover:text-ink ${TAB_STYLES[tab.id].label}`}
              >
                {tab.label}
              </label>
            ))}
          </div>

          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`mt-10 hidden grid-cols-1 gap-10 md:grid-cols-[1fr_1fr] md:items-center ${TAB_STYLES[tab.id].panel}`}
            >
              <div>
                <h3 className="text-2xl text-ink md:text-3xl">
                  {tab.headline}
                </h3>
                <p className="mt-4 max-w-md leading-relaxed text-muted">
                  {tab.body}
                </p>
                <a
                  href={`/${locale}/login`}
                  className="cta mt-8 inline-flex min-h-[3rem] items-center justify-center rounded-lg px-7 text-base font-medium"
                >
                  {tab.cta}
                </a>
              </div>
              <PlaceholderCapture label={cap("paraQuien")} />
            </div>
          ))}
        </fieldset>
      </Container>
    </Section>
  );
}
