/**
 * @file Component registry used by every compiled documentation MDX page.
 *
 * Extends Fumadocs defaults with the Steps and Tabs primitives used by guides,
 * then applies page-local overrides last so normal MDX customization semantics
 * are preserved.
 */

import defaultMdxComponents from "fumadocs-ui/mdx";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import type { MDXComponents } from "mdx/types";

/**
 * Merges the shared Fumadocs component map with caller-provided MDX overrides.
 * @param components Optional component overrides supplied by a rendered page.
 * @returns The complete Fumadocs, Steps/Tabs, and page-local component map.
 */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Step,
    Steps,
    Tab,
    Tabs,
    ...components,
  };
}
