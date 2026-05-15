import Link from "next/link";

export function Hero() {
  return (
    <section className="px-6 py-24 md:py-32">
      <div className="mx-auto max-w-3xl text-center">
        <p className="font-sans text-xs tracking-wide text-accent md:text-sm">
          Un lugar, no una app
        </p>
        <h1 className="mt-6 font-serif text-4xl italic text-text md:text-6xl">
          Place
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted md:text-xl">
          Un lugar digital pequeño e íntimo para hasta 150 personas. Entrás, te
          ponés al día, participás si querés, y salís.
        </p>
        <div className="mt-10">
          <Link
            href="/login"
            className="cta inline-flex items-center justify-center rounded-md px-6 py-3 text-base font-medium"
          >
            Entrar
          </Link>
          <p className="mt-4 text-sm text-muted">
            Creá tu place o sumate a uno.
          </p>
        </div>
      </div>
    </section>
  );
}
