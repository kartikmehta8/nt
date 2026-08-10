/**
 * @file Normalized Fumadocs content source used by pages, navigation, and search.
 *
 * Bridges the generated MDX adapter's function-or-array `files` contract to the
 * installed Fumadocs core loader while retaining its inferred page-data types.
 * This compatibility shim is the single source behind route lookup, page trees,
 * static parameters, and the search endpoint.
 */

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
  source: normalizedSource as typeof mdxSource,
});
