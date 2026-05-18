// Next 16: eslint-config-next exporta flat config nativo (ADR-0013). El patrón
// FlatCompat/compat.extends del scaffold de Next 15 era legacy eslintrc y
// rompe con v16 ("circular structure"); se spreadean los arrays flat directo.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
