/**
 * @file Root HTML layout and site-wide metadata for agent-lang.xyz.
 *
 * Defines canonical website and social metadata, imports the global design
 * system, and installs the Fumadocs provider in intentionally light-only mode.
 * Route-specific layouts supply navigation and content structure beneath it.
 */

import "./global.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { RootProvider } from "fumadocs-ui/provider";

const title = "NT — a language for agent ecosystems";
const description =
  "NT is a small declarative language (.nt files) and runtime engine. Describe your models, agents, subagents, sandboxes, tools, skills and workflows in one clean format, and one command brings the whole ecosystem up.";

export const metadata: Metadata = {
  title: {
    default: title,
    template: "%s · NT",
  },
  description,
  applicationName: "NT",
  metadataBase: new URL("https://agent-lang.xyz"),
  openGraph: {
    type: "website",
    siteName: "NT",
    title,
    description,
    url: "/",
    images: [{ url: "/og/default.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og/default.png"],
  },
};

export const viewport = {
  themeColor: "#ffffff",
};

/**
 * Renders the root layout component from its documented props.
 * @param children Home or documentation route content.
 * @returns The root HTML document with the shared Fumadocs provider.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider theme={{ enabled: false }}>{children}</RootProvider>
      </body>
    </html>
  );
}
