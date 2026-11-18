import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Gateway serves the SPA under /__console/ (ARCHITECTURE 3.9).
export default defineConfig({
  base: "/__console/",
  plugins: [react()],
  server: {
    port: 5173,
    // changeOrigin rewrites Host to the Gateway's own, which its Host check requires.
    proxy: {
      "/__console/api": { target: "http://127.0.0.1:9300", changeOrigin: true },
      "/__admin": { target: "http://127.0.0.1:9300", changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
