// Flat config. Enforza aislamiento entre capas (Modular Monolith + Vertical Slices).
// Ver `architecture.md` § "Reglas de aislamiento entre módulos".
import { FlatCompat } from '@eslint/eslintrc'
import tseslint from 'typescript-eslint'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const compat = new FlatCompat({ baseDirectory: __dirname })

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      '**/*.config.{js,cjs,mjs,ts}',
      'handoff/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // Vars/args prefijadas con `_` son stubs intencionales (ver _template/).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*/!(public)', '@/features/*/!(public)/**'],
              message:
                'Una feature solo puede importarse vía su `public.ts`. Acceder a archivos internos rompe el aislamiento (ver architecture.md).',
            },
          ],
        },
      ],
      // Impedir relative imports que escalen fuera del slice
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/^\\.\\.\\/\\.\\.\\//]',
          message:
            'Los imports relativos con más de un `../` suelen romper el aislamiento. Usar alias (@/features, @/shared, @/db).',
        },
        // Prohíbe construir URLs cross-subdomain ad-hoc. Detecta el patrón
        // `${proto}://${slug}.${appDomain}/...`: un TemplateLiteral con 2+
        // expressions interpoladas que contiene un quasi con `://` y otro
        // quasi que empieza con `.` (la separación slug.appDomain). La
        // fuente única para construir estos URLs vive en
        // `@/shared/lib/app-url` (placeUrl/inboxUrl/apexUrl) — centralizar
        // evita drift de protocolo, dominio dev vs prod y trailing slashes.
        {
          selector:
            'TemplateLiteral[expressions.length>=2]:has(TemplateElement[value.raw=/:\\/\\//]):has(TemplateElement[value.raw=/^\\.[a-z0-9._/-]*$/i])',
          message:
            'No construyas URLs cross-subdomain ad-hoc (`${proto}://${slug}.${appDomain}/...`). Usá los helpers de `@/shared/lib/app-url` (placeUrl/inboxUrl/apexUrl).',
        },
      ],
    },
  },
  {
    // `app-url.ts` ES la fuente única que construye URLs cross-subdomain;
    // por diseño usa el patrón `${proto}://${slug}.${appDomain}/...` que
    // la regla `no-restricted-syntax` de arriba prohíbe en el resto del repo.
    // Re-declaramos la regla acá conservando sólo el selector de imports
    // relativos profundos (sigue aplicando) y omitimos el de URLs.
    files: ['src/shared/lib/app-url.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/^\\.\\.\\/\\.\\.\\//]',
          message:
            'Los imports relativos con más de un `../` suelen romper el aislamiento. Usar alias (@/features, @/shared, @/db).',
        },
      ],
    },
  },
  {
    // `shared/` nunca importa de `features/`. Es un primitivo agnóstico.
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*', '@/features/*/**'],
              message: '`shared/` es agnóstico del dominio y no puede importar de `features/`.',
            },
          ],
        },
      ],
    },
  },
  {
    // Supabase admin client (service-role) solo se importa desde server contexts.
    files: ['src/shared/lib/supabase/admin.ts'],
    rules: {},
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // Prohibir importar `admin.ts` fuera de rutas server-only o slices server/
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/shared/lib/supabase/admin',
              message:
                'El cliente service-role solo puede usarse en Server Actions, Route Handlers o `features/*/server/`.',
            },
          ],
          patterns: [
            {
              group: ['@/features/*/!(public)', '@/features/*/!(public)/**'],
              message:
                'Una feature solo puede importarse vía su `public.ts`. Acceder a archivos internos rompe el aislamiento.',
            },
          ],
        },
      ],
    },
  },
  {
    // Excepciones donde el admin client sí puede vivir
    files: [
      'src/app/api/**/*.{ts,tsx}',
      'src/app/**/actions.ts',
      'src/app/**/dev-actions.ts',
      'src/app/auth/callback/route.ts',
      'src/features/*/server/**/*.{ts,tsx}',
      'src/shared/lib/supabase/admin.ts',
      'src/middleware.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*/!(public)', '@/features/*/!(public)/**'],
              message:
                'Una feature solo puede importarse vía su `public.ts`. Acceder a archivos internos rompe el aislamiento.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.test.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
