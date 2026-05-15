const blocks = [
  {
    title: "Íntimo por diseño",
    body: "Hasta 150 personas. Lo suficientemente chico para que sea un lugar y no una plataforma.",
  },
  {
    title: "Con su propio horario",
    body: "Cada place abre y cierra cuando sus miembros deciden. Fuera de hora, el lugar descansa.",
  },
  {
    title: "Nada grita",
    body: "Sin notificaciones agresivas, sin métricas de vanidad, sin scroll infinito. La información está para quien mire.",
  },
];

export function ValueProp() {
  return (
    <section className="bg-soft px-6 py-20 md:py-28">
      <div className="mx-auto max-w-3xl">
        <h2 className="font-serif text-2xl text-text md:text-3xl">
          Un espacio tranquilo, no un feed
        </h2>
        <div className="mt-10 flex flex-col gap-8">
          {blocks.map((b) => (
            <div key={b.title}>
              <h3 className="text-base font-medium text-text">{b.title}</h3>
              <p className="mt-2 text-base leading-relaxed text-muted">
                {b.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
