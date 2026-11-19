import { initialValue, plainText } from "@console/forms";
import type { BlobValue, FieldError, FieldSpec, FormValue, MapEntry, MemberSpec, StructValue, UnionValue } from "@console/forms";
import { Button } from "@console/ui";
import { useId, useState } from "react";

/** Model docs are third-party HTML. They are reduced to plain text and rendered as a text child: never as markup. */
function Doc({ html }: { html: string | undefined }) {
  if (!html) return null;
  const text = plainText(html);
  if (!text) return null;
  const first = text.split(/\n/)[0] ?? "";
  const short = first.length > 140 ? `${first.slice(0, 140)}…` : first;
  if (short === text) return <p className="hint field-doc">{text}</p>;
  return (
    <details className="field-doc">
      <summary className="hint">{short}</summary>
      <p className="hint field-doc-body">{text}</p>
    </details>
  );
}

interface Ctx {
  errors: FieldError[];
  /** Required-field errors wait for the first Send; the others show as soon as they exist. */
  attempted: boolean;
}

const errorsAt = (ctx: Ctx, path: string): FieldError[] =>
  ctx.errors.filter((e) => e.path === path && (ctx.attempted || e.code !== "required"));

function Errors({ ctx, path }: { ctx: Ctx; path: string }) {
  const list = errorsAt(ctx, path);
  if (list.length === 0) return null;
  return (
    <>
      {list.map((e, i) => (
        <p key={i} className="form-error field-error" role="alert">
          {e.message}
        </p>
      ))}
    </>
  );
}

const join = (path: string, name: string) => (path ? `${path}.${name}` : name);
const text = (v: FormValue | undefined) => (typeof v === "string" ? v : "");

interface EditorProps {
  spec: FieldSpec;
  value: FormValue | undefined;
  onChange: (v: FormValue | undefined) => void;
  path: string;
  label: string;
  ctx: Ctx;
  /** An id for the control, so a visible <label> can name it. */
  id: string;
}

