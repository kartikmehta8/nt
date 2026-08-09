/**
 * @file Route layout for the public NT landing page.
 *
 * Applies the shared navigation configuration through Fumadocs' home layout
 * while leaving page-specific marketing content to the route component.
 */

import type { ReactNode } from "react";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "@/lib/layout.shared";

/**
 * Renders the layout component from its documented props.
 * @param children Landing-page content rendered inside the shared shell.
 * @returns The Fumadocs home layout for the route.
 */
export default function Layout({ children }: { children: ReactNode }) {
  return <HomeLayout {...baseOptions()}>{children}</HomeLayout>;
}
