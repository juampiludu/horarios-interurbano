import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

export default defineConfig({
  // Published on GitHub Pages at https://juampiludu.github.io/horarios-interurbano/
  site: "https://juampiludu.github.io",
  base: "/horarios-interurbano",
  integrations: [preact()],
});
