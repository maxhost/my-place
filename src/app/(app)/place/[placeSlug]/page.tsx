import { notFound } from "next/navigation";
import { isServiceableSlug } from "@/shared/lib/host-routing";

// Portada del place — servible en `{slug}.place.community` (multi-tenancy.md).
// El proxy reescribe ese host a `/place/{slug}` (prefijo estático: evita la
// colisión `[locale]`↔`[placeSlug]` que Next prohíbe en route groups).
//
// PLACEHOLDER hasta S5b: el gate de S7 es ESTRUCTURAL (formato + reservados,
// `isServiceableSlug`). La resolución real del place por DB
// (`loadPlaceBySlug` → `notFound()` si no existe) + el patrón de streaming
// agresivo del shell (architecture.md § "Streaming agresivo del shell") entran
// con los datos en S5b/S8; este archivo se reemplaza ahí.

// Co-location Neon ↔ Functions (architecture.md § Performance · stack.md §
// Región): la zona app es DB-bound desde S5b.
export const preferredRegion = "iad1";

type Props = { params: Promise<{ placeSlug: string }> };

export default async function PlacePage({ params }: Props) {
  const { placeSlug } = await params;
  if (!isServiceableSlug(placeSlug)) notFound();

  return (
    <main
      id="contenido"
      className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
    >
      <p className="text-sm uppercase tracking-widest text-muted">place</p>
      <h1 className="mt-3 text-3xl text-ink">{placeSlug}</h1>
      <p className="mt-4 max-w-md leading-relaxed text-muted">
        Este lugar está casi listo. La portada se sirve acá una vez creado.
      </p>
    </main>
  );
}
