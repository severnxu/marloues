import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["out/**", "dist/**", "release/**", "node_modules/**", "*.tsbuildinfo"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-unused-vars": "off",
      "prefer-const": "warn",
      "no-control-regex": "warn",
      "no-case-declarations": "warn",
      "no-empty": "warn",
      "no-useless-assignment": "warn",
    },
  },
  {
    files: [
      "main/codex/**",
      "main/gateway/**",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
