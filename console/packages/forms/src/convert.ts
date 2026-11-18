import { fromBase64, toBase64, utf8 } from "./bytes.ts";
import { testPattern } from "./text.ts";
import type {
  BlobValue,
  FieldError,
  FieldSpec,
  FormSpec,
  FormValue,
  FromInputResult,
  MapEntry,
  MemberSpec,
  StructValue,
  ToInputResult,
  UnionValue,
} from "./types.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Uint8Array);

/** Own-property write that is safe for keys such as `__proto__` (map keys come from the user). */
function setOwn(o: Obj, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}
const getOwn = (o: Obj, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);

const join = (path: string, name: string) => (path ? `${path}.${name}` : name);
const codePoints = (s: string) => {
  let n = 0;
  for (const _ of s) n++; // eslint-disable-line @typescript-eslint/no-unused-vars
  return n;
};
const describe = (path: string) => (path === "" ? "The input" : path);

function rangeText(r: { min?: number; max?: number }, unit: string): string {
  if (r.min !== undefined && r.max !== undefined) return `between ${r.min} and ${r.max}${unit}`;
  if (r.min !== undefined) return `at least ${r.min}${unit}`;
  return `at most ${r.max}${unit}`;
}

function checkLength(spec: FieldSpec, size: number, unit: string, path: string, errors: FieldError[]): void {
  const l = spec.length;
  if (!l) return;
  if ((l.min !== undefined && size < l.min) || (l.max !== undefined && size > l.max)) {
    errors.push({ path, code: "length", message: `${describe(path)} must be ${rangeText(l, ` ${unit}`)} (it is ${size}).` });
  }
}

const TIMESTAMP_TEXT = /^\s*(-?\d+(?:\.\d+)?)\s*$/;

