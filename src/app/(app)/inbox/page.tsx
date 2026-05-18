// Inbox universal del usuario — servible en `app.place.community`
// (multi-tenancy.md). El proxy reescribe ese host a `/inbox`.
//
// PLACEHOLDER: DMs + lista de places a los que pertenece el usuario son una
// feature posterior (fuera del alcance de la tanda de registro, ADR-0008/0010
// "Unirme" = directorio diferido). S7 solo fija el ruteo del host.

export const preferredRegion = "iad1";

export default function InboxPage() {
  return (
    <main
      id="contenido"
      className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
    >
      <p className="text-sm uppercase tracking-widest text-muted">inbox</p>
      <h1 className="mt-3 text-3xl text-ink">Tu espacio</h1>
      <p className="mt-4 max-w-md leading-relaxed text-muted">
        Acá vas a ver tus mensajes y los lugares a los que pertenecés.
      </p>
    </main>
  );
}
