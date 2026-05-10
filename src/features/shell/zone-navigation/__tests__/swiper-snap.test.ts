import { describe, expect, it } from 'vitest'
import {
  SNAP_THRESHOLD_FRACTION,
  SNAP_VELOCITY_THRESHOLD,
  ZONE_FRESH_TTL_MS,
  deriveSnapTarget,
  isZoneRootPath,
  shouldRefreshZone,
  shouldShowShellChrome,
} from '../domain/swiper-snap'

const W = 420 // viewport width estándar mobile-first del shell

describe('deriveSnapTarget', () => {
  describe('cancel del swipe (no alcanza thresholds)', () => {
    it('drag pequeño + velocity baja → vuelve al currentIndex', () => {
      const target = deriveSnapTarget({
        currentIndex: 1,
        dragOffsetX: -50,
        velocityX: 100,
        viewportWidth: W,
        totalZones: 3,
      })
      expect(target).toBe(1)
    })

    it('drag exacto en threshold (no exceeds) → vuelve', () => {
      const target = deriveSnapTarget({
        currentIndex: 1,
        dragOffsetX: -W * SNAP_THRESHOLD_FRACTION,
        velocityX: 0,
        viewportWidth: W,
        totalZones: 3,
      })
      expect(target).toBe(1)
    })
  })

  describe('snap por threshold de offset', () => {
    it('drag a la izq > threshold → avanza a zona N+1', () => {
      const target = deriveSnapTarget({
        currentIndex: 1,
        dragOffsetX: -W * SNAP_THRESHOLD_FRACTION - 1,
        velocityX: 0,
        viewportWidth: W,
        totalZones: 3,
      })
      expect(target).toBe(2)
    })

    it('drag a la der > threshold → retrocede a zona N-1', () => {
      const target = deriveSnapTarget({
        currentIndex: 1,
        dragOffsetX: W * SNAP_THRESHOLD_FRACTION + 1,
        velocityX: 0,
        viewportWidth: W,
        totalZones: 3,
      })
      expect(target).toBe(0)
    })
  })

  describe('snap por velocity (flick rápido)', () => {
    it('flick veloz a la izq con drag chico → snap a N+1', () => {
      const target = deriveSnapTarget({
        currentIndex: 0,
        dragOffsetX: -20,
        velocityX: -SNAP_VELOCITY_THRESHOLD - 1,
        viewportWidth: W,
        totalZones: 3,
      })
      expect(target).toBe(1)
    })

    it('flick veloz a la der con drag chico → snap a N-1', () => {
      const target = deriveSnapTarget({
        currentIndex: 2,
        dragOffsetX: 20,
        velocityX: SNAP_VELOCITY_THRESHOLD + 1,
        viewportWidth: W,
        totalZones: 3,
      })
      expect(target).toBe(1)
    })
  })

  describe('clamp en bordes (bounce visual lo cubre framer-motion)', () => {
    it('zona 0 con drag der gigante → permanece en 0 (clamp)', () => {
      const target = deriveSnapTarget({
        currentIndex: 0,
        dragOffsetX: W * 2,
        velocityX: 0,
        viewportWidth: W,
        totalZones: 3,
      })
      expect(target).toBe(0)
    })

    it('zona 2 con drag izq gigante → permanece en 2 (clamp)', () => {
      const target = deriveSnapTarget({
        currentIndex: 2,
        dragOffsetX: -W * 2,
        velocityX: 0,
        viewportWidth: W,
        totalZones: 3,
      })
      expect(target).toBe(2)
    })

    it('zona 0 con flick a la der → clamp en 0', () => {
      const target = deriveSnapTarget({
        currentIndex: 0,
        dragOffsetX: 100,
        velocityX: SNAP_VELOCITY_THRESHOLD + 100,
        viewportWidth: W,
        totalZones: 3,
      })
      expect(target).toBe(0)
    })
  })

  describe('edge cases defensivos', () => {
    it('viewportWidth = 0 → vuelve al current sin crashear', () => {
      const target = deriveSnapTarget({
        currentIndex: 1,
        dragOffsetX: -200,
        velocityX: -1000,
        viewportWidth: 0,
        totalZones: 3,
      })
      expect(target).toBe(1)
    })

    it('totalZones = 0 → vuelve al current', () => {
      const target = deriveSnapTarget({
        currentIndex: 0,
        dragOffsetX: -200,
        velocityX: 0,
        viewportWidth: W,
        totalZones: 0,
      })
      expect(target).toBe(0)
    })

    it('library R.5 (totalZones=4) sigue funcionando', () => {
      const target = deriveSnapTarget({
        currentIndex: 2,
        dragOffsetX: -W * SNAP_THRESHOLD_FRACTION - 1,
        velocityX: 0,
        viewportWidth: W,
        totalZones: 4,
      })
      // 2 → 3 (library) válido porque totalZones=4 permite index 3
      expect(target).toBe(3)
    })
  })
})

