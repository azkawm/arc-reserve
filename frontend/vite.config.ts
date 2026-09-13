import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * Port 3000 is not a preference. The backend's `CORS_ORIGIN` defaults to
 * `http://localhost:3000` (see `backend/src/config.ts`), so moving the dev server off 3000
 * silently breaks every `/v1` read in the browser. `strictPort` makes that failure loud.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { port: 3000, strictPort: true },
  preview: { port: 3000, strictPort: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    // e2e/**/*.spec.ts are Playwright tests (playwright.config.ts), not Vitest's — both use a
    // *.spec.ts naming convention, and Vitest's default include glob would otherwise try to run
    // them itself and fail on Playwright's own test()/expect(). Extending configDefaults.exclude
    // rather than replacing it, so Vitest's own default excludes (node_modules, .git) still hold.
    exclude: [...configDefaults.exclude, "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/components/ui/**", "src/vite-env.d.ts", "src/main.tsx"],
    },
  },
});
