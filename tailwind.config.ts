import type { Config } from 'tailwindcss'
import tailwindcssAnimate from 'tailwindcss-animate'

/**
 * Tailwind solo para layout/spacing/typography.
 * Los colores del place viven como CSS variables (ver `docs/theming.md`),
 * no como clases `bg-*` hardcoded.
 *
 * F.G rebrand (2026-04-27): se agregaron utilities para los nuevos
 * tokens del handoff (`bg-surface`, `rounded-card`, `font-title`,
 * etc.). Los aliases legacy `place-*` siguen disponibles. Ver
 * `docs/decisions/2026-04-27-design-handoff-rebrand.md`.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Tipografía del producto, no customizable por place (ver
        // theming.md § "Lo que NO es configurable"). Los aliases
        // serif/sans se mantienen para legacy; title/body/mono son los
        // nombres canónicos del design system.
        serif: ['var(--font-fraunces)', 'Fraunces', 'ui-serif', 'Georgia', 'serif'],
        sans: ['var(--font-inter)', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        title: ['var(--title-font)'],
        body: ['var(--body-font)'],
        mono: ['var(--mono-font)'],
      },
      colors: {
        // ── Tokens nuevos del handoff (canónicos). ──
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        soft: 'var(--soft)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        border: 'var(--border)',
        accent: 'var(--accent)',
        'accent-soft': 'var(--accent-soft)',
        dot: 'var(--dot)',
        // Member palette (usable como `bg-member-1` etc.; típicamente
        // se accede vía Avatar primitive).
        'member-1': 'var(--member-1)',
        'member-2': 'var(--member-2)',
        'member-3': 'var(--member-3)',
        'member-4': 'var(--member-4)',
        'member-5': 'var(--member-5)',
        'member-6': 'var(--member-6)',
        'member-7': 'var(--member-7)',
        'member-8': 'var(--member-8)',

        // ── Aliases place-* (backward-compat). Migran gradualmente. ──
        place: 'var(--place-bg)',
        'place-card': 'var(--place-card-bg)',
        'place-card-soft': 'var(--place-card-bg-soft)',
        'place-text': 'var(--place-text)',
        'place-text-medium': 'var(--place-text-medium)',
        'place-text-soft': 'var(--place-text-soft)',
        'place-text-whisper': 'var(--place-text-whisper)',
        'place-link': 'var(--place-link)',
        'place-link-underline': 'var(--place-link-underline)',
        'place-divider': 'var(--place-divider)',
        'place-mark-bg': 'var(--place-mark-bg)',
        'place-mark-fg': 'var(--place-mark-fg)',
      },
      borderRadius: {
        card: 'var(--radius-card)',
      },
      spacing: {
        pad: 'var(--pad)',
      },
    },
  },
  plugins: [
    // tailwindcss-animate (2026-05-12): activa utilities `animate-in`,
    // `animate-out`, `slide-in-from-*`, `fade-in/out`, etc. usadas por:
    //  - `<EditPanel>` (slide-in-from-right desktop, slide-in-from-bottom mobile)
    //  - `<DropdownMenu>` (fade-in/out)
    //  - `<CommunitySwitcher>` (slide-in-from-top + fade-in)
    // Pre-2026-05-12 estas clases eran no-op silenciosas — los componentes
    // aparecían sin animación.
    tailwindcssAnimate,
  ],
}

export default config
