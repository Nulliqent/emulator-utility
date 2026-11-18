import type {
  InterpretOptions,
  InterpretResult,
  OperationModel,
  OpName,
  Protocol,
  ScalarKind,
  ServiceMeta,
  ShapeId,
  SmithyJson,
  SmithyShape,
  UiDocs,
  UiMember,
  UiShape,
  UiTraits,
} from "./types.ts";

const PROTOCOLS: Protocol[] = ["restJson1", "awsJson1_0", "awsJson1_1", "awsQuery", "ec2Query", "restXml"];

const SCALARS: Record<string, ScalarKind> = {
  string: "string",
  boolean: "boolean",
  byte: "byte",
  short: "short",
  integer: "integer",
  long: "long",
  float: "float",
  double: "double",
  bigInteger: "bigInteger",
  bigDecimal: "bigDecimal",
  blob: "blob",
  timestamp: "timestamp",
  document: "document",
};

const PRELUDE: Record<string, ScalarKind> = {
  "smithy.api#String": "string",
  "smithy.api#Boolean": "boolean",
  "smithy.api#PrimitiveBoolean": "boolean",
  "smithy.api#Byte": "byte",
  "smithy.api#Short": "short",
  "smithy.api#Integer": "integer",
  "smithy.api#PrimitiveInteger": "integer",
  "smithy.api#Long": "long",
  "smithy.api#PrimitiveLong": "long",
  "smithy.api#Float": "float",
  "smithy.api#Double": "double",
  "smithy.api#BigInteger": "bigInteger",
  "smithy.api#BigDecimal": "bigDecimal",
  "smithy.api#Blob": "blob",
  "smithy.api#Timestamp": "timestamp",
  "smithy.api#Document": "document",
};

const UNIT = "smithy.api#Unit";

const READ_PREFIX = /^(List|Describe|Get|Head|Search|Query|BatchGet)([A-Z0-9]|$)/;

const VERBS = new Set([
  "Abort", "Accept", "Activate", "Add", "Allocate", "Apply", "Archive", "Associate", "Assume", "Attach",
  "Authorize", "Batch", "Cancel", "Change", "Check", "Complete", "Confirm", "Copy", "Create", "Deactivate",
  "Decrease", "Delete", "Deregister", "Deploy", "Describe", "Detach", "Disable", "Disassociate", "Disconnect",
  "Enable", "Execute", "Export", "Finalize", "Generate", "Get", "Import", "Increase", "Initiate", "Invoke",
  "List", "Merge", "Modify", "Move", "Open", "Post", "Preview", "Publish", "Purge", "Put", "Query", "Receive",
  "Register", "Reject", "Release", "Remove", "Replace", "Report", "Request", "Reset", "Restore", "Retry",
  "Revoke", "Rotate", "Run", "Scan", "Search", "Send", "Set", "Start", "Stop", "Subscribe", "Tag", "Terminate",
  "Test", "Unarchive", "Unsubscribe", "Untag", "Update", "Upload", "Validate", "Verify", "Lookup",
]);

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function localName(id: string): string {
  const i = id.indexOf("#");
  return i < 0 ? id : id.slice(i + 1);
}

function targetOf(ref: unknown): string | undefined {
  return isRecord(ref) && typeof ref["target"] === "string" ? ref["target"] : undefined;
}

function strip(text: unknown): string | undefined {
  return typeof text === "string" && text.length > 0 ? text : undefined;
}

/** Group an Operation for the explorer: its noun, pluralised, with every Tag Operation under "Tags". */
export function groupOf(op: OpName): string {
  const words = op.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+/g) ?? [op];
  if (words.some((w) => w === "Tag" || w === "Tags")) return "Tags";
  let i = 0;
  if (words[0] === "Batch" && words[1] && VERBS.has(words[1])) i = 2;
  else if (words[0] && VERBS.has(words[0])) i = 1;
  const noun = words.slice(i).join("");
  if (!noun) return "Other";
  if (/(s|x|ch|sh)$/i.test(noun)) return noun;
  if (/[^aeiou]y$/i.test(noun)) return noun.slice(0, -1) + "ies";
  return noun + "s";
}

function protocolOf(traits: Json): Protocol {
  for (const p of PROTOCOLS) if (has(traits, `aws.protocols#${p}`)) return p;
  return "undeclared";
}

function range(raw: unknown): { min?: number; max?: number } | undefined {
  if (!isRecord(raw)) return undefined;
  const out: { min?: number; max?: number } = {};
  if (typeof raw["min"] === "number") out.min = raw["min"];
  if (typeof raw["max"] === "number") out.max = raw["max"];
  return Object.keys(out).length ? out : undefined;
}

