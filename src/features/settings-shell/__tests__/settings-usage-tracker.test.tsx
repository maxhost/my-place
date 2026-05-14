import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

// SettingsUsageTracker ahora usa usePathname() en client. Mock para tests
// (los tests siguen pasando `currentPath` explícito como override).
vi.mock('next/navigation', () => ({
  usePathname: () => null,
}))

import { SettingsUsageTracker } from '../ui/settings-usage-tracker'
import { getTopUsage } from '../lib/track-settings-usage'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('<SettingsUsageTracker>', () => {
  it('trackea el currentPath en mount (un increment)', () => {
    render(<SettingsUsageTracker currentPath="/settings/hours" />)
    expect(getTopUsage()).toEqual([{ slug: 'hours', count: 1 }])
  })

  it('NO trackea cuando currentPath es /settings raíz (sin sub-page)', () => {
    render(<SettingsUsageTracker currentPath="/settings" />)
    expect(getTopUsage()).toEqual([])
  })

  it('NO trackea cuando currentPath es fuera de settings', () => {
    render(<SettingsUsageTracker currentPath="/conversations" />)
    expect(getTopUsage()).toEqual([])
  })

  it('renderea null (sin UI propia)', () => {
    const { container } = render(<SettingsUsageTracker currentPath="/settings/hours" />)
    expect(container.firstChild).toBeNull()
  })
})
