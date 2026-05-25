"use client";

import Image from "next/image";

import { Badge } from "@/shared/ui/badge";

import type { elevateToOwnerAction } from "../actions/elevate-to-owner";
import type { removeMemberAction } from "../actions/remove-member";
import type { revokeOwnershipAction } from "../actions/revoke-ownership";
import type { transferFounderOwnershipAction } from "../actions/transfer-founder-ownership";
import { getMemberRole, type Member } from "../types";
import {
  MemberRowActionsMenu,
  type MemberRowActionsMenuLabels,
} from "./member-row-actions-menu";

// `<MembersList />` — Feature E V1 §S10 (spec.md §"UI screens", tests.md §S10).
// Lista de memberships activas del place + composición de
// `<MemberRowActionsMenu />` por fila. Consume `Member[]` de `loadMembers`
// (S6) — el page RSC S11 inyecta el array + actions + callerCtx.
//
// Seam-split canónico: las 4 Server Actions (elevate/revoke/remove/transfer)
// se inyectan como `actions` prop. Tests RTL pasan `vi.fn()`; el page S11
// inyecta las reales. `<MemberRowActionsMenu />` es co-slice — se importa
// directo (no seam adicional entre componentes del mismo slice).
//
// **Avatar**: render `<Image unoptimized>` cuando `avatarUrl != null`;
// fallback `<span>` con inicial cuando null. Decorativo (`aria-hidden="true"`)
// — el `displayName` es la SoT de identidad accesible. `unoptimized` evita
// requerir `images.remotePatterns` config (los avatares vienen de hosts
// arbitrarios — un wildcard pattern derrota el purpose del whitelist).
// Beneficio del Image component acá vs `<img>`: lazy loading + warning del
// linter resuelto. Para 40×40px la optimization de Next es marginal.
//
// **Headline**: render condicional ADR-0036 §1 (sin placeholder pasivo;
// si `headline == null`, el bloque entero NO aparece).
//
// **Badge**: derivado de `getMemberRole(member)` — founder y owner muestran
// badge; miembro común sin badge. La derivación es pura (fail-loud sobre
// invariantes violados — ADR-0035 §2).
//
// **i18n**: strings ES hardcoded via `labels` + `menuLabels`. Extracción
// a `t('placeMembers.*')` diferida a S11 (plan-sesiones §S11).

export type MembersListCallerContext = {
  /** `app_user.id` del caller — usado para comparar contra `member.userId` (self-row). */
  userId: string;
  isOwner: boolean;
  isFounder: boolean;
};

export type MembersListActions = {
  elevateAction: typeof elevateToOwnerAction;
  revokeOwnershipAction: typeof revokeOwnershipAction;
  removeAction: typeof removeMemberAction;
  transferFounderAction: typeof transferFounderOwnershipAction;
};

export interface MembersListLabels {
  emptyTitle: string;
  emptyDescription: string;
  badgeFounder: string;
  badgeOwner: string;
}

export type { MemberRowActionsMenuLabels };

function avatarInitial(displayName: string): string {
  const first = displayName.trim().charAt(0);
  return first ? first.toUpperCase() : "?";
}

export function MembersList({
  members,
  callerCtx,
  placeId,
  placeSlug,
  actions,
  labels,
  menuLabels,
}: {
  members: Member[];
  callerCtx: MembersListCallerContext;
  placeId: string;
  placeSlug: string;
  actions: MembersListActions;
  labels: MembersListLabels;
  menuLabels: MemberRowActionsMenuLabels;
}) {
  if (members.length === 0) {
    return (
      <section className="flex flex-col gap-2 px-4 py-6 md:px-8">
        <h3 className="text-base font-medium text-ink">{labels.emptyTitle}</h3>
        <p className="text-sm text-muted">{labels.emptyDescription}</p>
      </section>
    );
  }

  return (
    <section className="px-4 py-6 md:px-8">
      <ul className="flex flex-col gap-3">
        {members.map((member) => {
          const role = getMemberRole(member);
          return (
            <li
              key={member.userId}
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3"
            >
              <div className="flex flex-1 items-start gap-3">
                {member.avatarUrl !== null ? (
                  <Image
                    src={member.avatarUrl}
                    alt=""
                    aria-hidden="true"
                    width={40}
                    height={40}
                    unoptimized
                    className="h-10 w-10 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg text-sm font-medium text-ink"
                  >
                    {avatarInitial(member.displayName)}
                  </span>
                )}
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink">
                      {member.displayName}
                    </span>
                    <span className="text-xs text-muted">@{member.handle}</span>
                    {role === "founder" && (
                      <Badge variant="founder">{labels.badgeFounder}</Badge>
                    )}
                    {role === "owner" && (
                      <Badge variant="owner">{labels.badgeOwner}</Badge>
                    )}
                  </div>
                  {member.headline !== null && (
                    <p className="text-sm text-muted">{member.headline}</p>
                  )}
                </div>
              </div>
              <MemberRowActionsMenu
                member={member}
                callerCtx={callerCtx}
                placeId={placeId}
                placeSlug={placeSlug}
                actions={actions}
                labels={menuLabels}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
