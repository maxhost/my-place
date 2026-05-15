import Link from "next/link";

export function Cta() {
  return (
    <section
      className="px-6 py-20 md:py-28"
      style={{ background: "var(--accent-soft)" }}
    >
      <div className="mx-auto max-w-3xl text-center">
        <p className="font-serif text-2xl text-text md:text-3xl">
          Tu lugar te espera cuando quieras entrar.
        </p>
        <div className="mt-8">
          <Link
            href="/login"
            className="cta inline-flex items-center justify-center rounded-md px-6 py-3 text-base font-medium"
          >
            Entrar
          </Link>
        </div>
      </div>
    </section>
  );
}
