import { defineConfig, defineDocs } from "fumadocs-mdx/config";

export const docs = defineDocs({
  dir: "content/docs",
});

export default defineConfig({
  mdxOptions: {
    // Shiki themes — light-only site, so both slots use a light theme.
    rehypeCodeOptions: {
      themes: {
        light: "github-light",
        dark: "github-light",
      },
    },
  },
});
