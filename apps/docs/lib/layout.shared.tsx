/**
 * @file Navigation configuration shared by home and documentation layouts.
 *
 * Defines the NT wordmark, source link, and light-only theme behavior once so
 * route layouts cannot drift in branding or expose a nonfunctional dark toggle.
 */

import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

/**
 * Renders the logo component from its documented props.
 * @returns The accessible NT wordmark used in the shared navigation bar.
 */
function Logo() {
  return (
    <span className="nt-logo" aria-label="NT">
      <span className="nt-logo-mark">·nt</span>
    </span>
  );
}

/**
 * Returns navbar, theme, and source options shared by both site layouts.
 * @returns Navbar, theme, and source options shared by both site layouts.
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <Logo />,
      transparentMode: "top",
    },
    themeSwitch: { enabled: false },
    githubUrl: "https://github.com/kartikmehta8/nt",
  };
}
