import type { MetadataRoute } from "next";

/** The web app manifest — name, colors, and icons for installs and mobile. */
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
