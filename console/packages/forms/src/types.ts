import type { OpName, ScalarKind, ShapeId } from "@console/model";

export interface Constraints {
  length?: { min?: number; max?: number };
  range?: { min?: number; max?: number };
  pattern?: string;
}

export type FieldKind =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "timestamp"
  | "blob"
  | "list"
  | "map"
  | "structure"
  | "union"
  | "document"
  | "json";

interface Common extends Constraints {
  shape: ShapeId;
  sensitive?: true;
}

/** One field of an Operation Form. `json` is the fallback past the depth cap or for a shape the model lacks. */
export type FieldSpec = Common &
  (
    | { kind: "string" }
    | { kind: "number"; scalar: ScalarKind; integer: boolean }
    | { kind: "boolean" }
    | { kind: "enum"; options: { name: string; value: string }[]; intEnum: boolean }
    | { kind: "timestamp" }
    | { kind: "blob"; streaming?: true }
    | { kind: "list"; item: FieldSpec }
    | { kind: "map"; key: FieldSpec; value: FieldSpec }
    | { kind: "structure"; members: MemberSpec[] }
    | { kind: "union"; members: MemberSpec[] }
    | { kind: "document" }
    | { kind: "json"; reason: "depth" | "unknown-shape" }
  );

export interface MemberSpec {
  name: string;
  required: boolean;
  field: FieldSpec;
  /** Raw model documentation (may contain HTML). Render it as text only; see `plainText`. */
  doc?: string;
}

export interface FormSpec {
  op: OpName;
  /** The Operation's input structure (an empty structure when the Operation has none). */
  root: FieldSpec & { kind: "structure" };
}

export interface FormHints {
  /** Documentation strings of the service (the `.docs.json`). Absent means no per-field docs. */
  docs?: {
    shapes: Record<ShapeId, { doc?: string; members?: Record<string, string> }>;
  };
}

/**
 * The editable state of a field, driven by its spec:
 * string, number (text), enum, timestamp (text), document and json: string.
 * boolean: boolean. blob: BlobValue. list: FormValue[]. map: MapEntry[]. structure: StructValue.
 * union: UnionValue. `undefined` means unset.
 */
export type FormValue = string | boolean | BlobValue | FormValue[] | MapEntry | UnionValue | StructValue;
export interface BlobValue {
  mode: "text" | "base64" | "file";
  text: string;
  bytes?: Uint8Array;
  fileName?: string;
}
export interface MapEntry {
  key: string;
  value?: FormValue;
}
export interface UnionValue {
  member: string;
  value?: FormValue;
}
export interface StructValue {
  [member: string]: FormValue | undefined;
}

export interface FieldError {
  /** For example `Entries[0].MessageBody`. Empty for the whole input. */
  path: string;
  code: "required" | "length" | "range" | "pattern" | "type" | "enum" | "json" | "duplicate";
  message: string;
}

export interface ToInputResult {
  /** The SDK input: timestamps as Date, blobs as Uint8Array. Best effort when there are errors. */
  input: Record<string, unknown>;
  errors: FieldError[];
}

export interface FromInputResult {
  value: StructValue;
  /** Paths in the input the form cannot show (unknown members, wrong types). */
  dropped: string[];
}
