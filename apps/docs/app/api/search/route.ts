/**
 * @file Static documentation-search route.
 *
 * Builds the Fumadocs search handler from the same normalized MDX source used
 * by page rendering, keeping navigation and search results in one content tree.
 */

import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

/**
 * Search request handler generated from the static documentation source and
 * consumed by the Fumadocs search dialog.
 */
export const { GET } = createFromSource(source);
