import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Mirrors `backend/eslint.config.js` — same base, same float guards — with the React rules
 * added. The float restrictions are not stylistic: this app renders money that the backend
 * already computed exactly as decimal strings, so a float operation on one of those values is
 * a defect. `format.ts#toPlotNumber` is the one sanctioned conversion and is confined to
 * chart pixel math.
 */
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**", "src/components/ui/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat["recommended-latest"],
  {
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-refresh": reactRefresh },
    rules: {
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-restricted-globals": [
        "error",
        {
          name: "parseFloat",
          message: "No floats on money. The API already sent exact decimal strings.",
        },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "round", message: "No float rounding on money." },
        { object: "Number", property: "parseFloat", message: "No floats on money." },
      ],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "vitest.setup.ts"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: ["vite.config.ts", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
);