describe('shouldRefreshZone', () => {
  it('lastVisitedAt undefined (primera vez) → false (no refresh, datos vienen del SSR inicial)', () => {
    const result = shouldRefreshZone({
      lastVisitedAt: undefined,
      now: Date.now(),
    })
    expect(result).toBe(false)
  })

  it('hace exactamente TTL → true (refresh)', () => {
    const now = Date.now()
    const result = shouldRefreshZone({
      lastVisitedAt: now - ZONE_FRESH_TTL_MS,
      now,
    })
    expect(result).toBe(true)
  })

  it('hace > TTL → true', () => {
    const now = Date.now()
    const result = shouldRefreshZone({
      lastVisitedAt: now - ZONE_FRESH_TTL_MS - 1000,
      now,
    })
    expect(result).toBe(true)
  })

  it('hace < TTL → false (cache warm)', () => {
    const now = Date.now()
    const result = shouldRefreshZone({
      lastVisitedAt: now - 1000,
      now,
    })
    expect(result).toBe(false)
  })

  it('respeta ttl custom', () => {
    const now = Date.now()
    const result = shouldRefreshZone({
      lastVisitedAt: now - 5_000,
      now,
      ttlMs: 10_000,
    })
    expect(result).toBe(false)
  })
})

describe('isZoneRootPath', () => {
  const ZONE_PATHS = ['/', '/conversations', '/events', '/library']

  it('zona root exacta → true', () => {
    expect(isZoneRootPath('/', ZONE_PATHS)).toBe(true)
    expect(isZoneRootPath('/conversations', ZONE_PATHS)).toBe(true)
    expect(isZoneRootPath('/events', ZONE_PATHS)).toBe(true)
    expect(isZoneRootPath('/library', ZONE_PATHS)).toBe(true)
  })

  it('zona root con trailing slash → true (tolera)', () => {
    expect(isZoneRootPath('/conversations/', ZONE_PATHS)).toBe(true)
  })

  it('sub-page (thread detail, event detail, library category) → false', () => {
    expect(isZoneRootPath('/conversations/abc-slug', ZONE_PATHS)).toBe(false)
    expect(isZoneRootPath('/conversations/new', ZONE_PATHS)).toBe(false)
    expect(isZoneRootPath('/events/evt-1', ZONE_PATHS)).toBe(false)
    expect(isZoneRootPath('/events/new', ZONE_PATHS)).toBe(false)
    expect(isZoneRootPath('/library/recetas', ZONE_PATHS)).toBe(false)
  })

  it('settings y otras rutas no-zona → false', () => {
    expect(isZoneRootPath('/settings', ZONE_PATHS)).toBe(false)
    expect(isZoneRootPath('/settings/hours', ZONE_PATHS)).toBe(false)
    expect(isZoneRootPath('/m/user-1', ZONE_PATHS)).toBe(false)
  })
})

describe('shouldShowShellChrome', () => {
  const ZONE_PATHS = ['/', '/conversations', '/events', '/library']

  describe('SÍ muestra chrome', () => {
    it('zonas root', () => {
      expect(shouldShowShellChrome('/', ZONE_PATHS)).toBe(true)
      expect(shouldShowShellChrome('/conversations', ZONE_PATHS)).toBe(true)
      expect(shouldShowShellChrome('/events', ZONE_PATHS)).toBe(true)
      expect(shouldShowShellChrome('/library', ZONE_PATHS)).toBe(true)
    })

    it('zona root con trailing slash', () => {
      expect(shouldShowShellChrome('/conversations/', ZONE_PATHS)).toBe(true)
    })

    it('settings root y sub-paths (admin necesita community switcher)', () => {
      expect(shouldShowShellChrome('/settings', ZONE_PATHS)).toBe(true)
      expect(shouldShowShellChrome('/settings/', ZONE_PATHS)).toBe(true)
      expect(shouldShowShellChrome('/settings/hours', ZONE_PATHS)).toBe(true)
      expect(shouldShowShellChrome('/settings/members', ZONE_PATHS)).toBe(true)
      expect(shouldShowShellChrome('/settings/flags', ZONE_PATHS)).toBe(true)
    })
  })

  describe('NO muestra chrome', () => {
    it('thread detail (sub-page de conversations)', () => {
      expect(shouldShowShellChrome('/conversations/abc-slug', ZONE_PATHS)).toBe(false)
    })

    it('formularios de creación', () => {
      expect(shouldShowShellChrome('/conversations/new', ZONE_PATHS)).toBe(false)
      expect(shouldShowShellChrome('/events/new', ZONE_PATHS)).toBe(false)
    })

    it('sub-pages de events (detail + edit)', () => {
      expect(shouldShowShellChrome('/events/evt-1', ZONE_PATHS)).toBe(false)
      expect(shouldShowShellChrome('/events/evt-1/edit', ZONE_PATHS)).toBe(false)
    })

    it('sub-pages de library (categoría)', () => {
      expect(shouldShowShellChrome('/library/recetas', ZONE_PATHS)).toBe(false)
    })

    it('member profile', () => {
      expect(shouldShowShellChrome('/m/user-1', ZONE_PATHS)).toBe(false)
    })

    it('paths que arrancan con `/settings` pero NO son settings (defensivo)', () => {
      // Edge case: un path como `/settingsx` no debería contar como settings.
      expect(shouldShowShellChrome('/settingsx', ZONE_PATHS)).toBe(false)
    })
  })
})
