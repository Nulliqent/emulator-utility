import type { OpName, UiModel, UiShape, UiTraits } from "@console/model";
import type { Constraints, FieldSpec, FormHints, FormSpec, MemberSpec } from "./types.ts";

/** Nesting deeper than this many aggregates (structure, union, list, map) becomes a JSON field. */
export const MAX_DEPTH = 6;

const INTEGER = new Set(["byte", "short", "integer", "long", "bigInteger"]);
const NUMERIC = new Set([...INTEGER, "float", "double", "bigDecimal"]);

type Shapes = UiModel["shapes"];
type Docs = NonNullable<FormHints["docs"]>;
type Cache = Map<string, FieldSpec>;

// One cache per (shapes, docs) pair: a service's Operations share most of their shapes, and sharing makes a
// recursive model a graph of at most (shapes x depths) nodes instead of an exponentially large tree.
const caches = new WeakMap<Shapes, WeakMap<object, Cache>>();
const NO_DOCS = {};

function cacheFor(shapes: Shapes, docs: Docs | undefined): Cache {
  let byDocs = caches.get(shapes);
  if (!byDocs) caches.set(shapes, (byDocs = new WeakMap()));
  const key = docs ?? NO_DOCS;
  let c = byDocs.get(key);
  if (!c) byDocs.set(key, (c = new Map()));
  return c;
}

function constraints(...sources: (UiTraits | undefined)[]): Constraints & { sensitive?: true } {
  const out: Constraints & { sensitive?: true } = {};
  for (const t of sources) {
    if (!t) continue;
    if (t.length) out.length = t.length;
    if (t.range) out.range = t.range;
    if (t.pattern !== undefined) out.pattern = t.pattern;
    if (t.sensitive) out.sensitive = true;
  }
  return out;
}

function build(shapes: Shapes, docs: Docs | undefined, cache: Cache, id: string, memberTraits: UiTraits | undefined, depth: number): FieldSpec {
  const key = `${id}|${depth}|${memberTraits ? JSON.stringify(constraints(memberTraits)) : ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const shape: UiShape | undefined = Object.hasOwn(shapes, id) ? shapes[id] : undefined;
  const spec = buildUncached(shapes, docs, cache, id, shape, memberTraits, depth);
  cache.set(key, spec);
  return spec;
}

function members(shapes: Shapes, docs: Docs | undefined, cache: Cache, id: string, ms: Record<string, { target: string; required: boolean; traits?: UiTraits }>, depth: number): MemberSpec[] {
  const memberDocs = docs && Object.hasOwn(docs.shapes, id) ? docs.shapes[id]?.members : undefined;
  const list = Object.entries(ms).map(([name, m]): MemberSpec => {
    const own = memberDocs && Object.hasOwn(memberDocs, name) ? memberDocs[name] : undefined;
    const targetDoc = docs && Object.hasOwn(docs.shapes, m.target) ? docs.shapes[m.target]?.doc : undefined;
    const doc = own ?? targetDoc;
    return { name, required: m.required, field: build(shapes, docs, cache, m.target, m.traits, depth), ...(doc ? { doc } : {}) };
  });
  // Required first; the model's own order within each group.
  return [...list.filter((m) => m.required), ...list.filter((m) => !m.required)];
}

function buildUncached(shapes: Shapes, docs: Docs | undefined, cache: Cache, id: string, shape: UiShape | undefined, memberTraits: UiTraits | undefined, depth: number): FieldSpec {
  if (!shape) return { shape: id, kind: "json", reason: "unknown-shape" };
  const c = constraints(shape.traits, memberTraits);
  const aggregate = shape.kind === "structure" || shape.kind === "union" || shape.kind === "list" || shape.kind === "map";
  if (aggregate && depth >= MAX_DEPTH) return { shape: id, kind: "json", reason: "depth", ...c };
  const next = depth + 1;
  switch (shape.kind) {
    case "structure":
      return { shape: id, kind: "structure", members: members(shapes, docs, cache, id, shape.members, next), ...c };
    case "union":
      return { shape: id, kind: "union", members: members(shapes, docs, cache, id, shape.members, next), ...c };
    case "list":
      return { shape: id, kind: "list", item: build(shapes, docs, cache, shape.member.target, shape.member.traits, next), ...c };
    case "map":
      return {
        shape: id,
        kind: "map",
        key: build(shapes, docs, cache, shape.key.target, shape.key.traits, next),
        value: build(shapes, docs, cache, shape.value.target, shape.value.traits, next),
        ...c,
      };
    case "enum":
      return { shape: id, kind: "enum", options: Object.entries(shape.values).map(([name, value]) => ({ name, value })), intEnum: shape.intEnum, ...c };
    case "scalar": {
      const s = shape.scalar;
      if (s === "string") return { shape: id, kind: "string", ...c };
      if (s === "boolean") return { shape: id, kind: "boolean", ...c };
      if (s === "timestamp") return { shape: id, kind: "timestamp", ...c };
      if (s === "document") return { shape: id, kind: "document", ...c };
      if (s === "blob") return { shape: id, kind: "blob", ...(shape.traits?.streaming ? { streaming: true as const } : {}), ...c };
      if (NUMERIC.has(s)) return { shape: id, kind: "number", scalar: s, integer: INTEGER.has(s), ...c };
      return { shape: id, kind: "string", ...c };
    }
  }
}

/** The Operation Form of an Operation: its input shape as a tree of fields, required members first. */
export function formFor(uiModel: Pick<UiModel, "operations" | "shapes">, op: OpName, hints?: FormHints): FormSpec {
  const model = Object.hasOwn(uiModel.operations, op) ? uiModel.operations[op] : undefined;
  if (!model) throw new Error(`No Operation ${op} in this model.`);
  const cache = cacheFor(uiModel.shapes, hints?.docs);
  const inputId = model.input;
  if (inputId === undefined) return { op, root: { shape: "", kind: "structure", members: [] } };
  const root = build(uiModel.shapes, hints?.docs, cache, inputId, undefined, 0);
  if (root.kind !== "structure") return { op, root: { shape: inputId, kind: "structure", members: [] } };
  return { op, root };
}
