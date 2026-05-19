import type { CreatePlaceResult } from "../create-place";
import type { WizardLabels } from "./wizard-labels";

// Pantalla de éxito (reemplaza el wizard al crear). Las URLs públicas son
// subdominio sin path (regla de memoria). El aviso del guardrail sólo si se
// ajustó el token PERSISTIDO `ink` (mismo criterio que PlacePreview):
// `accentStrong` es derivado de render que no se persiste → no se avisa.
export function SuccessPanel(p: {
  labels: WizardLabels;
  result: Extract<CreatePlaceResult, { status: "created" }>;
  rootDomain: string;
}) {
  const { labels: l } = p;
  const url = `${p.result.slug}.${p.rootDomain}`;
  const inkAdjusted = p.result.adjustments.some((a) => a.token === "ink");
  return (
    <section className="mx-auto flex w-full max-w-[40rem] flex-col gap-6 px-6 py-16 text-center">
      <h1 className="text-3xl text-ink">{l.successTitle}</h1>
      <p className="text-lg text-muted">
        {l.successBody.replace("{url}", url)}
      </p>
      {inkAdjusted && (
        <p className="text-sm text-muted">{l.guardrailNotice}</p>
      )}
      <a
        href={`https://${url}`}
        className="cta mx-auto inline-flex min-h-[3rem] items-center rounded-lg px-7 text-base font-medium"
      >
        {l.successOpen}
      </a>
    </section>
  );
}
