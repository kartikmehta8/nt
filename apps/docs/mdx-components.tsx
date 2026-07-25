import defaultMdxComponents from "fumadocs-ui/mdx";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import type { MDXComponents } from "mdx/types";

/**
 * Merge Fumadocs' default MDX components (Cards, Callouts, code blocks, …) with
 * the extra components the docs use (Steps/Step, Tabs/Tab) and any per-page
 * overrides. Used by the docs page renderer.
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
