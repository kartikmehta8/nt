/**
 * @file Build-time Open Graph image generator. Reads the frontmatter of every
 * docs page, renders a branded 1200x630 PNG per page (plus a default site card)
 * into `public/og/`, and exits. The pages reference these static files, so no
 * images are generated at request time.
 */

import { ImageResponse } from "next/dist/compiled/@vercel/og/index.node.js";
import { createElement as h } from "react";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const DOCS_DIR = join(ROOT, "content/docs");
const OUT_DIR = join(ROOT, "public/og");

const LOGO = `data:image/png;base64,${readFileSync(join(ROOT, "public/logo.png")).toString("base64")}`;
const INK = "#0a0a0a";
const MUTED = "#6b7280";
const LINE = "rgba(0,0,0,0.05)";

interface Card {
  out: string;
  title: string;
  description: string;
  kicker: string;
}

/**
 * @param file An `.mdx` file path.
 * @returns The `title` and `description` from its frontmatter.
 */
function frontmatter(file: string): { title: string; description: string } {
  const src = readFileSync(file, "utf8");
  const block = /^---\n([\s\S]*?)\n---/.exec(src)?.[1] ?? "";
  const read = (key: string) => {
    const m = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(block);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  };
  return { title: read("title"), description: read("description") };
}

/**
 * @param dir A directory to walk.
 * @returns Every `.mdx` file under it, recursively.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return name.endsWith(".mdx") ? [full] : [];
  });
}

/**
 * @param slug The page slug segments.
 * @returns The section label shown as the card kicker.
 */
function kickerFor(slug: string[]): string {
  if (slug[0] === "guides") return "How-to guide";
  if (slug[0] === "reference") return "Reference";
  return "Documentation";
}

/**
 * @param card The card content.
 * @returns The React element rendered into the PNG.
 */
function template(card: Card) {
  return h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: "#ffffff",
        backgroundImage: `linear-gradient(${LINE} 1px, transparent 1px), linear-gradient(90deg, ${LINE} 1px, transparent 1px)`,
        backgroundSize: "40px 40px",
        fontFamily: "sans-serif",
      },
    },
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: 18 } },
      h("img", { src: LOGO, width: 60, height: 60 }),
      h(
        "div",
        {
          style: {
            fontSize: 22,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: MUTED,
            fontWeight: 600,
          },
        },
        card.kicker,
      ),
    ),
    h(
      "div",
      { style: { display: "flex", flexDirection: "column" } },
      h(
        "div",
        {
          style: {
            fontSize: card.title.length > 30 ? 66 : 78,
            fontWeight: 800,
            letterSpacing: "-0.035em",
            lineHeight: 1.02,
            color: INK,
            maxWidth: 1040,
          },
        },
        card.title,
      ),
      card.description
        ? h(
            "div",
            {
              style: {
                marginTop: 24,
                fontSize: 32,
                lineHeight: 1.35,
                color: MUTED,
                maxWidth: 880,
              },
            },
            card.description,
          )
        : null,
    ),
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: `1px solid ${LINE}`,
          paddingTop: 28,
        },
      },
      h(
        "div",
        { style: { display: "flex", fontSize: 26, color: INK, fontWeight: 700 } },
        "a language for agent ecosystems",
      ),
      h(
        "div",
        {
          style: {
            display: "flex",
            fontSize: 24,
            color: MUTED,
            fontFamily: "monospace",
          },
        },
        "npm i -g @age.nt/nt",
      ),
    ),
  );
}

/**
 * @param card The card to render.
 * @returns Nothing; writes the PNG to disk.
 */
async function write(card: Card): Promise<void> {
  const res = new ImageResponse(template(card), { width: 1200, height: 630 });
  const buf = Buffer.from(await res.arrayBuffer());
  const dest = join(OUT_DIR, card.out);
  mkdirSync(join(dest, ".."), { recursive: true });
  writeFileSync(dest, buf);
}

const cards: Card[] = [
  {
    out: "default.png",
    title: "A language for agent ecosystems",
    description: "Describe your agents in one clean .nt file.",
    kicker: "NT",
  },
];

for (const file of walk(DOCS_DIR)) {
  const rel = relative(DOCS_DIR, file).replace(/\.mdx$/, "");
  const slug = rel === "index" ? [] : rel.split("/");
  const { title, description } = frontmatter(file);
  cards.push({
    out: `${slug.length ? slug.join("/") : "index"}.png`,
    title: title || "NT",
    description,
    kicker: kickerFor(slug),
  });
}

mkdirSync(OUT_DIR, { recursive: true });
await Promise.all(cards.map(write));
process.stdout.write(`[og] generated ${cards.length} images into public/og\n`);
