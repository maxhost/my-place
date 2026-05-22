"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { ArchiveCustomDomain } from "../actions/archive-custom-domain";
import type {
  CustomDomainState,
  DnsRecord,
} from "../types/custom-domain";
import { ArchiveTrigger } from "./domain-section-archive";
import type { DomainSectionLabels } from "./domain-section";

// Sub-componentes del estado `pending` del feature custom-domain V1
// (`docs/features/custom-domain/spec.md` §"UI states"). Separado del
// entry-point por límite de LOC (CLAUDE.md §"Límites de tamaño":
// archivo ≤300). Comportamiento idéntico al original.
//
// Decisiones de diseño:
//
// - **Auto-refresh 30s**: dos sub-componentes (`AutoRefreshInjected` /
//   `AutoRefreshRouter`) elegidos por mount según `onRefresh` venga inyectado
//   o no — rules of hooks intacto, y `useRouter` SÓLO se llama cuando no hay
//   inyección (en jsdom no hay App Router montado).
// - **`navigator.clipboard` fallback elegante** (spec §"Decisión:
//   navigator.clipboard requiere secure context"): si la API no existe o
//   falla, silenciamos sin toast; el valor sigue seleccionable manualmente.
// - **`ArchiveTrigger`** se importa de `./domain-section-archive` (mismo
//   botón "Remover" se usa en pending y verified).

const noticeCls =
  "rounded-lg border border-border bg-surface px-4 py-3 text-sm text-ink";
const REFRESH_MS = 30_000;
const COPIED_MS = 2_000;

export function PendingState(props: {
  state: Extract<CustomDomainState, { status: "pending" }>;
  placeSlug: string;
  archiveAction: ArchiveCustomDomain;
  labels: DomainSectionLabels;
  onRefresh?: () => void;
}) {
  const { state, placeSlug, archiveAction, labels, onRefresh } = props;
  // Sub-componente elegido por mount (identidad estable → rules of hooks ok).
  const description = labels.pendingDescription.replace("{domain}", state.record.domain);
  const showRecords = state.vercelUnavailable !== true && state.dnsRecords !== null;
  return (
    <div className="flex flex-col gap-6">
      {onRefresh !== undefined ? (
        <AutoRefreshInjected onRefresh={onRefresh} />
      ) : (
        <AutoRefreshRouter />
      )}
      {state.wasDownreverted === true && (
        <DownrevertedBanner domain={state.record.domain} labels={labels} />
      )}
      <div className={noticeCls}>
        <p className="font-semibold text-ink">{labels.pendingTitle}</p>
        <p className="mt-1"><strong className="text-ink">{state.record.domain}</strong></p>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      {showRecords && state.dnsRecords !== null ? (
        <>
          <DnsRecordsTable records={state.dnsRecords} labels={labels} />
          <p className="text-sm text-muted">{labels.pendingSlaCopy}</p>
        </>
      ) : (
        <p className={noticeCls}>{labels.pendingVercelUnavailable}</p>
      )}
      <ArchiveTrigger
        placeSlug={placeSlug}
        domainId={state.record.id}
        archiveAction={archiveAction}
        labels={labels}
      />
    </div>
  );
}

/**
 * Banner ADR-0029 §UX downreverted: el lazy poll detectó que un dominio que
 * estaba `verified` se rompió en DNS (V6 `misconfigured: true`) y reseteó
 * `verified_at = NULL` en DB. Es un sub-estado de pending — la tabla DNS se
 * muestra normal abajo, este banner agrega contexto explícito de "tu DNS
 * dejó de apuntar a Place, reconfigurá los records".
 *
 * No usa colores hardcoded (CLAUDE.md §"Tailwind solo para layout y
 * spacing"): reusa `noticeCls` (border-border + bg-surface). La
 * diferenciación visual viene de la **posición** (primer elemento del
 * pending state) + **copy denso** (título bold + body descriptivo).
 *
 * `{domain}` se resuelve igual que `pendingDescription` (`String.replace`)
 * — no usamos `next-intl` Format aquí porque las labels llegan ya
 * serializadas como strings al Client (mismo patrón que `pendingDescription`,
 * `archiveConfirmBody`).
 */
function DownrevertedBanner({
  domain,
  labels,
}: {
  domain: string;
  labels: DomainSectionLabels;
}) {
  const body = labels.downrevertedBannerBody.replace("{domain}", domain);
  return (
    <div className={noticeCls}>
      <p className="font-semibold text-ink">{labels.downrevertedBannerTitle}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </div>
  );
}

function AutoRefreshInjected({ onRefresh }: { onRefresh: () => void }) {
  // Ref-stable callback: sync vía effect (no mutamos en render — `react-hooks/refs`).
  const ref = useRef(onRefresh);
  useEffect(() => {
    ref.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    const id = setInterval(() => ref.current(), REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  return null;
}

function AutoRefreshRouter() {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);
  return null;
}

function DnsRecordsTable({
  records,
  labels,
}: {
  records: DnsRecord[];
  labels: DomainSectionLabels;
}) {
  const [copied, setCopied] = useState<{ row: number; col: number } | null>(null);

  async function handleCopy(value: string, row: number, col: number) {
    // `clipboard.writeText` requiere secure context; fallback silencioso.
    try {
      await navigator.clipboard?.writeText(value);
      setCopied({ row, col });
      setTimeout(
        () => setCopied((c) => (c?.row === row && c.col === col ? null : c)),
        COPIED_MS,
      );
    } catch {
      // Fallback: triple-click + Cmd/Ctrl+C manual.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-ink">{labels.dnsRecordsTitle}</p>
      <table className="w-full border-collapse rounded-lg border border-border text-sm">
        <thead>
          <tr>
            <Th>{labels.dnsRecordType}</Th>
            <Th>{labels.dnsRecordName}</Th>
            <Th>{labels.dnsRecordValue}</Th>
          </tr>
        </thead>
        <tbody>
          {records.map((rec, i) => (
            <DnsRecordRow
              key={`${rec.type}-${rec.name}-${rec.value}`}
              record={rec}
              rowIdx={i}
              copied={copied}
              onCopy={handleCopy}
              labels={labels}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th scope="col" className="border-b border-border px-3 py-2 text-left text-ink">
      {children}
    </th>
  );
}

function DnsRecordRow(props: {
  record: DnsRecord;
  rowIdx: number;
  copied: { row: number; col: number } | null;
  onCopy: (value: string, row: number, col: number) => void;
  labels: DomainSectionLabels;
}) {
  const { record, rowIdx, copied, onCopy, labels } = props;
  const cells = [record.type, record.name, record.value];
  return (
    <tr>
      {cells.map((value, col) => (
        <td key={col} className="border-b border-border px-3 py-2 align-top text-ink">
          <div className="flex items-center gap-2">
            <span style={{ userSelect: "all" }}>{value}</span>
            <button
              type="button"
              onClick={() => onCopy(value, rowIdx, col)}
              className="rounded border border-border bg-surface px-2 py-1 text-xs text-ink hover:opacity-80"
            >
              {labels.copyButton}
            </button>
            {copied?.row === rowIdx && copied.col === col && (
              <span role="status" aria-live="polite" className="text-xs text-muted">
                {labels.copiedTooltip}
              </span>
            )}
          </div>
        </td>
      ))}
    </tr>
  );
}
