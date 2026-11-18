/** One Smithy JSON AST file, as found in a crate's `smithy-model/` folder. */
export interface SmithyJson {
  smithy?: string;
  metadata?: unknown;
  shapes: Record<string, SmithyShape>;
}

export interface SmithyShape {
  type: string;
  traits?: Record<string, unknown>;
  [key: string]: unknown;
}

export type OpName = string;
export type ShapeId = string;

export type OperationStatus = "implemented" | "scaffolded" | "unrouted";

export type Protocol =
  | "restJson1"
  | "awsJson1_0"
  | "awsJson1_1"
  | "awsQuery"
  | "ec2Query"
  | "restXml"
  | "undeclared";

export interface ServiceMeta {
  /** The Smithy shape id of the service, e.g. `com.amazonaws.kinesis#Kinesis_20131202`. */
  shapeId: ShapeId;
  title: string;
  sdkId: string;
  signingName: string;
  protocol: Protocol;
  version: string;
}

export interface OperationModel {
  name: OpName;
  kind: "read" | "write";
  status: OperationStatus;
  input?: ShapeId;
  output?: ShapeId;
  errors: ShapeId[];
  pagination?: { inputToken: string; outputToken: string; pageSize?: string; items?: string };
  streaming?: "input" | "output" | "event-stream";
  /** Explorer grouping, e.g. "Messages", "Queues", "Tags". */
  group: string;
}

export type ScalarKind =
  | "string"
  | "boolean"
  | "byte"
  | "short"
  | "integer"
  | "long"
  | "float"
  | "double"
  | "bigInteger"
  | "bigDecimal"
  | "blob"
  | "timestamp"
  | "document";

/** The few traits the screens need; everything else is dropped. */
export interface UiTraits {
  sensitive?: true;
  streaming?: true;
  length?: { min?: number; max?: number };
  range?: { min?: number; max?: number };
  pattern?: string;
  default?: unknown;
  httpLabel?: true;
  httpQuery?: string;
  httpHeader?: string;
  httpPayload?: true;
  jsonName?: string;
  timestampFormat?: string;
}

export interface UiMember {
  target: ShapeId;
  required: boolean;
  traits?: UiTraits;
}

export type UiShape =
  | { kind: "structure"; members: Record<string, UiMember>; traits?: UiTraits }
  | { kind: "union"; members: Record<string, UiMember>; traits?: UiTraits }
  | { kind: "list"; member: UiMember; traits?: UiTraits }
  | { kind: "map"; key: UiMember; value: UiMember; traits?: UiTraits }
  | { kind: "enum"; values: Record<string, string>; intEnum: boolean; traits?: UiTraits }
  | { kind: "scalar"; scalar: ScalarKind; traits?: UiTraits };

export interface UiModel {
  service: ServiceMeta;
  operations: Record<OpName, OperationModel>;
  shapes: Record<ShapeId, UiShape>;
  /** Filled by Resource Inference (ticket #14). Always empty here. */
  resourceTypes: never[];
}

/** Documentation strings stripped out of the UI Model. Loaded only when a form or panel asks. */
export interface UiDocs {
  service?: string;
  operations: Record<OpName, string>;
  shapes: Record<ShapeId, { doc?: string; members?: Record<string, string> }>;
}

export interface InterpretOptions {
  /** Source Status of each Operation, from the compiler's scan. Missing entries are `unrouted`. */
  statusOf: (op: OpName) => OperationStatus;
}

export interface InterpretResult {
  model: UiModel;
  docs: UiDocs;
  /** Problems found while interpreting that did not stop it, e.g. a shape-type conflict between files. */
  diagnostics: string[];
}
