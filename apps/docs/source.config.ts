/**
 * @file Fumadocs MDX collection and syntax-highlighting configuration.
 *
 * Indexes `content/docs` as the typed documentation collection and deliberately
 * uses the same GitHub light code theme for both renderer slots because the
 * product site does not expose dark mode.
 */

import { defineConfig, defineDocs } from "fumadocs-mdx/config";

export const docs = defineDocs({
  dir: "content/docs",
});

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      themes: {
        light: "github-light",
        dark: "github-light",
      },
    },
  },
});