/** Reads timestamp text: epoch seconds, or anything `Date` parses (ISO 8601, HTTP dates). */
export function parseTimestamp(text: string): Date | undefined {
  const m = TIMESTAMP_TEXT.exec(text);
  const d = m ? new Date(Number(m[1]) * 1000) : new Date(text.trim());
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function toJsonValue(v: unknown): unknown {
  return v;
}

function leaf(spec: FieldSpec, value: FormValue, path: string, errors: FieldError[]): { ok: true; value: unknown } | { ok: false } {
  const bad = (code: FieldError["code"], message: string) => {
    errors.push({ path, code, message });
    return { ok: false as const };
  };
  switch (spec.kind) {
    case "string": {
      if (typeof value !== "string") return bad("type", `${describe(path)} must be text.`);
      checkLength(spec, codePoints(value), "characters", path, errors);
      if (spec.pattern !== undefined && value !== "" && testPattern(spec.pattern, value) === false) {
        errors.push({ path, code: "pattern", message: `${describe(path)} must match the pattern ${spec.pattern}.` });
      }
      return { ok: true, value };
    }
    case "enum": {
      if (typeof value !== "string") return bad("type", `${describe(path)} must be one of the listed values.`);
      if (!spec.options.some((o) => o.value === value)) return bad("enum", `${describe(path)} must be one of: ${spec.options.map((o) => o.value).join(", ")}.`);
      if (spec.intEnum) return { ok: true, value: Number(value) };
      return { ok: true, value };
    }
    case "number": {
      if (typeof value !== "string" || value.trim() === "") return bad("type", `${describe(path)} must be a number.`);
      const n = Number(value);
      if (!Number.isFinite(n)) return bad("type", `${describe(path)} must be a number.`);
      if (spec.integer && !Number.isInteger(n)) return bad("type", `${describe(path)} must be a whole number.`);
      const r = spec.range;
      if (r && ((r.min !== undefined && n < r.min) || (r.max !== undefined && n > r.max))) {
        errors.push({ path, code: "range", message: `${describe(path)} must be ${rangeText(r, "")} (it is ${n}).` });
      }
      return { ok: true, value: n };
    }
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : bad("type", `${describe(path)} must be true or false.`);
    case "timestamp": {
      if (typeof value !== "string") return bad("type", `${describe(path)} must be a date and time.`);
      const d = parseTimestamp(value);
      return d ? { ok: true, value: d } : bad("type", `${describe(path)} must be an ISO 8601 date and time (2026-01-31T12:00:00Z) or epoch seconds.`);
    }
    case "blob": {
      const b = value as BlobValue;
      if (typeof b !== "object" || b === null || Array.isArray(b) || !("mode" in b)) return bad("type", `${describe(path)} must be a blob.`);
      let bytes: Uint8Array | undefined;
      if (b.mode === "text") bytes = utf8(b.text);
      else if (b.mode === "base64") {
        bytes = fromBase64(b.text);
        if (!bytes) return bad("type", `${describe(path)} is not valid base64.`);
      } else {
        bytes = b.bytes;
        if (!bytes) return bad("required", `${describe(path)}: choose a file.`);
      }
      checkLength(spec, bytes.length, "bytes", path, errors);
      return { ok: true, value: bytes };
    }
    case "document":
    case "json": {
      if (typeof value !== "string") return bad("type", `${describe(path)} must be JSON.`);
      if (value.trim() === "") return { ok: false };
      try {
        return { ok: true, value: toJsonValue(JSON.parse(value)) };
      } catch (e) {
        return bad("json", `${describe(path)} is not valid JSON: ${(e as Error).message}`);
      }
    }
    default:
      return { ok: false };
  }
}

function convert(spec: FieldSpec, value: FormValue | undefined, path: string, errors: FieldError[]): { ok: true; value: unknown } | { ok: false } {
  if (value === undefined) return { ok: false };
  switch (spec.kind) {
    case "structure": {
      const out: Obj = {};
      if (!isObj(value)) return { ok: false };
      convertMembers(spec.members, value as StructValue, path, errors, out);
      return { ok: true, value: out };
    }
    case "union": {
      const u = value as UnionValue;
      if (!isObj(u) || typeof u.member !== "string" || u.member === "") return { ok: false };
      const m = spec.members.find((x) => x.name === u.member);
      if (!m) {
        errors.push({ path, code: "enum", message: `${describe(path)}: ${u.member} is not a member of this union.` });
        return { ok: false };
      }
      const p = join(path, m.name);
      const r = convert(m.field, u.value, p, errors);
      if (!r.ok) {
        if (u.value === undefined || m.required) errors.push({ path: p, code: "required", message: `${p} is required.` });
        return { ok: false };
      }
      const out: Obj = {};
      setOwn(out, m.name, r.value);
      return { ok: true, value: out };
    }
    case "list": {
      if (!Array.isArray(value)) return { ok: false };
      const out: unknown[] = [];
      value.forEach((item, i) => {
        const p = `${path}[${i}]`;
        const r = convert(spec.item, item, p, errors);
        if (r.ok) out.push(r.value);
        else if (item === undefined) errors.push({ path: p, code: "required", message: `${p} is empty.` });
      });
      checkLength(spec, value.length, "items", path, errors);
      return { ok: true, value: out };
    }
    case "map": {
      if (!Array.isArray(value)) return { ok: false };
      const out: Obj = {};
      const seen = new Set<string>();
      (value as unknown as MapEntry[]).forEach((e, i) => {
        const p = `${path}[${i}]`;
        const key = e.key;
        if (key === "" || key === undefined) return void errors.push({ path: p, code: "required", message: `${p} needs a key.` });
        const kr = convert(spec.key, key, `${p} key`, errors);
        if (seen.has(key)) return void errors.push({ path: p, code: "duplicate", message: `${p}: the key "${key}" is used twice.` });
        seen.add(key);
        const vr = convert(spec.value, e.value, `${path}[${key}]`, errors);
        if (!vr.ok && e.value === undefined) errors.push({ path: `${path}[${key}]`, code: "required", message: `${path}[${key}] is empty.` });
        if (kr.ok && vr.ok) setOwn(out, key, vr.value);
      });
      checkLength(spec, value.length, "entries", path, errors);
      return { ok: true, value: out };
    }
    default:
      return leaf(spec, value, path, errors);
  }
}

function convertMembers(members: MemberSpec[], value: StructValue, path: string, errors: FieldError[], out: Obj): void {
  for (const m of members) {
    const p = join(path, m.name);
    const v = getOwn(value, m.name) as FormValue | undefined;
    if (v === undefined) {
      if (m.required) errors.push({ path: p, code: "required", message: `${p} is required.` });
      continue;
    }
    const r = convert(m.field, v, p, errors);
    if (r.ok) setOwn(out, m.name, r.value);
    else if (m.required && !errors.some((e) => e.path === p || e.path.startsWith(`${p}.`) || e.path.startsWith(`${p}[`))) {
      errors.push({ path: p, code: "required", message: `${p} is required.` });
    }
  }
}

/** Form state to the SDK input. Timestamps become Date and blobs Uint8Array. Collects every validation error. */
export function toInput(spec: FormSpec, value: StructValue): ToInputResult {
  const errors: FieldError[] = [];
  const input: Obj = {};
  convertMembers(spec.root.members, value, "", errors, input);
  return { input, errors };
}

// ---------------------------------------------------------------------------------------------------------------

function bytesOf(v: unknown): Uint8Array | undefined {
  if (v instanceof Uint8Array) return v;
  if (typeof v === "string") return fromBase64(v);
  return undefined;
}

function revert(spec: FieldSpec, input: unknown, path: string, dropped: string[]): FormValue | undefined {
  if (input === undefined || input === null) return undefined;
  const drop = () => {
    dropped.push(path || "(input)");
    return undefined;
  };
  switch (spec.kind) {
    case "string":
      return typeof input === "string" ? input : drop();
    case "enum":
      return typeof input === "string" || typeof input === "number" ? String(input) : drop();
    case "number":
      return typeof input === "number" || typeof input === "bigint" || typeof input === "string" ? String(input) : drop();
    case "boolean":
      return typeof input === "boolean" ? input : drop();
    case "timestamp":
      if (input instanceof Date) return Number.isNaN(input.getTime()) ? drop() : input.toISOString();
      if (typeof input === "number") {
        const d = new Date(input * 1000);
        return Number.isNaN(d.getTime()) ? drop() : d.toISOString();
      }
      return typeof input === "string" ? input : drop();
    case "blob": {
      if (input instanceof Uint8Array) return { mode: "base64", text: toBase64(input) } satisfies BlobValue;
      return typeof input === "string" ? ({ mode: "base64", text: input } satisfies BlobValue) : drop();
    }
    case "document":
    case "json":
      return JSON.stringify(input, jsonReplacer, 2);
    case "list": {
      if (!Array.isArray(input)) return drop();
      return input.map((x, i) => revert(spec.item, x, `${path}[${i}]`, dropped) ?? "");
    }
    case "map": {
      if (!isObj(input)) return drop();
      return Object.entries(input).map(([key, x]): MapEntry => {
        const v = revert(spec.value, x, `${path}[${key}]`, dropped);
        return v === undefined ? { key } : { key, value: v };
      }) as unknown as FormValue;
    }
    case "structure": {
      if (!isObj(input)) return drop();
      return revertMembers(spec.members, input, path, dropped);
    }
    case "union": {
      if (!isObj(input)) return drop();
      const keys = Object.keys(input);
      const key = keys.find((k) => spec.members.some((m) => m.name === k));
      for (const k of keys) if (k !== key) dropped.push(join(path, k));
      if (!key) return undefined;
      const m = spec.members.find((x) => x.name === key)!;
      const v = revert(m.field, getOwn(input, key), join(path, key), dropped);
      return v === undefined ? { member: key } : { member: key, value: v };
    }
  }
}

function revertMembers(members: MemberSpec[], input: Obj, path: string, dropped: string[]): StructValue {
  const out: StructValue = {};
  const known = new Set<string>();
  for (const m of members) {
    known.add(m.name);
    const v = revert(m.field, getOwn(input, m.name), join(path, m.name), dropped);
    if (v !== undefined) out[m.name] = v;
  }
  for (const k of Object.keys(input)) if (!known.has(k)) dropped.push(join(path, k));
  return out;
}

/**
 * An SDK input, or the JSON the user typed, to form state. Accepts JSON forms of the special types (ISO or epoch
 * timestamps, base64 blobs). What the form cannot show is listed in `dropped`, not lost silently.
 */
export function fromInput(spec: FormSpec, input: unknown): FromInputResult {
  const dropped: string[] = [];
  const value = isObj(input) ? revertMembers(spec.root.members, input, "", dropped) : {};
  if (!isObj(input)) dropped.push("(input)");
  return { value, dropped };
}

// ---------------------------------------------------------------------------------------------------------------

/**
 * Walks parsed JSON beside the spec and gives the special types their SDK form (timestamps to Date, base64 blobs to
 * Uint8Array) without dropping anything, so the JSON tab can send members the form does not know. Values that do
 * not parse stay as they are and the SDK will refuse them.
 */
export function reviveInput(spec: FormSpec, json: unknown): unknown {
  return isObj(json) ? reviveStruct(spec.root.members, json) : json;
}

function reviveStruct(members: MemberSpec[], json: Obj): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(json)) {
    const m = members.find((x) => x.name === k);
    setOwn(out, k, m ? revive(m.field, v) : v);
  }
  return out;
}

