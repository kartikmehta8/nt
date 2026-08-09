/**
 * @file Installable web-app manifest for the NT documentation site.
 *
 * Supplies stable product identity, theme colors, launch URL, and icon metadata
 * to browsers and mobile install surfaces.
 */

import type { MetadataRoute } from "next";

/**
 * Returns browser-install identity, launch, color, and icon metadata.
 * @returns Browser-install identity, launch, color, and icon metadata.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NT — a language for agent ecosystems",
    short_name: "NT",
    description:
      "Describe your models, agents, subagents, sandboxes, tools, skills and workflows in one clean .nt file.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: "/logo.png",
        sizes: "500x500",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
