import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  // The Worker runs inside the dev server in workerd, so `/api` and the
  // markdown views are handled for real rather than proxied.
  plugins: [solid(), cloudflare()],
  build: {
    emptyOutDir: true,
    target: "es2022",
  },
});
