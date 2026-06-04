import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off"
    }
  },
  {
    // Generated / vendored output is never hand-edited, so linting it only
    // produces noise (the Prisma client ships minified `require()` bundles).
    ignores: [
      ".next/**",
      "node_modules/**",
      "public/**",
      "next-env.d.ts",
      "lib/generated/**"
    ]
  }
];

export default eslintConfig;
