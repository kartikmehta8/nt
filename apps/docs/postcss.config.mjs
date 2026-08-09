/**
 * @file PostCSS configuration for the documentation design system.
 *
 * Enables the Tailwind transform consumed by the global site stylesheet. The
 * object is intentionally small because Next.js discovers it by filename and
 * passes it directly to PostCSS during development and production builds.
 */

export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
