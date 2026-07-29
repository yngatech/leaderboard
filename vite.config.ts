import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
  server: {
    // `npm run dev` for fast UI iteration; proxy the API to `wrangler dev`.
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
