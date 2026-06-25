import { defineConfig } from "vitest/config";

// Vitest reads this in preference to vite.config.ts (which is tuned for Tauri
// dev). Frontend unit tests run in a jsdom DOM with globals enabled.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/**/*.test.ts"],
  },
});
