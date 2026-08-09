/**
 * @file Branded not-found route for the NT website.
 *
 * Gives missing routes a concise explanation and direct recovery links to the
 * landing page and documentation index.
 */

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
};

/**
 * Renders the not found component from its documented props.
 * @returns The branded 404 page with home and documentation recovery links.
 */
export default function NotFound() {
  return (
    <main className="nt-notfound">
      <span className="nt-notfound-code">404</span>
      <h1 className="nt-notfound-title">This page ran off the workflow</h1>
      <p className="nt-notfound-text">
        The page you are looking for does not exist, or may have moved.
      </p>
      <div className="nt-notfound-cta">
        <Link href="/" className="nt-btn nt-btn-primary">
          Back home
        </Link>
        <Link href="/docs" className="nt-btn nt-btn-ghost">
          Read the docs
        </Link>
      </div>
    </main>
  );
}
