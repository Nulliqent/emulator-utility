import type { UiShape } from "@console/model";
import type { ServiceOps } from "./catalog.ts";

/** Renders an SDK output as indented JSON. Dates, bytes and bigints have no JSON form, so they get a readable one. */
export function formatOutput(value: unknown): string {
  return JSON.stringify(
    value,
    (_k, v: unknown) => {
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Uint8Array) return `<${v.byteLength} bytes>`;
      if (typeof ReadableStream !== "undefined" && v instanceof ReadableStream) return "<stream>";
      return v;
    },
    2,
  );
}

/** Parses the textarea: the input must be a JSON object (every Operation input is a structure). */
export function parseInput(text: string): { ok: true; value: object } | { ok: false; message: string } {
  try {
    const value: unknown = JSON.parse(text.trim() === "" ? "{}" : text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, message: "The input must be a JSON object, for example {}." };
    }
    return { ok: true, value };
  } catch (e) {
    return { ok: false, message: `The input is not valid JSON: ${(e as Error).message}` };
  }
}

const NUMERIC = new Set(["byte", "short", "integer", "long", "float", "double", "bigInteger", "bigDecimal"]);

function placeholder(shapes: Record<string, UiShape>, target: string): unknown {
  const shape = shapes[target];
  if (!shape) return "";
  switch (shape.kind) {
    case "structure":
    case "union":
    case "map":
      return {};
    case "list":
      return [];
    case "enum":
      return "";
    case "scalar":
      return NUMERIC.has(shape.scalar) ? 0 : shape.scalar === "boolean" ? false : "";
  }
}

/** The input to start from: the Operation's required top-level members, each a placeholder of its shape's kind. */
export function skeletonInput(ops: ServiceOps | undefined, op: string): string {
  const inputId = ops && Object.hasOwn(ops.operations, op) ? ops.operations[op]?.input : undefined;
  const shape = inputId ? ops?.shapes[inputId] : undefined;
  const out: Record<string, unknown> = {};
  if (shape?.kind === "structure") {
    for (const [name, m] of Object.entries(shape.members)) if (m.required) out[name] = placeholder(ops!.shapes, m.target);
  }
  return JSON.stringify(out, null, 2);
}

export const byteLength = (s: string): number => new TextEncoder().encode(s).byteLength;
