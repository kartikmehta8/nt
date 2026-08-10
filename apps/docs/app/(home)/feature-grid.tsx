/**
 * @file Balanced landing-page feature grid for NT's core product benefits.
 *
 * Keeps the feature content and responsive card structure independent from the
 * larger home page so the section can evolve without bloating the route. Each
 * card pairs a numbered product category with a concise, scannable explanation.
 */

import { CommandIcon, FileCodeIcon, SparkleIcon, TerminalIcon } from "@/components/logos";

const FEATURES = [
  {
    icon: <FileCodeIcon />,
    label: "Language",
    title: "Write agents, don't wire them",
    body: "Declare agents, MCP servers, tools, sandboxes, and workflows in a clean, YAML-like format. No boilerplate, no glue code.",
  },
  {
    icon: <CommandIcon />,
    label: "CLI",
    title: "One CLI to run it all",
    body: "Validate, graph, run and chat. A single nt command brings your whole ecosystem up against a live model.",
  },
  {
    icon: <TerminalIcon size={22} />,
    label: "MCP",
    title: "Connect MCP servers safely",
    body: "Use local or remote MCP tools with fingerprinted trust, explicit selection, schema validation, and per-call approvals.",
  },
  {
    icon: <SparkleIcon />,
    label: "Authoring",
    title: "As easy as writing English",
    body: "Describe what an agent should do in plain language. The engine wires the model, tools and delegation for you.",
  },
];

/**
 * Renders the feature introduction and responsive two-by-two card composition.
 * @returns The complete product-benefit section used by the landing page.
 */
export function FeatureGrid() {
  return (
    <>
      <div className="nt-feature-heading nt-reveal">
        <span className="nt-kicker">Why NT</span>
        <h2 className="nt-h2">One language for the whole agent stack.</h2>
        <p className="nt-sub">
          Keep the model, tools, MCP connections, delegation, and runtime behavior together in a
          project you can read at a glance.
        </p>
      </div>

      <div className="nt-features">
        {FEATURES.map((feature, index) => (
          <article
            key={feature.title}
            className="nt-card nt-reveal"
            data-delay={String((index % 5) + 1)}
          >
            <div className="nt-card-head">
              <div className="nt-card-ico">{feature.icon}</div>
              <span className="nt-card-label">
                {String(index + 1).padStart(2, "0")} / {feature.label}
              </span>
            </div>
            <div className="nt-card-copy">
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
