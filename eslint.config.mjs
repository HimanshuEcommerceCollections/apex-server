// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "prisma/migrations/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // Enforce the shared-boundary import rule (docs/architecture/01 §"import-direction rule"):
  // shared/ and the pure pricing engine may import ONLY same-boundary files, node stdlib, and zod.
  {
    files: ["src/shared/**/*.ts", "src/modules/pricing/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/db/**",
                "**/config/**",
                "**/middleware/**",
                "**/utils/**",
                "**/enums/**",
                "**/modules/**",
                "@prisma/client",
              ],
              message:
                "Shared/engine code must not import app internals or Prisma types (see docs/architecture/01 import-direction rule). Keep it brand-neutral and extractable.",
            },
          ],
        },
      ],
    },
  },
);
