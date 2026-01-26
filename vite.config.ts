import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    svelte(),
    nodePolyfills({
      // Only include polyfills needed by @apidevtools/json-schema-ref-parser
      include: ["buffer", "path"],
    }),
  ],
  define: {
    __READ_ONLY__: JSON.stringify(process.env.ENGRAMMA_READ_ONLY === "true"),
  },
  build: {
    // auto prefixing height: stretch breaks the app
    cssMinify: false,
  },
});
