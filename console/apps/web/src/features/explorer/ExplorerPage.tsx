import type { InvokeResult } from "@console/invoker";
import { Button } from "@console/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useActiveConnection } from "../../app/Shell.tsx";
import { fetchServiceOps } from "../../catalog/fetch.ts";
import { useCatalogIndex } from "../../catalog/useCatalogIndex.ts";
import { byteLength, formatOutput, parseInput, skeletonInput } from "./format.ts";
import { getInvoker } from "./invoker.ts";

const HELP: Record<string, string> = {
  "not-implemented": "The Emulator does not implement this Operation yet (it answered 501).",
  auth: "The Emulator refused the credentials. If it restarted, send again: the Console fetches the new keys.",
  network: "The Gateway could not reach the Emulator, or the request was cancelled or timed out.",
  input: "The SDK refused this input before sending anything. Check the JSON against the Operation's shape.",
  "unknown-service": "This Service is not in the Catalog.",
  "sdk-missing": "The bundled AWS SDK has no command for this Operation.",
};

interface Search {
  service?: string;
  op?: string;
}

export function ExplorerPage() {
  const { active } = useActiveConnection();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Search;
  const serviceId = typeof search.service === "string" ? search.service : "";
  const op = typeof search.op === "string" ? search.op : "";
  const setSelection = (next: Search) => void navigate({ to: "/explorer", search: next, replace: true });

  const { index, fingerprint, metaError, noCatalog } = useCatalogIndex();

  const [filter, setFilter] = useState("");
  const [text, setText] = useState("{}");
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<InvokeResult | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const opSelect = useRef<HTMLSelectElement>(null);
  const ids = { filter: useId(), service: useId(), op: useId(), input: useId(), hint: useId() };

  const entries = useMemo(() => index.data?.entries ?? [], [index.data]);
  const categoryName = useMemo(() => new Map((index.data?.categories ?? []).map((c) => [c.id, c.name])), [index.data]);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f
      ? entries.filter((e) =>
          [e.title, e.serviceId, e.sdkId, categoryName.get(e.category) ?? ""].some((v) => v.toLowerCase().includes(f)),
        )
      : entries;
    return [...list].sort((a, b) => a.title.localeCompare(b.title));
  }, [entries, filter, categoryName]);
  const entry = entries.find((e) => e.serviceId === serviceId);

  const ops = useQuery({
    queryKey: ["catalog", fingerprint, "ops", serviceId],
    queryFn: () => fetchServiceOps(fingerprint!, entry!),
    enabled: fingerprint !== null && entry !== undefined,
    staleTime: Infinity,
  });
  const opList = useMemo(() => Object.values(ops.data?.operations ?? {}).sort((a, b) => a.name.localeCompare(b.name)), [ops.data]);
  // hasOwn: a deep link with op=constructor or op=toString must not resolve to an Object.prototype member.
  const opModel = ops.data && Object.hasOwn(ops.data.operations, op) ? ops.data.operations[op] : undefined;
  const unknownOp = ops.isSuccess && op !== "" && opModel === undefined;

  // A new Operation (picked, or arrived at by a deep link): clear the result and start from its required members.
  const initialised = useRef("");
  useEffect(() => {
    const key = `${serviceId}/${op}`;
    if (!op || !ops.data || initialised.current === key) return;
    initialised.current = key;
    setText(skeletonInput(ops.data, op));
    setResult(null);
    setFormError(null);
    setCancelled(false);
  }, [serviceId, op, ops.data]);

  // After a Service is picked, the next thing to do is pick its Operation.
  useEffect(() => {
    if (serviceId && !op) opSelect.current?.focus();
  }, [serviceId, op, ops.data]);

  async function send() {
    const parsed = parseInput(text);
    if (!parsed.ok) return setFormError(parsed.message);
    if (!active || !serviceId || !op) return setFormError("Pick a Service and an Operation.");
    setFormError(null);
    setCancelled(false);
    setSending(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const r = await getInvoker().invoke({ connectionId: active.id, serviceId, op, input: parsed.value, signal: controller.signal, origin: "user" });
      if (controller.signal.aborted) {
        setResult(null);
        setCancelled(true);
      } else {
        setResult(r);
      }
    } finally {
      abort.current = null;
      setSending(false);
    }
  }

  const kind = result ? (result.ok ? "ok" : result.kind) : null;
  const body = result ? (result.ok ? formatOutput(result.output) : result.message) : "";
  const disabledReason = !serviceId
    ? "Choose a Service first."
    : !op
      ? "Choose an Operation first."
      : unknownOp
        ? `No Operation ${op} in this Service.`
        : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const loadError =
    metaError
      ? `The Gateway did not answer: ${metaError.message}`
      : noCatalog
        ? "The Catalog is not built on this Gateway. Run `pnpm catalog:build` (in console/) and restart it."
        : index.isError
          ? (index.error as Error).message
          : null;

  return (
    <>
      <h1 className="page-title">API Explorer</h1>
      <p className="page-sub">Pick a Service and an Operation, enter the input as JSON and send it to the Emulator.</p>
      <section className="card explorer-form" aria-label="Request">
        {loadError && <p role="alert" className="form-error">{loadError}</p>}
        <div className="field">
          <label htmlFor={ids.filter}>Filter services</label>
          <input
            id={ids.filter}
            className="ui-input"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Title, id, SDK id or category: sqs, queue, storage…"
          />
        </div>
        <div className="field">
          <label htmlFor={ids.service}>Service</label>
          <select
            id={ids.service}
            className="ui-input"
            value={serviceId}
            onChange={(e) => setSelection(e.target.value ? { service: e.target.value } : {})}
          >
            <option value="">{index.isPending && fingerprint !== null ? "Loading…" : "Choose a Service"}</option>
            {serviceId && !shown.some((e) => e.serviceId === serviceId) && entry && (
              <option value={serviceId}>{entry.title} ({serviceId})</option>
            )}
            {shown.map((e) => (
              <option key={e.serviceId} value={e.serviceId}>
                {e.title} ({e.serviceId})
              </option>
            ))}
          </select>
          {filter && shown.length === 0 && <p className="hint" role="status">No services match "{filter}".</p>}
          {serviceId && !entry && index.isSuccess && <p className="form-error" role="alert">No Service "{serviceId}" in this Catalog.</p>}
        </div>
        <div className="field">
          <label htmlFor={ids.op}>Operation</label>
          <select
            id={ids.op}
            ref={opSelect}
            className="ui-input"
            value={op}
            disabled={!serviceId || ops.isError}
            onChange={(e) => setSelection({ service: serviceId, ...(e.target.value ? { op: e.target.value } : {}) })}
          >
            <option value="">{ops.isPending && entry ? "Loading…" : "Choose an Operation"}</option>
            {opList.map((o) => (
              <option key={o.name} value={o.name}>
                {o.name} · {o.kind} · {o.status}
              </option>
            ))}
          </select>
          {ops.isError && <p className="form-error" role="alert">{(ops.error as Error).message}</p>}
          {unknownOp && <p className="form-error" role="alert">No Operation {op} in this Service.</p>}
          {opModel && opModel.status !== "implemented" && (
            <p className="hint" role="note">This operation answers 501 in the emulator source.</p>
          )}
        </div>
        <div className="field">
          <label htmlFor={ids.input}>Input (JSON)</label>
          <textarea id={ids.input} className="ui-input mono" rows={8} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {formError && <p role="alert" className="form-error">{formError}</p>}
        <div className="explorer-actions">
          <Button variant="primary" onClick={() => void send()} disabled={sending || disabledReason !== null} aria-describedby={ids.hint}>
            {sending ? "Sending…" : "Send"}
          </Button>
          {sending && <Button onClick={() => abort.current?.abort()}>Cancel</Button>}
          <span id={ids.hint} className="hint">{disabledReason ?? ""}</span>
        </div>
        {cancelled && <p className="hint" role="status">Cancelled.</p>}
      </section>
      {result && kind && (
        <section className="card explorer-result" aria-label="Response">
          <p>
            <strong data-testid="result-kind" data-kind={kind}>{kind}</strong>
            {" · "}
            <span>{result.meta?.status ? `Status ${result.meta.status}` : "No status"}</span>
            {" · "}
            <span>{result.meta ? `${result.meta.durationMs} ms` : ""}</span>
            {" · "}
            <span>{byteLength(body)} bytes</span>
            {result.meta?.requestId ? <span className="mono"> · Request ID {result.meta.requestId}</span> : null}
            {!result.ok && result.code ? <span className="mono"> · {result.code}</span> : null}
            {result.meta?.attempts && result.meta.attempts > 1 ? ` · ${result.meta.attempts} attempts` : ""}
          </p>
          {!result.ok && HELP[kind] && <p className="hint">{HELP[kind]}</p>}
          <div className="explorer-actions">
            <Button onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</Button>
          </div>
          {/* Model and emulator strings are rendered as text, never as HTML. */}
          <pre className="mono explorer-body" data-testid="result-body">{body}</pre>
        </section>
      )}
    </>
  );
}
