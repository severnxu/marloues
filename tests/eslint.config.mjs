import clientConfig from "../client/eslint.config.mjs";

export default [
  ...clientConfig,
  {
    files: ["**/*.{mjs,cjs}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-undef": "off",
    },
  },
];
