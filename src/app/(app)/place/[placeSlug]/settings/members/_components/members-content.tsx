import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import {
  createInvitationAction,
  loadPendingInvitations,
  revokeInvitationAction,
} from "@/features/invitations/public";
import { loadMembers, removeMemberAction } from "@/features/members/public";
import type { PlaceData } from "@/features/place/public";
import { buildPlaceCanonicalUrl } from "@/shared/lib/auth-redirect";
import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";

import { buildMembersPageShellLabels } from "../_lib/build-shell-labels";
import { MembersPageShell } from "./members-page-shell";

// Async Server Component del contenido de `/settings/members` (Phase 2.H.1,
// extraído del `page.tsx` para streaming agresivo del shell, architecture.md
// §"Streaming agresivo del shell"). El `page.tsx` valida (slug/sesión/place),
// pinta el shell + sidebar inmediato, y suspende ESTE child mientras corre
// el `await getAuthenticatedDbForRequest(...)` — el browser ve el
// `<MembersSkeleton/>` en vez de un shell en blanco.
//
// Recibe `place` ya resuelto (memoizado con el layout vía React.cache) para
// no repetir el lookup. Todo lo demás (queries owner-only bajo RLS, lookup
// del `app_user.id` del caller, i18n del slice, invite base URL zone-aware)
// vive acá adentro.

export async function MembersContent({ place }: { place: PlaceData }) {
  // Queries del page (members + pending invitations) + lookup `app_user.id`
  // del caller en una sola tx autenticada (ADR-0034). El caller siempre es
  // owner por el guard del page; el lookup resuelve su fila `app_user`
  // filtrada por `auth_user_id = claims.sub`.
  const { members, pendingInvitations, currentAppUserId } =
    await getAuthenticatedDbForRequest(async (sql, claims) => {
      const m = await loadMembers(sql, place.id);
      const p = await loadPendingInvitations(sql, place.id);
      const cuRows = await sql(
        `SELECT id FROM app_user WHERE auth_user_id = $1`,
        [claims.sub],
      );
      const cuid = (cuRows[0]?.id as string | undefined) ?? null;
      return { members: m, pendingInvitations: p, currentAppUserId: cuid };
    });

  // Si `currentAppUserId` no aparece en `members` (race: el caller fue
  // removido entre la tx y el render), `notFound()`. Desde un Suspense child
  // hay flicker skeleton→404, aceptable para este caso marginal
  // (architecture.md §"Manejo de notFound").
  const callerMember = currentAppUserId
    ? members.find((mem) => mem.userId === currentAppUserId)
    : undefined;
  if (!callerMember) notFound();

  const tMembers = await getTranslations({
    locale: place.defaultLocale,
    namespace: "placeMembers",
  });
  const shellLabels = buildMembersPageShellLabels(tMembers);

  // V1.2 Sesión A (ADR-0046 §D1): emisión zone-aware del invite link. Si el
  // place tiene custom domain verified, el invite apunta al custom domain;
  // si no, cae al subdomain canon (zero regresión).
  const inviteBaseUrl = (
    await buildPlaceCanonicalUrl({ slug: place.slug, path: "/" })
  ).replace(/\/$/, "");

  return (
    <MembersPageShell
      members={members}
      pendingInvitations={pendingInvitations}
      callerCtx={{
        userId: callerMember.userId,
        isOwner: callerMember.isOwner,
        isFounder: callerMember.isFounder,
      }}
      placeId={place.id}
      placeSlug={place.slug}
      locale={place.defaultLocale}
      inviteBaseUrl={inviteBaseUrl}
      actions={{
        createInvitation: createInvitationAction,
        revokeInvitation: revokeInvitationAction,
        menu: {
          removeAction: removeMemberAction,
        },
      }}
      labels={shellLabels}
    />
  );
}
