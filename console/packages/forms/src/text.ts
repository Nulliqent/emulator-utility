const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * Model documentation is HTML from third-party models. This reduces it to plain text: no tag survives, so the
 * result is safe to render as a React text child. Never feed the output to innerHTML.
 */
export function plainText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/(p|li|div|h\d|tr|dt|dd)\s*>|<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : "";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\r\f]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const MAX_TESTED = 2048;
const compiled = new Map<string, RegExp | null>();

// A quantified group that itself holds a quantifier, such as (a+)+ or (.*)*: the classic catastrophic shape.
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/;

function compile(pattern: string): RegExp | null {
  const hit = compiled.get(pattern);
  if (hit !== undefined) return hit;
  let re: RegExp | null = null;
  if (!NESTED_QUANTIFIER.test(pattern)) {
    try {
      re = new RegExp(pattern, "u");
    } catch {
      try {
        re = new RegExp(pattern);
      } catch {
        re = null;
      }
    }
  }
  if (compiled.size > 5000) compiled.clear();
  compiled.set(pattern, re);
  return re;
}

/**
 * Tests a model `@pattern` against a string. Patterns are advisory: `undefined` means "could not tell" (the pattern
 * does not compile here, looks like it could backtrack catastrophically, or the input is too long to test safely).
 */
export function testPattern(pattern: string, value: string): boolean | undefined {
  if (value.length > MAX_TESTED) return undefined;
  const re = compile(pattern);
  if (!re) return undefined;
  try {
    return re.test(value);
  } catch {
    return undefined;
  }
}
