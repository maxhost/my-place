import { afterAll, describe, expect, it } from 'vitest'
import { closePool, pool } from './harness'

/**
 * Tests del helper SQL `realtime.discussions_post_id_from_topic()`.
 *
 * La función vive en migration `20260424000000_realtime_discussions_presence`
 * y fue actualizada en `20260509230000_realtime_topic_split_presence` para
 * extraer el postId tanto de topics legacy (`post:<id>`) como del nuevo
 * formato split de presence (`post:<id>:presence`) y futuros suffixes.
 *
 * Background completo: `docs/gotchas/supabase-channel-topic-collision.md` y
 * ADR `docs/decisions/2026-05-09-realtime-presence-topic-split.md`.
 */

describe('realtime.discussions_post_id_from_topic()', () => {
  afterAll(async () => {
    await closePool()
  })

  /**
   * Setea el GUC `realtime.topic` en una tx local y llama la función.
   * `set_config(..., true)` hace el setting LOCAL — se descarta al ROLLBACK.
   * Replica cómo Supabase Realtime expone `realtime.topic()` durante el check
   * de policies en `realtime.messages`.
   */
  async function postIdForTopic(topic: string): Promise<string | null> {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT set_config($1, $2, true)', ['realtime.topic', topic])
      const { rows } = await client.query<{ id: string | null }>(
        'SELECT realtime.discussions_post_id_from_topic() AS id',
      )
      await client.query('ROLLBACK')
      return rows[0]?.id ?? null
    } finally {
      client.release()
    }
  }

  it('post:<id> → <id> (formato legacy de broadcast)', async () => {
    expect(await postIdForTopic('post:cmoykynca0001ibazlq7jhnpl')).toBe('cmoykynca0001ibazlq7jhnpl')
  })

  it('post:<id>:presence → <id> (formato nuevo de presence)', async () => {
    expect(await postIdForTopic('post:cmoykynca0001ibazlq7jhnpl:presence')).toBe(
      'cmoykynca0001ibazlq7jhnpl',
    )
  })

  it('post:<id>:foo:bar → <id> (forward-compat con futuros suffixes)', async () => {
    expect(await postIdForTopic('post:cmoykynca0001ibazlq7jhnpl:foo:bar')).toBe(
      'cmoykynca0001ibazlq7jhnpl',
    )
  })

  it('topic no relacionado → NULL (no matchea LIKE post:%)', async () => {
    expect(await postIdForTopic('event:abc')).toBeNull()
    expect(await postIdForTopic('')).toBeNull()
    expect(await postIdForTopic('post-other:abc')).toBeNull()
  })
})
