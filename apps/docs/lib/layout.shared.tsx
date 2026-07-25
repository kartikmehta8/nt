import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

/** The NT wordmark used in the navbar. */
function Logo() {
  return (
    <span className="nt-logo" aria-label="NT">
      <span className="nt-logo-mark">·nt</span>
    </span>
  );
}

/**
 * Options shared by the home layout and the docs layout — the navbar title,
 * links, and the GitHub source link.
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <Logo />,
      transparentMode: "top",
    },
    // Light-theme only — hide the (dead) dark-mode toggle.
    themeSwitch: { enabled: false },
    githubUrl: "https://github.com/kartikmehta8/nt",
  };
}
