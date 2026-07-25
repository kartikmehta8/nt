import { docs } from "@/.source";
import { loader } from "fumadocs-core/source";

/**
 * Bridge a version mismatch between fumadocs-mdx and fumadocs-core: the MDX
 * runtime exposes `files` as a function, while the loader in this core version
 * expects an array. Normalise to whichever the loader needs.
 */
const mdxSource = docs.toFumadocsSource();
const normalizedSource = {
  ...mdxSource,
  files:
    typeof mdxSource.files === "function"
      ? (mdxSource.files as () => unknown[])()
      : mdxSource.files,
};

/**
 * The content source that powers the docs tree, page lookup, and search.
 * Backed by the MDX files under `content/docs`, served under `/docs`.
 */
export const source = loader({
  baseUrl: "/docs",
  // Cast back to the MDX source type so the loader keeps inferring the typed
  // page data (body, toc, structuredData, …) from the generated collection.
  source: normalizedSource as typeof mdxSource,
});
