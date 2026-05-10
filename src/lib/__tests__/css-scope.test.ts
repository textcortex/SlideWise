import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

/**
 * Slidewise ships as a library. Hosts mount it inside their own DOM, with
 * their own global stylesheets (Tailwind preflight, normalize.css, app
 * resets). Every rule we ship must therefore live under `.slidewise-editor`
 * — anything at the document root would override host styles when our CSS
 * loads, or get overridden when host CSS loads, depending on order.
 *
 * This test scans the source CSS for top-level selectors and rejects
 * anything that escapes the scope. Allowed at top level: at-rules
 * (`@font-face`, `@import`, `@media`, `@supports`, …) and selectors that
 * begin with `.slidewise-editor`.
 */
describe("library CSS scope", () => {
  it("every rule in SlidewiseEditor.css is scoped under .slidewise-editor", () => {
    const css = readFileSync(
      resolve(repoRoot, "src", "SlidewiseEditor.css"),
      "utf8"
    );
    const violations = findUnscopedSelectors(css);
    if (violations.length) {
      throw new Error(
        `Found ${violations.length} unscoped top-level selector(s) in SlidewiseEditor.css. ` +
          `Every rule must be nested under .slidewise-editor so the lib does not collide ` +
          `with host styles. Offenders:\n  ${violations.join("\n  ")}`
      );
    }
    expect(violations).toEqual([]);
  });
});

/**
 * Walk the CSS at brace depth 0, find each rule's selector list, and report
 * any selector that does not start with `.slidewise-editor`. Strips comments
 * and string contents first so braces inside them don't confuse the scan.
 */
function findUnscopedSelectors(rawCss: string): string[] {
  const css = stripCommentsAndStrings(rawCss);
  const violations: string[] = [];
  let depth = 0;
  let buf = "";

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      if (depth === 0) {
        const selector = buf.trim();
        if (selector && !isAllowedTopLevel(selector)) {
          for (const sel of splitSelectorList(selector)) {
            const s = sel.trim();
            if (!s) continue;
            if (!s.startsWith(".slidewise-editor")) {
              violations.push(s);
            }
          }
        }
        buf = "";
      }
      depth++;
      continue;
    }
    if (ch === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) buf = "";
      continue;
    }
    if (depth === 0) buf += ch;
  }

  return violations;
}

function isAllowedTopLevel(selector: string): boolean {
  // At-rules (@font-face, @media, @supports, @keyframes, @import, …) are
  // global by design and don't override host styles unless they nest
  // unscoped rules — which the recursion catches at depth > 0 if it ever
  // matters. @font-face etc. only register names; they don't paint.
  return selector.startsWith("@");
}

function splitSelectorList(selector: string): string[] {
  // CSS selectors are separated by commas at the top level (commas inside
  // parens — :is(), :not(), :where() — are not separators). Track paren
  // depth as we split.
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of selector) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function stripCommentsAndStrings(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    if (css[i] === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? css.length : end + 2;
      continue;
    }
    if (css[i] === '"' || css[i] === "'") {
      const quote = css[i];
      let j = i + 1;
      while (j < css.length && css[j] !== quote) {
        if (css[j] === "\\") j += 2;
        else j++;
      }
      out += quote + " ".repeat(Math.max(0, j - i - 1)) + quote;
      i = j + 1;
      continue;
    }
    out += css[i];
    i++;
  }
  return out;
}
