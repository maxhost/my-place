import type { ReactNode } from "react";

// Primitivos de layout del slice landing. Tailwind SOLO para layout/spacing
// (CLAUDE.md); el color sale de las CSS custom properties mapeadas en
// globals.css (text-ink, text-muted, bg-surface, …).

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  // max-width ~1100-1200px (README §UX/UI).
  return (
    <div className={`mx-auto w-full max-w-[68rem] px-6 ${className}`}>
      {children}
    </div>
  );
}

export function Section({
  children,
  id,
  className = "",
  surface = false,
}: {
  children: ReactNode;
  id?: string;
  className?: string;
  surface?: boolean;
}) {
  // Ritmo: secciones con padding generoso; algunas sobre surface para variar
  // (no todas iguales).
  return (
    <section
      id={id}
      className={`scroll-mt-24 py-20 md:py-28 ${surface ? "bg-surface" : ""} ${className}`}
    >
      {children}
    </section>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  // Acento terracota solo en kickers + CTA. --accent-strong para texto (WCAG).
  return (
    <p className="mb-4 text-sm font-medium tracking-wide text-accent-strong uppercase">
      {children}
    </p>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="max-w-2xl text-3xl leading-tight text-ink md:text-4xl">
      {children}
    </h2>
  );
}

export function CtaLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
}) {
  // Link real (<a>): cero JS de cliente, crawleable. Target ≥44px en mobile.
  const base =
    "inline-flex min-h-[2.75rem] items-center justify-center rounded-lg px-6 text-base font-medium transition-colors";
  if (variant === "ghost") {
    return (
      <a
        href={href}
        className={`${base} border border-border text-ink hover:bg-surface`}
      >
        {children}
      </a>
    );
  }
  return (
    <a href={href} className={`cta ${base}`}>
      {children}
    </a>
  );
}
