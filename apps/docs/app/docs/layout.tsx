/**
 * @file Shared layout for every documentation route.
 *
 * Combines the common navigation options with the generated Fumadocs page tree
 * so sidebar structure, breadcrumbs, and content navigation follow MDX metadata.
 */

import type { ReactNode } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

/**
 * Renders the layout component from its documented props.
 * @param children Resolved documentation-page content.
 * @returns The documentation shell with its generated navigation tree.
 */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout {...baseOptions()} tree={source.pageTree} sidebar={{ defaultOpenLevel: 1 }}>
      {children}
    </DocsLayout>
  );
}
