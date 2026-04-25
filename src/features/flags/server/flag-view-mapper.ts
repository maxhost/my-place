/**
 * Mapper puro: combina un `Flag` persistido con su `FlagTargetSnapshot` opcional
 * para producir la `FlagView` que consume la cola admin.
 *
 * Sin side effects, sin I/O. Testeable sin mocks.
 */

import { assertNever } from '@/shared/lib/assert-never'
import { extractTextExcerpt } from '../domain/text-excerpt'
import type { Flag, FlagContentStatus, FlagTargetSnapshot, FlagView } from '../domain/types'

export function mapFlagToView(flag: Flag, snapshot: FlagTargetSnapshot | null): FlagView {
  if (snapshot === null) {
    return {
      id: flag.id,
      targetType: flag.targetType,
      targetId: flag.targetId,
      reason: flag.reason,
      reasonNote: flag.reasonNote,
      createdAt: flag.createdAt,
      reporterUserId: flag.reporterUserId,
      status: flag.status,
      reviewedAt: flag.reviewedAt,
      reviewNote: flag.reviewNote,
      contentStatus: 'DELETED',
      title: null,
      preview: '',
      postSlug: null,
      postId: null,
    }
  }

  switch (snapshot.targetType) {
    case 'POST': {
      const contentStatus: FlagContentStatus = snapshot.hiddenAt ? 'HIDDEN' : 'VISIBLE'
      return {
        id: flag.id,
        targetType: flag.targetType,
        targetId: flag.targetId,
        reason: flag.reason,
        reasonNote: flag.reasonNote,
        createdAt: flag.createdAt,
        reporterUserId: flag.reporterUserId,
        status: flag.status,
        reviewedAt: flag.reviewedAt,
        reviewNote: flag.reviewNote,
        contentStatus,
        title: snapshot.title,
        preview: extractTextExcerpt(snapshot.body),
        postSlug: snapshot.slug,
        postId: null,
      }
    }
    case 'COMMENT': {
      const contentStatus: FlagContentStatus = snapshot.deletedAt ? 'DELETED' : 'VISIBLE'
      return {
        id: flag.id,
        targetType: flag.targetType,
        targetId: flag.targetId,
        reason: flag.reason,
        reasonNote: flag.reasonNote,
        createdAt: flag.createdAt,
        reporterUserId: flag.reporterUserId,
        status: flag.status,
        reviewedAt: flag.reviewedAt,
        reviewNote: flag.reviewNote,
        contentStatus,
        title: null,
        preview: extractTextExcerpt(snapshot.body),
        postSlug: snapshot.postSlug,
        postId: snapshot.postId,
      }
    }
    case 'EVENT': {
      // Eventos cancelados se tratan como `DELETED` para la cola admin —
      // contenido no accionable. Eventos activos = `VISIBLE`.
      const contentStatus: FlagContentStatus = snapshot.cancelledAt ? 'DELETED' : 'VISIBLE'
      return {
        id: flag.id,
        targetType: flag.targetType,
        targetId: flag.targetId,
        reason: flag.reason,
        reasonNote: flag.reasonNote,
        createdAt: flag.createdAt,
        reporterUserId: flag.reporterUserId,
        status: flag.status,
        reviewedAt: flag.reviewedAt,
        reviewNote: flag.reviewNote,
        contentStatus,
        title: snapshot.title,
        // Preview = `${displayName del autor} • ${startsAt local}`. El
        // admin ve quién organizó + cuándo, sin replicar la descripción
        // completa del evento (que vive en el detalle).
        preview: `${snapshot.authorSnapshot.displayName} • ${snapshot.startsAt}`,
        // Eventos no usan el formato post-detail; los links a `/events/[id]`
        // los maneja la UI cuando ve `targetType === 'EVENT'`.
        postSlug: null,
        postId: null,
      }
    }
    default:
      return assertNever(snapshot)
  }
}
