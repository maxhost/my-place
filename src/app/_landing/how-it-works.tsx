const steps = [
  {
    n: "1",
    title: "Te registrás",
    body: "Una cuenta para todos tus places.",
  },
  {
    n: "2",
    title: "Creás un place o te sumás a uno",
    body: "Empezá el tuyo, sumate por el directorio, o aceptá una invitación.",
  },
  {
    n: "3",
    title: "Entrás cuando está abierto",
    body: "Te ponés al día, participás si querés, y salís.",
  },
];

export function HowItWorks() {
  return (
    <section className="px-6 py-20 md:py-28">
      <div className="mx-auto max-w-3xl">
        <h2 className="font-serif text-2xl text-text md:text-3xl">
          Cómo entrás
        </h2>
        <div className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n}>
              <p className="font-serif text-xl text-accent">{s.n}</p>
              <h3 className="mt-3 text-base font-medium text-text">
                {s.title}
              </h3>
              <p className="mt-2 text-base leading-relaxed text-muted">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
