/**
 * @file Public landing page for the NT language and toolchain.
 *
 * Presents the product value, installation entry points, editor preview, and
 * documentation call to action using static React content. Runtime behavior is
 * confined to the isolated code-preview component.
 */

import Link from "next/link";
import type { Metadata } from "next";
import { CodeEditor } from "./code-editor";
import { FeatureGrid } from "./feature-grid";
import { VSCodeLogo, CursorLogo, NpmLogo, TerminalIcon, GitHubLogo } from "@/components/logos";

export const metadata: Metadata = {
  title: "NT — a language for agent ecosystems",
  description:
    "Describe models, agents, MCP servers, sandboxes, tools, skills, and workflows in one clean .nt file. One command brings the whole ecosystem up.",
};

/**
 * Renders the home page component from its documented props.
 * @returns The static NT marketing landing page and its primary navigation paths.
 */
export default function HomePage() {
  return (
    <main className="nt-home">
      <section className="nt-hero nt-section">
        <div className="nt-grid-overlay" aria-hidden />

        <div className="nt-hero-copy">
          <h1 className="nt-reveal" data-delay="1">
            A language for agent ecosystems
          </h1>

          <p className="nt-lead nt-reveal" data-delay="2">
            Describe models, agents, MCP servers, sandboxes, tools, skills, and workflows in one
            clean <code>.nt</code> file. One command brings it all up.
          </p>

          <div className="nt-cta-row nt-reveal" data-delay="3">
            <Link href="/docs" className="nt-btn nt-btn-primary">
              Get started →
            </Link>
          </div>
        </div>

        <div className="nt-hero-cards">
          <a
            className="nt-hcard nt-reveal"
            data-delay="1"
            href="https://marketplace.visualstudio.com/items?itemName=KartikMehta.nt-agent-lang"
            target="_blank"
            rel="noreferrer"
          >
            <span className="nt-hcard-logo">
              <VSCodeLogo size={30} />
            </span>
            <span className="nt-hcard-body">
              <span className="nt-hcard-title">VS Code Extension</span>
              <span className="nt-hcard-sub">Highlighting &amp; IntelliSense</span>
            </span>
            <span className="nt-hcard-arrow">↗</span>
          </a>

          <a
            className="nt-hcard nt-reveal"
            data-delay="2"
            href="https://open-vsx.org/extension/KartikMehta/nt-agent-lang"
            target="_blank"
            rel="noreferrer"
          >
            <span className="nt-hcard-logo">
              <CursorLogo size={30} />
            </span>
            <span className="nt-hcard-body">
              <span className="nt-hcard-title">Other IDEs</span>
              <span className="nt-hcard-sub">Cursor, Windsurf, VSCodium</span>
            </span>
            <span className="nt-hcard-arrow">↗</span>
          </a>

          <a
            className="nt-hcard nt-reveal"
            data-delay="3"
            href="https://www.npmjs.com/package/@age.nt/nt"
            target="_blank"
            rel="noreferrer"
          >
            <span className="nt-hcard-logo">
              <NpmLogo size={30} />
            </span>
            <span className="nt-hcard-body">
              <span className="nt-hcard-title">npm Package</span>
              <span className="nt-hcard-sub nt-mono">@age.nt/nt</span>
            </span>
            <span className="nt-hcard-arrow">↗</span>
          </a>

          <a
            className="nt-hcard nt-reveal"
            data-delay="4"
            href="https://github.com/kartikmehta8/nt"
            target="_blank"
            rel="noreferrer"
          >
            <span className="nt-hcard-logo">
              <GitHubLogo size={30} />
            </span>
            <span className="nt-hcard-body">
              <span className="nt-hcard-title">GitHub</span>
              <span className="nt-hcard-sub">Source, issues &amp; stars</span>
            </span>
            <span className="nt-hcard-arrow">↗</span>
          </a>

          <Link
            className="nt-hcard nt-hcard-wide nt-reveal"
            data-delay="5"
            href="/docs/installation"
          >
            <span className="nt-hcard-logo">
              <TerminalIcon size={30} />
            </span>
            <span className="nt-hcard-body">
              <span className="nt-hcard-title">Install the CLI</span>
              <span className="nt-hcard-sub">Requirements &amp; setup</span>
            </span>
            <span className="nt-hcard-arrow">→</span>
          </Link>
        </div>
      </section>

      <section className="nt-section" style={{ marginTop: "clamp(3rem,7vw,5rem)" }}>
        <div className="nt-hero-editor">
          <CodeEditor />
        </div>
      </section>

      <section className="nt-section" style={{ marginTop: "clamp(4rem,9vw,6.5rem)" }}>
        <FeatureGrid />
      </section>

      <section className="nt-section nt-closing">
        <div className="nt-term nt-reveal" aria-hidden>
          <div className="nt-term-bar">
            <i />
            <i />
            <i />
            <span>zsh — nt</span>
          </div>
          <div className="nt-term-body">
            <div className="nt-term-line" style={{ animationDelay: "0ms" }}>
              <span className="p">$</span> npm i -g @age.nt/nt
            </div>
            <div className="nt-term-line" style={{ animationDelay: "120ms" }}>
              <span className="dim"> + @age.nt/nt · ready</span>
            </div>
            <div className="nt-term-line" style={{ animationDelay: "260ms" }}>
              <span className="p">$</span> nt setup
            </div>
            <div className="nt-term-line" style={{ animationDelay: "380ms" }}>
              <span className="dim"> + age.nt + config.nt · 2 .nt file(s) OK</span>
            </div>
            <div className="nt-term-line" style={{ animationDelay: "520ms" }}>
              <span className="p">$</span> nt run age <span className="fl">-m</span>{" "}
              <span className="s">&quot;bought the first iPhone at 22&quot;</span>
            </div>
            <div className="nt-term-line" style={{ animationDelay: "660ms" }}>
              <span className="dim"> age → researcher → history.search_events → current_year</span>
            </div>
            <div className="nt-term-line" style={{ animationDelay: "800ms" }}>
              <span className="dim">{"{"}</span> <span className="k">age</span>:{" "}
              <span className="n">39</span>, <span className="k">reason</span>:{" "}
              <span className="s">&quot;iPhone launched in 2007&quot;</span>{" "}
              <span className="dim">{"}"}</span>
            </div>
            <div className="nt-term-line" style={{ animationDelay: "940ms" }}>
              <span className="p">$</span>
              <span className="nt-term-caret" />
            </div>
          </div>
        </div>

        <p className="nt-closing-text nt-reveal">
          Install the CLI and run your first agent in minutes.{" "}
          <Link href="/docs/first-agent">Build your first agent →</Link>
        </p>
      </section>

      <footer className="nt-footer">
        <p>
          NT is a declarative <code>.nt</code> language and engine for agent ecosystems. Built by{" "}
          <a href="https://mrmehta.in" target="_blank" rel="noreferrer">
            @mehta
          </a>
          .
        </p>
      </footer>
    </main>
  );
}
