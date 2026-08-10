/**
 * @file Dynamic documentation page renderer and metadata generator.
 *
 * Resolves a slug through the normalized Fumadocs source, renders its compiled
 * MDX with relative-link support, enumerates static paths, and derives social
 * metadata from the same page record. Missing content consistently routes to
 * Next.js `notFound` rather than rendering a partial page.
 */

import { source } from "@/lib/source";
import { DocsPage, DocsBody, DocsDescription, DocsTitle } from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { getMDXComponents } from "@/mdx-components";
import type { Metadata } from "next";

/**
 * Renders the page component from its documented props.
 * @param props Asynchronous route parameters containing an optional docs slug.
 * @returns The resolved Fumadocs page, or the route-level not-found response.
 */
export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDXContent = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDXContent
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

/**
 * Returns every documentation slug that Next.js should generate statically.
 * @returns Every documentation slug that Next.js should generate statically.
 */
export async function generateStaticParams() {
  return source.generateParams();
}

/**
 * Returns title, description, and social-card metadata derived from that page.
 * @param props Asynchronous route parameters for the documentation page.
 * @returns Title, description, and social-card metadata derived from that page.
 */
export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const title = page.data.title;
  const description = page.data.description;
  const ogUrl = `/og/${params.slug?.length ? params.slug.join("/") : "index"}.png`;

  return {
    title,
    description,
    openGraph: {
      type: "article",
      title,
      description,
      images: [{ url: ogUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogUrl],
    },
  };
}
