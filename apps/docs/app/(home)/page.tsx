import Link from "next/link";
import type { Metadata } from "next";
import { CodeEditor } from "./code-editor";
import {
  VSCodeLogo,
  CursorLogo,
  NpmLogo,
  TerminalIcon,
  GitHubLogo,
  FileCodeIcon,
  CommandIcon,
  SparkleIcon,
} from "@/components/logos";

export const metadata: Metadata = {
  title: "NT — a language for agent ecosystems",
  description:
    "Describe your models, agents, subagents, sandboxes, tools, skills and workflows in one clean .nt file. One command brings the whole ecosystem up.",
};

const FEATURES = [
  {
    icon: <FileCodeIcon />,
    title: "Write agents, don't wire them",
    body: "Declare agents, tools, sandboxes and workflows in a clean, YAML-like format. No boilerplate, no glue code.",
  },
  {
    icon: <CommandIcon />,
    title: "One CLI to run it all",
    body: "Validate, graph, run and chat. A single nt command brings your whole ecosystem up against a live model.",
  },
  {
    icon: <SparkleIcon />,
    title: "As easy as writing English",
    body: "Describe what an agent should do in plain language. The engine wires the model, tools and delegation for you.",
  },
];

export default function HomePage() {
  return (
    <main className="nt-home">
      {/* ---- Hero: centered copy above a full-width editor ---- */}
      <section className="nt-hero nt-section">
        <div className="nt-grid-overlay" aria-hidden />

        <div className="nt-hero-copy">
          <h1 className="nt-reveal" data-delay="1">
            A language for agent ecosystems
          </h1>

          <p className="nt-lead nt-reveal" data-delay="2">
            Describe your models, agents, subagents, sandboxes, tools, skills and workflows in one
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

      {/* ---- Editor showcase ---- */}
      <section className="nt-section" style={{ marginTop: "clamp(3rem,7vw,5rem)" }}>
        <div className="nt-hero-editor">
          <CodeEditor />
        </div>
      </section>

      {/* ---- Minimal features ---- */}
      <section className="nt-section" style={{ marginTop: "clamp(4rem,9vw,6.5rem)" }}>
        <div className="nt-features">
          {FEATURES.map((f, i) => (
            <article key={f.title} className="nt-card nt-reveal" data-delay={String((i % 5) + 1)}>
              <div className="nt-card-ico">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---- Closing: terminal + a link to the quickstart ---- */}
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
              <span className="p">$</span> nt run age <span className="fl">-m</span>{" "}
              <span className="s">&quot;bought the first iPhone at 22&quot;</span>
            </div>
            <div className="nt-term-line" style={{ animationDelay: "420ms" }}>
              <span className="dim"> age → researcher → current_year</span>
            </div>
            <div className="nt-term-line" style={{ animationDelay: "580ms" }}>
              <span className="dim">{"{"}</span> <span className="k">age</span>:{" "}
              <span className="n">39</span>, <span className="k">reason</span>:{" "}
              <span className="s">&quot;iPhone launched in 2007&quot;</span>{" "}
              <span className="dim">{"}"}</span>
            </div>
            <div className="nt-term-line" style={{ animationDelay: "720ms" }}>
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

      {/* ---- Footer ---- */}
      <footer className="nt-footer">
        <p>
          NT is a declarative <code>.nt</code> language and engine for agent ecosystems, built on
          top of{" "}
          <a href="https://flueframework.com" target="_blank" rel="noreferrer">
            Flue Framework
          </a>
          . Built by{" "}
          <a href="https://mrmehta.in" target="_blank" rel="noreferrer">
            @mehta
          </a>
          .
        </p>
      </footer>
    </main>
  );
}
