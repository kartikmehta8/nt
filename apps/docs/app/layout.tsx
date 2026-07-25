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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        {/* Light theme only — next-themes disabled so no `dark` class is applied. */}
        <RootProvider theme={{ enabled: false }}>{children}</RootProvider>
      </body>
    </html>
  );
}
