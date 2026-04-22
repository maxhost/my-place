import { test, expect } from '@playwright/test'

test('/api/health responde 200 y db=up', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.ok).toBe(true)
  expect(body.db).toBe('up')
})
