import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  build: { outDir: "../../dist/web", emptyOutDir: true },
  // `npm run dev:web` proxies the API to `npm run dev:server`.
  server: { proxy: { "/api": "http://127.0.0.1:8080" } },
});
