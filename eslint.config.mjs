import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", "web-build/**"] },
  { ...js.configs.recommended, languageOptions: { globals: { module: "readonly", require: "readonly", process: "readonly" } } },
  ...tseslint.configs.recommended,
  { files: ["scripts/**/*.mjs"], languageOptions: { globals: { console: "readonly", fetch: "readonly", AbortSignal: "readonly" } } },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { console: "readonly", fetch: "readonly", URL: "readonly", setTimeout: "readonly", clearTimeout: "readonly" },
    },
    rules: { "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] },
  },
);
