/**
 * @file Next.js build configuration for the Fumadocs application.
 *
 * Enables React strict mode and wraps the configuration with the MDX compiler
 * required to turn `content/docs` into typed pages.
 */

import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/**
 * Strict-mode application configuration passed through the MDX build wrapper.
 *
 * @type {import('next').NextConfig}
 */
const config = {
  reactStrictMode: true,
};

export default withMDX(config);
