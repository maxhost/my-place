import { getLocale, getTranslations } from "next-intl/server";
import { Container } from "./_ui";

// Nav server-rendered. Menú mobile = checkbox + CSS (peer), sin 'use client'
// ni JS de cliente (plan Fase 5: "si se puede sin JS mejor").
export async function Nav() {
  const locale = await getLocale();
  const t = await getTranslations("nav");
  const a11y = await getTranslations("a11y");

  const links = [
    { href: "#como-funciona", label: t("comoFunciona") },
    { href: "#diferencia", label: t("diferencia") },
    { href: "#precios", label: t("precios") },
    { href: "#faq", label: t("faq") },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur-sm">
      <Container className="flex items-center justify-between py-4">
        <a
          href={`/${locale}`}
          className="text-lg font-medium tracking-tight text-ink"
        >
          {t("brand")}
        </a>

        <nav
          aria-label={a11y("primaryNav")}
          className="hidden items-center gap-8 md:flex"
        >
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm text-muted hover:text-ink"
            >
              {l.label}
            </a>
          ))}
          <a
            href={`/${locale}/login`}
            className="cta inline-flex min-h-[2.5rem] items-center rounded-lg px-5 text-sm font-medium"
          >
            {t("cta")}
          </a>
        </nav>

        {/* Mobile: checkbox-only disclosure */}
        <div className="md:hidden">
          <input
            type="checkbox"
            id="nav-menu"
            className="peer sr-only"
            aria-label={a11y("openMenu")}
          />
          <label
            htmlFor="nav-menu"
            className="flex min-h-[2.75rem] min-w-[2.75rem] cursor-pointer items-center justify-center rounded-lg border border-border text-ink"
          >
            <span aria-hidden="true">☰</span>
          </label>
          <div className="absolute inset-x-0 top-full hidden border-b border-border bg-bg peer-checked:block">
            <Container className="flex flex-col gap-1 py-4">
              {links.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  className="rounded-md px-2 py-3 text-base text-ink hover:bg-surface"
                >
                  {l.label}
                </a>
              ))}
              <a
                href={`/${locale}/login`}
                className="cta mt-2 inline-flex min-h-[2.75rem] items-center justify-center rounded-lg px-5 text-base font-medium"
              >
                {t("cta")}
              </a>
            </Container>
          </div>
        </div>
      </Container>
    </header>
  );
}