function Scalar({ spec, value, onChange, path, label, ctx, id }: EditorProps) {
  const invalid = errorsAt(ctx, path).length > 0;
  const a11y = { id, "aria-invalid": invalid || undefined };
  switch (spec.kind) {
    case "string": {
      const long = (spec.length?.max ?? 0) > 256;
      const set = (v: string) => onChange(v === "" ? undefined : v);
      return long && !spec.sensitive ? (
        <textarea {...a11y} className="ui-input mono" rows={3} spellCheck={false} value={text(value)} onChange={(e) => set(e.target.value)} />
      ) : (
        <input {...a11y} className="ui-input" type={spec.sensitive ? "password" : "text"} autoComplete="off" value={text(value)} onChange={(e) => set(e.target.value)} />
      );
    }
    case "number":
      return (
        <input
          {...a11y}
          className="ui-input"
          inputMode="decimal"
          autoComplete="off"
          placeholder={spec.range ? `${spec.range.min ?? ""}…${spec.range.max ?? ""}` : undefined}
          value={text(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        />
      );
    case "boolean":
      return (
        <select {...a11y} className="ui-input" value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "true")}>
          <option value="">Not set</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    case "enum":
      return (
        <select {...a11y} className="ui-input" value={text(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}>
          <option value="">Not set</option>
          {spec.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value}
            </option>
          ))}
        </select>
      );
    case "timestamp":
      return (
        <input
          {...a11y}
          className="ui-input"
          autoComplete="off"
          placeholder="2026-01-31T12:00:00Z or epoch seconds"
          value={text(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        />
      );
    case "document":
    case "json":
      return (
        <textarea
          {...a11y}
          className="ui-input mono"
          rows={4}
          spellCheck={false}
          placeholder={spec.kind === "json" ? "JSON (nested too deeply for the form)" : "JSON"}
          value={text(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        />
      );
    case "blob":
      return <Blob {...{ spec, value, onChange, path, label, ctx, id }} />;
    default:
      return null;
  }
}

function Blob({ value, onChange, id, label }: EditorProps) {
  const b: BlobValue = typeof value === "object" && value !== null && !Array.isArray(value) && "mode" in value ? (value as BlobValue) : { mode: "text", text: "" };
  const modeId = useId();
  const set = (next: BlobValue) => onChange(next.mode !== "file" && next.text === "" ? undefined : next);
  return (
    <div className="blob-field">
      <select id={modeId} aria-label={`${label} input type`} className="ui-input blob-mode" value={b.mode} onChange={(e) => set({ mode: e.target.value as BlobValue["mode"], text: "" })}>
        <option value="text">Text</option>
        <option value="base64">Base64</option>
        <option value="file">File</option>
      </select>
      {b.mode === "file" ? (
        <>
          <input
            id={id}
            type="file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void f.arrayBuffer().then((buf) => onChange({ mode: "file", text: "", bytes: new Uint8Array(buf), fileName: f.name }));
            }}
          />
          {b.bytes && <span className="hint">{b.fileName} · {b.bytes.length} bytes</span>}
        </>
      ) : (
        <textarea id={id} className="ui-input mono" rows={3} spellCheck={false} value={b.text} onChange={(e) => set({ mode: b.mode, text: e.target.value })} />
      )}
    </div>
  );
}

function Field({ spec, value, onChange, path, label, ctx, id }: EditorProps) {
  switch (spec.kind) {
    case "structure":
      return <Members members={spec.members} value={(value ?? {}) as StructValue} onChange={onChange} path={path} ctx={ctx} />;
    case "union": {
      const u = (value ?? {}) as Partial<UnionValue>;
      const m = spec.members.find((x) => x.name === u.member);
      return (
        <div className="nested">
          <select id={id} aria-label={`${label} member`} className="ui-input" value={u.member ?? ""} onChange={(e) => onChange(e.target.value === "" ? undefined : { member: e.target.value })}>
            <option value="">Choose one</option>
            {spec.members.map((x) => (
              <option key={x.name} value={x.name}>
                {x.name}
              </option>
            ))}
          </select>
          {m && (
            <MemberRow m={{ ...m, required: true }} value={u.value} onChange={(v) => onChange(v === undefined ? { member: m.name } : { member: m.name, value: v })} path={join(path, m.name)} ctx={ctx} />
          )}
        </div>
      );
    }
    case "list": {
      const items = Array.isArray(value) ? value : [];
      return (
        <div className="nested">
          {items.map((item, i) => (
            <ListItem key={i} label={`${label} item ${i + 1}`} onRemove={() => onChange(items.filter((_, j) => j !== i))}>
              <Field spec={spec.item} value={item} path={`${path}[${i}]`} label={`${label} item ${i + 1}`} ctx={ctx} id={`${id}-${i}`} onChange={(v) => onChange(items.map((x, j) => (j === i ? (v ?? "") : x)))} />
              <Errors ctx={ctx} path={`${path}[${i}]`} />
            </ListItem>
          ))}
          <div>
            <Button onClick={() => onChange([...items, initialValue(spec.item) ?? ""])}>Add {label} item</Button>
          </div>
        </div>
      );
    }
    case "map": {
      const entries = (Array.isArray(value) ? value : []) as unknown as MapEntry[];
      const set = (i: number, patch: Partial<MapEntry>) => onChange(entries.map((e, j) => (j === i ? { ...e, ...patch } : e)) as unknown as FormValue);
      return (
        <div className="nested">
          {entries.map((e, i) => (
            <ListItem key={i} label={`${label} entry ${i + 1}`} onRemove={() => onChange(entries.filter((_, j) => j !== i) as unknown as FormValue)}>
              <div className="field">
                <label htmlFor={`${id}-${i}-key`}>{`${label} entry ${i + 1} key`}</label>
                <Field spec={spec.key} value={e.key} path={`${path}[${i}] key`} label={`${label} entry ${i + 1} key`} ctx={ctx} id={`${id}-${i}-key`} onChange={(v) => set(i, { key: text(v) })} />
                <Errors ctx={ctx} path={`${path}[${i}] key`} />
              </div>
              <div className="field">
                <label htmlFor={`${id}-${i}-value`}>{`${label} entry ${i + 1} value`}</label>
                <Field spec={spec.value} value={e.value} path={`${path}[${e.key}]`} label={`${label} entry ${i + 1} value`} ctx={ctx} id={`${id}-${i}-value`} onChange={(v) => set(i, { value: v })} />
                <Errors ctx={ctx} path={`${path}[${e.key}]`} />
              </div>
            </ListItem>
          ))}
          <div>
            <Button onClick={() => onChange([...entries, { key: "" }] as unknown as FormValue)}>Add {label} entry</Button>
          </div>
        </div>
      );
    }
    default:
      return <Scalar {...{ spec, value, onChange, path, label, ctx, id }} />;
  }
}

function ListItem({ label, onRemove, children }: { label: string; onRemove: () => void; children: React.ReactNode }) {
  return (
    <div className="list-item">
      <div className="list-item-body">{children}</div>
      <Button onClick={onRemove} aria-label={`Remove ${label}`}>
        Remove
      </Button>
    </div>
  );
}

const AGGREGATE = new Set(["structure", "union", "list", "map"]);

function MemberRow({ m, value, onChange, path, ctx }: { m: MemberSpec; value: FormValue | undefined; onChange: (v: FormValue | undefined) => void; path: string; ctx: Ctx }) {
  const id = useId();
  const f = m.field;
  const aggregate = AGGREGATE.has(f.kind);
  const unset = value === undefined;
  // An unset optional aggregate has nothing to show yet: offer to add it.
  const canClear = !m.required && !unset && (aggregate || f.kind === "blob" || f.kind === "boolean");
  // Lists, maps and structures have no single control to name: their heading is plain text.
  const labelled = !aggregate || unset || f.kind === "union";
  const legend = (
    <>
      {labelled ? <label htmlFor={id}>{m.name}</label> : <span className="label">{m.name}</span>}
      {m.required ? <span className="req"> required</span> : null}
    </>
  );
  return (
    <div className={`field member${aggregate ? " member-nested" : ""}`}>
      <div className="member-head">
        {legend}
        {canClear && (
          <Button onClick={() => onChange(undefined)} aria-label={`Clear ${m.name}`}>
            Clear
          </Button>
        )}
      </div>
      <Doc html={m.doc} />
      {aggregate && unset ? (
        <div>
          <Button onClick={() => onChange(initialValue(f) ?? (f.kind === "union" ? undefined : ""))} id={id}>
            Add {m.name}
          </Button>
        </div>
      ) : (
        <Field spec={f} value={value} onChange={onChange} path={path} label={m.name} ctx={ctx} id={id} />
      )}
      <Errors ctx={ctx} path={path} />
    </div>
  );
}

function Members({ members, value, onChange, path, ctx }: { members: MemberSpec[]; value: StructValue; onChange: (v: FormValue | undefined) => void; path: string; ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  const required = members.filter((m) => m.required);
  const optional = members.filter((m) => !m.required);
  // An optional member that already has a value is never hidden behind the fold.
  const setOpt = optional.filter((m) => value[m.name] !== undefined);
  const folded = optional.filter((m) => value[m.name] === undefined);
  const shown = open ? [...required, ...optional] : [...required, ...setOpt];
  const set = (name: string, v: FormValue | undefined) => {
    const next: StructValue = { ...value };
    if (v === undefined) delete next[name];
    else next[name] = v;
    onChange(next);
  };
  return (
    <div className={path === "" ? "members" : "members nested"}>
      {shown.map((m) => (
        <MemberRow key={m.name} m={m} value={value[m.name]} onChange={(v) => set(m.name, v)} path={join(path, m.name)} ctx={ctx} />
      ))}
      {folded.length > 0 && (
        <div>
          <Button onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Hide optional fields" : `${folded.length} more optional field${folded.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      )}
    </div>
  );
}

export interface OperationFormProps {
  members: MemberSpec[];
  value: StructValue;
  onChange: (v: StructValue) => void;
  errors: FieldError[];
  attempted: boolean;
}

/** The Operation Form: required fields first, optional fields folded, docs as plain text. */
export function OperationForm({ members, value, onChange, errors, attempted }: OperationFormProps) {
  return (
    <Members
      members={members}
      value={value}
      onChange={(v) => onChange((v ?? {}) as StructValue)}
      path=""
      ctx={{ errors, attempted }}
    />
  );
}