function uiTraits(raw: Json | undefined): UiTraits | undefined {
  if (!raw) return undefined;
  const t: UiTraits = {};
  if (has(raw, "smithy.api#sensitive")) t.sensitive = true;
  if (has(raw, "smithy.api#streaming")) t.streaming = true;
  const length = range(raw["smithy.api#length"]);
  if (length) t.length = length;
  const rng = range(raw["smithy.api#range"]);
  if (rng) t.range = rng;
  if (typeof raw["smithy.api#pattern"] === "string") t.pattern = raw["smithy.api#pattern"];
  if (has(raw, "smithy.api#default")) t.default = raw["smithy.api#default"];
  if (has(raw, "smithy.api#httpLabel")) t.httpLabel = true;
  if (typeof raw["smithy.api#httpQuery"] === "string") t.httpQuery = raw["smithy.api#httpQuery"];
  if (typeof raw["smithy.api#httpHeader"] === "string") t.httpHeader = raw["smithy.api#httpHeader"];
  if (has(raw, "smithy.api#httpPayload")) t.httpPayload = true;
  if (typeof raw["smithy.api#jsonName"] === "string") t.jsonName = raw["smithy.api#jsonName"];
  if (typeof raw["smithy.api#timestampFormat"] === "string") t.timestampFormat = raw["smithy.api#timestampFormat"];
  return Object.keys(t).length ? t : undefined;
}

const has = (o: object, key: string): boolean => Object.hasOwn(o, key);

/** Keys that would reach Object.prototype if used to index a plain object. Refused outright. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function safeKey(key: string): string {
  if (UNSAFE_KEYS.has(key) || UNSAFE_KEYS.has(localName(key))) throw new Error(`unsafe key "${key}" in model`);
  return key;
}

function mergeTraits(base: unknown, overlay: unknown): Json | undefined {
  if (!isRecord(base) && !isRecord(overlay)) return undefined;
  const out: Json = {};
  for (const src of [base, overlay]) {
    if (!isRecord(src)) continue;
    for (const k of Object.keys(src)) out[safeKey(k)] = src[k];
  }
  return out;
}

/**
 * Merge the same shape from a later file into an earlier one. Structures and unions merge member
 * by member, the later file winning per member, with traits merged; a later file's stub (for
 * example an empty `members`) therefore never erases members. Other shapes: later wins.
 */
function mergeShape(id: string, base: SmithyShape, overlay: SmithyShape, diagnostics: string[]): SmithyShape {
  if (base.type !== overlay.type) {
    diagnostics.push(`shape ${id} is a ${base.type} in one model file and a ${overlay.type} in another; kept the first`);
    return base;
  }
  const merged: SmithyShape = { ...overlay, type: base.type };
  const traits = mergeTraits(base.traits, overlay.traits);
  if (traits) merged.traits = traits;
  if (isRecord(base["members"]) || isRecord(overlay["members"])) {
    const members: Json = {};
    const baseMembers = isRecord(base["members"]) ? base["members"] : {};
    const overlayMembers = isRecord(overlay["members"]) ? overlay["members"] : {};
    for (const name of new Set([...Object.keys(baseMembers), ...Object.keys(overlayMembers)])) {
      safeKey(name);
      const b = baseMembers[name];
      const o = overlayMembers[name];
      if (isRecord(b) && isRecord(o)) {
        const m: Json = { ...b, ...o };
        const t = mergeTraits(b["traits"], o["traits"]);
        if (t) m["traits"] = t;
        members[name] = m;
      } else {
        members[name] = o ?? b;
      }
    }
    merged["members"] = members;
  }
  return merged;
}

/**
 * Turn the Smithy JSON files of one crate into the UI Model and its docs.
 * Pure: it reads only its arguments. Several files are merged by shape id (see mergeShape).
 */
