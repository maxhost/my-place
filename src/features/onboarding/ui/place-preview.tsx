import { type Palette, applyContrastGuardrail } from "@/shared/lib/contrast";

// Preview en vivo del lugar mientras se completa el wizard. Los colores son
// del PLACE (configurables por el owner) → CSS inline, NUNCA clases Tailwind
// de color (CLAUDE.md). Tailwind solo layout/spacing. El guardrail de
// contraste (ADR-0005 §8) corre acá también: si ajusta algún color, se avisa
// en tono calmo (cozytech: informa, no alarma) — nunca bloquea.

export interface PreviewLabels {
  previewLabel: string;
  previewEmptyName: string;
  guardrailNotice: string;
}

export function PlacePreview({
  name,
  palette,
  labels,
}: {
  name: string;
  palette: Palette;
  labels: PreviewLabels;
}) {
  const { palette: safe, accentStrong, adjustments } =
    applyContrastGuardrail(palette);
  const shown = name.trim() || labels.previewEmptyName;

  // El aviso es por el token PERSISTIDO que cambió (`ink`, ADR-0005 §8): es
  // lo que el owner eligió y se guarda ajustado. `accentStrong` es un
  // derivado de render que NO se persiste (ADR-0005 §7) y existe siempre
  // —incluso para la paleta de marca Papel—; avisarlo sería ruido alarmista
  // (cozytech). S8b: cuando el owner elija una paleta, un `ink` ilegible
  // disparará el aviso calmo.
  const persistedAdjusted = adjustments.some((a) => a.token === "ink");

  return (
    <figure
      data-testid="place-preview"
      className="m-0 flex flex-col gap-4 rounded-xl border p-6"
      style={{
        background: safe.bg,
        color: safe.ink,
        borderColor: accentStrong,
      }}
    >
      <figcaption
        className="text-xs font-medium tracking-wide uppercase"
        style={{ color: accentStrong }}
      >
        {labels.previewLabel}
      </figcaption>
      <p className="text-2xl leading-tight">{shown}</p>
      <span
        aria-hidden="true"
        className="inline-flex h-9 w-28 items-center rounded-lg"
        style={{ background: accentStrong }}
      />
      {persistedAdjusted && (
        <p
          data-testid="preview-guardrail-notice"
          className="text-sm"
          style={{ color: safe.ink }}
        >
          {labels.guardrailNotice}
        </p>
      )}
    </figure>
  );
}
