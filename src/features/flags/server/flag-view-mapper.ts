/**
 * Mapper puro: combina un `Flag` persistido con su `FlagTargetSnapshot` opcional
 * para producir la `FlagView` que consume la cola admin.
 *
 * Sin side effects, sin I/O. Testeable sin mocks.
 */

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

  const preview = extractTextExcerpt(snapshot.body)

  if (snapshot.targetType === 'POST') {
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
      preview,
      postSlug: snapshot.slug,
      postId: null,
    }
  }

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
    preview,
    postSlug: snapshot.postSlug,
    postId: snapshot.postId,
  }
}
