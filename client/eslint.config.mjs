import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["out/**", "dist/**", "release/**", "node_modules/**", "*.tsbuildinfo"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["scripts/**/*.{mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
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
      "client/main/codex/**",
      "main/gateway/**",
      "client/main/gateway/**",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
