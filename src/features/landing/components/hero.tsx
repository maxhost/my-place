import { getLocale, getTranslations } from "next-intl/server";
import { Container, Kicker } from "./_ui";

// Hero: titular Fraunces enorme y QUIETO (tamaño = jerarquía, sin animación
// de entrada) + un elemento gráfico sobrio que evoca "un lugar": un umbral.
// SVG inline → cero requests, LCP tipográfico (plan § Dirección de arte).
export async function Hero() {
  const locale = await getLocale();
  const t = await getTranslations("hero");

  return (
    <section className="overflow-hidden">
      <Container className="grid items-center gap-12 py-20 md:grid-cols-[1.15fr_0.85fr] md:py-28 lg:py-32">
        <div>
          <Kicker>{t("kicker")}</Kicker>
          <h1 className="text-5xl leading-[1.05] text-ink md:text-6xl lg:text-7xl">
            {t("title")}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted md:text-xl">
            {t("subhead")}
          </p>
          <div className="mt-10 flex flex-col items-start gap-3">
            <a
              href={`/${locale}/login`}
              className="cta inline-flex min-h-[3rem] items-center justify-center rounded-lg px-7 text-base font-medium"
            >
              {t("cta")}
            </a>
            <p className="text-sm text-muted">{t("ctaHint")}</p>
          </div>
        </div>

        <div className="hidden justify-center md:flex">
          <Threshold />
        </div>
      </Container>
    </section>
  );
}

// Umbral: un arco sereno con arcos concéntricos que se aquietan hacia adentro.
// Decorativo (aria-hidden), sin motion. Colores vía tokens (currentColor /
// var) para respetar la paleta configurable.
function Threshold() {
  return (
    <svg
      width="320"
      height="380"
      viewBox="0 0 320 380"
      fill="none"
      aria-hidden="true"
      className="text-border"
    >
      <path
        d="M40 360 V160 a120 120 0 0 1 240 0 V360"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M78 360 V168 a82 82 0 0 1 164 0 V360"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M116 360 V176 a44 44 0 0 1 88 0 V360"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <line
        x1="20"
        y1="360"
        x2="300"
        y2="360"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="160" cy="150" r="5" fill="var(--accent)" />
    </svg>
  );
}
