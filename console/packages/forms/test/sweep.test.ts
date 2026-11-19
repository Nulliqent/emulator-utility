import { beforeAll, describe, expect, it } from "vitest";
import { compileCatalog, loadCatalogConfig, loadExpectedCounts, resolveEmulatorRoot } from "@console/catalog-compiler";
import type { CompiledCatalog } from "@console/catalog-compiler";
import { MAX_DEPTH, formFor, fromInput, reviveInput, stringifyInput, toInput } from "../src/index.ts";
import type { FieldSpec, FormSpec } from "../src/index.ts";

// The build-time Operation Form sweep: a FormSpec for every Operation of the Catalog (all 436 UI Models), the
// depth cap holds, and generated sample inputs survive input -> form -> input and the JSON text round trip.
// Needs the reference repos like the catalog sweep: run `pnpm refs:fetch` or set CONSOLE_REFS_DIR.
let catalog: CompiledCatalog;
beforeAll(() => {
  catalog = compileCatalog({ emulatorRoot: resolveEmulatorRoot(), ...loadCatalogConfig() });
});

const kinds = new Set<string>();

/** The deepest run of aggregates below a field. Memoised by node identity: the spec is a shared graph. */
function depthOf(spec: FieldSpec, memo: Map<FieldSpec, number>): number {
  const hit = memo.get(spec);
  if (hit !== undefined) return hit;
  kinds.add(spec.kind);
  let d = 0;
  if (spec.kind === "structure" || spec.kind === "union") d = 1 + Math.max(0, ...spec.members.map((m) => depthOf(m.field, memo)));
  else if (spec.kind === "list") d = 1 + depthOf(spec.item, memo);
  else if (spec.kind === "map") d = 1 + Math.max(depthOf(spec.key, memo), depthOf(spec.value, memo));
  memo.set(spec, d);
  return d;
}

/** A value that satisfies the field's length and range, built without using the code under test. */
function sample(spec: FieldSpec, depth: number): unknown {
  switch (spec.kind) {
    case "string":
      return "a".repeat(Math.min(Math.max(1, spec.length?.min ?? 1), spec.length?.max ?? Infinity));
    case "number": {
      const n = spec.range?.min !== undefined ? Math.ceil(spec.range.min) : 1;
      return spec.range?.max !== undefined && n > spec.range.max ? spec.range.max : n;
    }
    case "boolean":
      return true;
    case "enum": {
      const v = spec.options[0]?.value ?? "";
      return spec.intEnum ? Number(v) : v;
    }
    case "timestamp":
      return new Date(1_700_000_000_000);
    case "blob":
      return Uint8Array.from({ length: Math.max(3, spec.length?.min ?? 0) }, (_, i) => (i * 7) % 256);
    case "document":
    case "json":
      return { a: [1, "x", null, { b: true }] };
    case "list":
      return Array.from({ length: Math.max(1, spec.length?.min ?? 1) }, () => sample(spec.item, depth + 1));
    case "map":
      return Object.fromEntries(
        Array.from({ length: Math.max(1, spec.length?.min ?? 1) }, (_, i) => {
          // An enum key takes the i-th value; a text key is padded to its minimum length and made distinct.
          const key = spec.key.kind === "enum" ? (spec.key.options[i]?.value ?? "") : `${"k".repeat(Math.max(1, spec.key.length?.min ?? 1))}${i === 0 ? "" : i}`;
          return [key, sample(spec.value, depth + 1)];
        }),
      );
    case "union": {
      const m = spec.members[0];
      return m ? { [m.name]: sample(m.field, depth + 1) } : {};
    }
    case "structure": {
      const out: Record<string, unknown> = {};
      for (const m of spec.members) if (m.required || depth < 2) out[m.name] = sample(m.field, depth + 1);
      return out;
    }
  }
}

describe("Operation Form sweep over the Catalog", () => {
  it("builds a form for every Operation and round-trips a sample input", () => {
    const expected = loadExpectedCounts();
    const failures: string[] = [];
    let services = 0;
    let operations = 0;
    let fallbacks = 0;
    const jsonFallback = (spec: FieldSpec, seen: Set<FieldSpec>): boolean => {
      if (seen.has(spec)) return false;
      seen.add(spec);
      if (spec.kind === "json" && spec.reason === "depth") return true;
      if (spec.kind === "structure" || spec.kind === "union") return spec.members.some((m) => jsonFallback(m.field, seen));
      if (spec.kind === "list") return jsonFallback(spec.item, seen);
      if (spec.kind === "map") return jsonFallback(spec.value, seen);
      return false;
    };

    for (const [serviceId, svc] of catalog.services) {
      services++;
      for (const op of Object.keys(svc.ui.operations)) {
        operations++;
        const where = `${serviceId}/${op}`;
        let spec: FormSpec;
        try {
          spec = formFor(svc.ui, op, { docs: svc.docs });
        } catch (e) {
          failures.push(`${where}: formFor threw ${(e as Error).message}`);
          continue;
        }
        const depth = depthOf(spec.root, new Map());
        if (depth > MAX_DEPTH) failures.push(`${where}: depth ${depth} exceeds ${MAX_DEPTH}`);
        if (jsonFallback(spec.root, new Set())) fallbacks++;
        // Required members come first at every level of the root.
        const firstOptional = spec.root.members.findIndex((m) => !m.required);
        if (firstOptional >= 0 && spec.root.members.slice(firstOptional).some((m) => m.required)) failures.push(`${where}: required member after an optional one`);

        const input = sample(spec.root, 0);
        const form = fromInput(spec, input);
        const back = toInput(spec, form.value);
        const blocking = back.errors.filter((e) => e.code !== "pattern");
        if (form.dropped.length) failures.push(`${where}: dropped ${form.dropped.slice(0, 3).join(", ")}`);
        else if (blocking.length) failures.push(`${where}: ${blocking[0]!.message}`);
        else {
          try {
            expect(back.input).toEqual(input);
            // form -> input -> form is stable
            expect(fromInput(spec, back.input).value).toEqual(form.value);
            // the JSON tab: text, then parse and revive, gives the same SDK input
            expect(reviveInput(spec, JSON.parse(stringifyInput(input)))).toEqual(input);
          } catch (e) {
            failures.push(`${where}: round trip differs: ${(e as Error).message.split("\n")[0]}`);
          }
        }
        if (failures.length > 40) break;
      }
    }
    console.log(`form sweep: ${services} services, ${operations} operations, ${fallbacks} with a JSON depth fallback, kinds: ${[...kinds].sort().join(" ")}`);
    expect(failures).toEqual([]);
    expect(services).toBe(expected.services);
    expect(operations).toBe(expected.operations);
    for (const k of ["string", "number", "boolean", "enum", "timestamp", "blob", "list", "map", "structure", "union", "document"]) expect(kinds).toContain(k);
  });
});