export function interpret(files: SmithyJson[], options: InterpretOptions): InterpretResult {
  const diagnostics: string[] = [];
  const shapes: Record<string, SmithyShape> = {};
  for (const f of files) {
    for (const id of Object.keys(f.shapes)) {
      safeKey(id);
      const incoming = f.shapes[id]!;
      const existing = has(shapes, id) ? shapes[id] : undefined;
      shapes[id] = existing ? mergeShape(id, existing, incoming, diagnostics) : incoming;
    }
  }

  const shapeOf = (id: string): SmithyShape | undefined => (has(shapes, id) ? shapes[id] : undefined);

  const serviceIds = Object.keys(shapes).filter((k) => shapes[k]?.type === "service");
  const serviceId = serviceIds[0];
  if (serviceIds.length !== 1 || serviceId === undefined) {
    throw new Error(`expected exactly one service shape, found ${serviceIds.length}`);
  }
  const service = shapes[serviceId]!;
  const serviceTraits = (service.traits ?? {}) as Json;
  const awsService = isRecord(serviceTraits["aws.api#service"]) ? serviceTraits["aws.api#service"] : {};
  const sigv4 = isRecord(serviceTraits["aws.auth#sigv4"]) ? serviceTraits["aws.auth#sigv4"] : {};
  const sdkId = typeof awsService["sdkId"] === "string" ? awsService["sdkId"] : localName(serviceId);
  const meta: ServiceMeta = {
    shapeId: serviceId,
    title: typeof serviceTraits["smithy.api#title"] === "string" ? serviceTraits["smithy.api#title"] : sdkId,
    sdkId,
    signingName: typeof sigv4["name"] === "string" ? sigv4["name"] : "",
    protocol: protocolOf(serviceTraits),
    version: typeof service["version"] === "string" ? service["version"] : "",
  };

  // Operations reachable from the service, directly or through resources.
  const opIds = new Set<string>();
  const seenResources = new Set<string>();
  const addResource = (rid: string): void => {
    if (seenResources.has(rid)) return;
    seenResources.add(rid);
    const r = shapeOf(rid);
    if (!r) return;
    for (const k of ["create", "put", "read", "update", "delete", "list"]) {
      const t = targetOf(r[k]);
      if (t) opIds.add(t);
    }
    for (const k of ["operations", "collectionOperations"]) {
      const list = r[k];
      if (Array.isArray(list)) for (const x of list) { const t = targetOf(x); if (t) opIds.add(t); }
    }
    const subs = r["resources"];
    if (Array.isArray(subs)) for (const x of subs) { const t = targetOf(x); if (t) addResource(t); }
  };
  for (const x of (service["operations"] as unknown[] | undefined) ?? []) { const t = targetOf(x); if (t) opIds.add(t); }
  for (const x of (service["resources"] as unknown[] | undefined) ?? []) { const t = targetOf(x); if (t) addResource(t); }

  const outShapes: Record<ShapeId, UiShape> = {};
  const docs: UiDocs = { operations: {}, shapes: {} };
  const serviceDoc = strip(serviceTraits["smithy.api#documentation"]);
  if (serviceDoc) docs.service = serviceDoc;

  const isStreamingTarget = (id: string | undefined): "blob" | "union" | undefined => {
    if (!id) return undefined;
    const s = shapeOf(id);
    if (!s || !isRecord(s.traits) || !(has(s.traits, "smithy.api#streaming"))) return undefined;
    return s.type === "union" ? "union" : "blob";
  };

  const member = (raw: unknown): UiMember => {
    const r = isRecord(raw) ? raw : {};
    const traits = isRecord(r["traits"]) ? r["traits"] : undefined;
    const target = targetOf(r) ?? "smithy.api#Unit";
    const out: UiMember = { target, required: !!traits && has(traits, "smithy.api#required") };
    const t = uiTraits(traits);
    if (t) out.traits = t;
    visit(target);
    return out;
  };

  const addDocs = (id: string, s: SmithyShape, memberDocs?: Record<string, string>): void => {
    const doc = strip(s.traits?.["smithy.api#documentation"]);
    if (doc || memberDocs) {
      const entry: { doc?: string; members?: Record<string, string> } = {};
      if (doc) entry.doc = doc;
      if (memberDocs && Object.keys(memberDocs).length) entry.members = memberDocs;
      if (entry.doc || entry.members) docs.shapes[id] = entry;
    }
  };

  const visit = (id: string): void => {
    if (has(outShapes, id) || id === UNIT) return;
    safeKey(id);
    const prelude = PRELUDE[id];
    if (prelude) {
      outShapes[id] = { kind: "scalar", scalar: prelude };
      return;
    }
    const s = shapeOf(id);
    if (!s) {
      diagnostics.push(`unresolved member target ${id}; treated as a free-form document`);
      outShapes[id] = { kind: "scalar", scalar: "document" };
      return;
    }
    const traits = uiTraits(isRecord(s.traits) ? s.traits : undefined);
    const withTraits = <T extends UiShape>(shape: T): T => (traits ? { ...shape, traits } : shape);
    // Reserve the slot first so recursive shapes terminate.
    outShapes[id] = { kind: "scalar", scalar: "document" };
    switch (s.type) {
      case "structure":
      case "union": {
        const members: Record<string, UiMember> = {};
        const memberDocs: Record<string, string> = {};
        const raw = isRecord(s["members"]) ? s["members"] : {};
        for (const [name, m] of Object.entries(raw)) {
          members[safeKey(name)] = member(m);
          const d = isRecord(m) && isRecord(m["traits"]) ? strip(m["traits"]["smithy.api#documentation"]) : undefined;
          if (d) memberDocs[name] = d;
        }
        outShapes[id] = withTraits({ kind: s.type, members });
        addDocs(id, s, memberDocs);
        break;
      }
      case "list":
      case "set":
        outShapes[id] = withTraits({ kind: "list", member: member(s["member"]) });
        addDocs(id, s);
        break;
      case "map":
        outShapes[id] = withTraits({ kind: "map", key: member(s["key"]), value: member(s["value"]) });
        addDocs(id, s);
        break;
      case "enum":
      case "intEnum": {
        const values: Record<string, string> = {};
        const raw = isRecord(s["members"]) ? s["members"] : {};
        for (const [name, m] of Object.entries(raw)) {
          const t = isRecord(m) && isRecord(m["traits"]) ? m["traits"] : {};
          const v = t["smithy.api#enumValue"];
          values[safeKey(name)] = typeof v === "string" || typeof v === "number" ? String(v) : name;
        }
        outShapes[id] = withTraits({ kind: "enum", values, intEnum: s.type === "intEnum" });
        addDocs(id, s);
        break;
      }
      case "string": {
        const legacy = isRecord(s.traits) ? s.traits["smithy.api#enum"] : undefined;
        if (Array.isArray(legacy) && legacy.length > 0) {
          // Smithy 1.0 enum: a string shape with an `enum` trait listing {value, name?}.
          const values: Record<string, string> = {};
          for (const item of legacy) {
            if (!isRecord(item) || typeof item["value"] !== "string") continue;
            const key = typeof item["name"] === "string" ? item["name"] : item["value"];
            values[safeKey(key)] = item["value"];
          }
          outShapes[id] = withTraits({ kind: "enum", values, intEnum: false });
          addDocs(id, s);
          break;
        }
        outShapes[id] = withTraits({ kind: "scalar", scalar: "string" });
        addDocs(id, s);
        break;
      }
      default: {
        const scalar = SCALARS[s.type];
        outShapes[id] = withTraits({ kind: "scalar", scalar: scalar ?? "document" });
        addDocs(id, s);
      }
    }
  };

  const operations: Record<OpName, OperationModel> = {};
  const serviceDefaultPagination = isRecord(serviceTraits["smithy.api#paginated"])
    ? serviceTraits["smithy.api#paginated"]
    : {};
  // Smithy: a service-level `paginated` trait holds defaults that an Operation inherits only
  // when it carries its own `paginated` trait. It never makes other Operations paginated.

  for (const opId of [...opIds].sort()) {
    const op = shapeOf(opId);
    if (!op || op.type !== "operation") continue;
    const name = safeKey(localName(opId));
    const traits = (op.traits ?? {}) as Json;

    const inputId = targetOf(op["input"]);
    const outputId = targetOf(op["output"]);
    const input = inputId && inputId !== UNIT ? inputId : undefined;
    const output = outputId && outputId !== UNIT ? outputId : undefined;
    if (input) visit(input);
    if (output) visit(output);
    const errors: string[] = [];
    for (const e of (op["errors"] as unknown[] | undefined) ?? []) {
      const t = targetOf(e);
      if (t) { errors.push(t); visit(t); }
    }

    const model: OperationModel = {
      name,
      kind: has(traits, "smithy.api#readonly") || READ_PREFIX.test(name) ? "read" : "write",
      status: options.statusOf(name),
      errors,
      group: groupOf(name),
    };
    if (input) model.input = input;
    if (output) model.output = output;

    const ownPagination = traits["smithy.api#paginated"];
    const pag = isRecord(ownPagination) ? { ...serviceDefaultPagination, ...ownPagination } : {};
    if (typeof pag["inputToken"] === "string" && typeof pag["outputToken"] === "string") {
      model.pagination = { inputToken: pag["inputToken"], outputToken: pag["outputToken"] };
      if (typeof pag["pageSize"] === "string") model.pagination.pageSize = pag["pageSize"];
      if (typeof pag["items"] === "string") model.pagination.items = pag["items"];
    }

    const streamKind = (structId: string | undefined): "blob" | "union" | undefined => {
      const s = structId ? shapeOf(structId) : undefined;
      if (!s || !isRecord(s["members"])) return undefined;
      let found: "blob" | "union" | undefined;
      for (const m of Object.values(s["members"])) {
        const k = isStreamingTarget(targetOf(m));
        if (k === "union") return "union";
        if (k) found = k;
      }
      return found;
    };
    const inS = streamKind(input);
    const outS = streamKind(output);
    if (inS === "union" || outS === "union") model.streaming = "event-stream";
    else if (outS) model.streaming = "output";
    else if (inS) model.streaming = "input";

    const doc = strip(traits["smithy.api#documentation"]);
    if (doc) docs.operations[name] = doc;
    operations[name] = model;
  }

  return { model: { service: meta, operations, shapes: outShapes, resourceTypes: [] }, docs, diagnostics };
}