function revive(spec: FieldSpec, v: unknown): unknown {
  switch (spec.kind) {
    case "timestamp": {
      if (typeof v === "number") return new Date(v * 1000);
      if (typeof v === "string") return parseTimestamp(v) ?? v;
      return v;
    }
    case "blob":
      return typeof v === "string" ? (fromBase64(v) ?? v) : v;
    case "list":
      return Array.isArray(v) ? v.map((x) => revive(spec.item, x)) : v;
    case "map": {
      if (!isObj(v)) return v;
      const out: Obj = {};
      for (const [k, x] of Object.entries(v)) setOwn(out, k, revive(spec.value, x));
      return out;
    }
    case "structure":
    case "union":
      return isObj(v) ? reviveStruct(spec.members, v) : v;
    default:
      return v;
  }
}

function jsonReplacer(this: unknown, key: string, v: unknown): unknown {
  // `this[key]` is the value before Date#toJSON ran.
  const raw = (this as Obj)[key];
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString();
  if (raw instanceof Uint8Array) return toBase64(raw);
  if (typeof v === "bigint") return v.toString();
  return v;
}

/** The SDK input as JSON text: Date as ISO 8601, Uint8Array as base64. */
export function stringifyInput(input: unknown): string {
  return JSON.stringify(input, jsonReplacer, 2);
}

/** The state a field starts in when the user adds it: required structures are open, the rest unset. */
export function initialValue(spec: FieldSpec, depth = 0): FormValue | undefined {
  if (spec.kind === "structure" && depth < 8) {
    const out: StructValue = {};
    for (const m of spec.members) if (m.required) {
      const v = initialValue(m.field, depth + 1);
      if (v !== undefined) out[m.name] = v;
    }
    return out;
  }
  if (spec.kind === "list") return [];
  if (spec.kind === "map") return [];
  return undefined;
}
