import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

/** Static search index built from the docs source, served to the client dialog. */
export const { GET } = createFromSource(source);
