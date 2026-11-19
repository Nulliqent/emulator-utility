import "./connections.css";
import { BEHAVIOUR_LIMITS, type Check, type ConnectionSummary } from "@console/api-contract";
import { Button, StatusPill } from "@console/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { fetchConnections, runChecks, saveBehaviour } from "../../api.ts";
import { getInvoker } from "../explorer/invoker.ts";
import { clientSnippet } from "./snippet.ts";

const CHECK_TITLES: Record<Check["id"], string> = {
  reachable: "Endpoint reachable",
  tls: "TLS trusted",
  credentials: "Credentials accepted",
  "s3-path-style": "S3 path-style works",
  "same-origin": "Gateway same-origin",
};

function Checks({ connection }: { connection: ConnectionSummary }) {
  const checks = useQuery({
    queryKey: ["checks", connection.id],
    queryFn: () => runChecks(connection.id),
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  return (
    <section className="card" aria-label="Connection checks">
      <div className="conn-head">
        <h2>Connection checks</h2>
        <Button onClick={() => void checks.refetch()} disabled={checks.isFetching}>
          {checks.isFetching ? "Running…" : "Run again"}
        </Button>
      </div>
      {checks.isError && (
        <p role="alert" className="form-error">
          Could not run the checks: {(checks.error as Error).message}
        </p>
      )}
      <ul className="check-list" aria-busy={checks.isFetching}>
        {(checks.data?.checks ?? []).map((c) => (
          <li key={c.id} data-testid={`check-${c.id}`} data-ok={c.ok}>
            <StatusPill tone={c.ok ? "ok" : "danger"}>{c.ok ? "Pass" : "Fail"}</StatusPill>
            <span className="check-text">
              <span className="check-title">{CHECK_TITLES[c.id]}</span>
              <span className="hint check-detail">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      {!checks.data && !checks.isError && <p className="hint" role="status">Running the checks…</p>}
    </section>
  );
}

function BehaviourForm({ connection }: { connection: ConnectionSummary }) {
  const ids = { attempts: useId(), timeout: useId(), error: useId() };
  const queryClient = useQueryClient();
  const { maxAttempts, timeoutMs } = connection.behaviour;
  const savedSeconds = Math.max(1, Math.round(timeoutMs / 1000)); // a hand-edited file may hold a fraction of a second
  const [attempts, setAttempts] = useState(String(maxAttempts));
  const [seconds, setSeconds] = useState(String(savedSeconds));
  const [saved, setSaved] = useState(false);
  // Follow the saved values when they change underneath (a save, or another tab).
  useEffect(() => {
    setAttempts(String(maxAttempts));
    setSeconds(String(savedSeconds));
  }, [maxAttempts, savedSeconds]);

  const L = BEHAVIOUR_LIMITS;
  const a = Number(attempts);
  const s = Number(seconds);
  const problem =
    !Number.isInteger(a) || a < L.maxAttempts.min || a > L.maxAttempts.max
      ? `Max attempts must be a whole number from ${L.maxAttempts.min} to ${L.maxAttempts.max}.`
      : !Number.isInteger(s) || s < L.timeoutMs.min / 1000 || s > L.timeoutMs.max / 1000
        ? `Request timeout must be a whole number of seconds from ${L.timeoutMs.min / 1000} to ${L.timeoutMs.max / 1000}.`
        : undefined;

  const save = useMutation({
    mutationFn: () => saveBehaviour(connection.id, { maxAttempts: a, timeoutMs: s * 1000 }),
    onSuccess: async () => {
      getInvoker().forget(connection.id); // the next call builds its client with the new settings
      await queryClient.invalidateQueries({ queryKey: ["connections"] });
      setSaved(true);
    },
  });
  const dirty = a !== maxAttempts || s !== savedSeconds;
  const whySaveOff = problem ? undefined : !dirty ? "Change a value to save." : undefined;

  return (
    <section className="card" aria-label="Client behaviour">
      <h2>Client behaviour</h2>
      <form
        className="conn-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) save.mutate();
        }}
      >
        <label className="check-row">
          <input type="checkbox" checked disabled readOnly />
          <span>
            S3 path-style addressing
            <span className="hint"> Always on for the Emulator (sets forcePathStyle).</span>
          </span>
        </label>
        <div className="conn-row">
          <div className="field">
            <label htmlFor={ids.attempts}>Max attempts</label>
            <input
              id={ids.attempts}
              aria-describedby={`${ids.attempts}-hint`}
              className="ui-input"
              type="number"
              min={L.maxAttempts.min}
              max={L.maxAttempts.max}
              step={1}
              value={attempts}
              onChange={(e) => (setAttempts(e.target.value), setSaved(false))}
            />
            <span id={`${ids.attempts}-hint`} className="hint">Retries can resend writes such as SendMessage.</span>
          </div>
          <div className="field">
            <label htmlFor={ids.timeout}>Request timeout (seconds)</label>
            <input
              id={ids.timeout}
              className="ui-input"
              type="number"
              min={L.timeoutMs.min / 1000}
              max={L.timeoutMs.max / 1000}
              step={1}
              value={seconds}
              onChange={(e) => (setSeconds(e.target.value), setSaved(false))}
            />
          </div>
        </div>
        {problem && <p role="alert" className="form-error">{problem}</p>}
        {save.isError && <p role="alert" className="form-error">{(save.error as Error).message}</p>}
        <div className="explorer-actions">
          <Button type="submit" variant="primary" disabled={!!problem || !dirty || save.isPending} aria-describedby={`${ids.error}-why`}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <span id={`${ids.error}-why`} className="hint">{whySaveOff}</span>
          {saved && !dirty && <span role="status" className="hint">Saved. The Explorer uses these from its next call.</span>}
        </div>
      </form>
    </section>
  );
}

function Snippet({ connection }: { connection: ConnectionSummary }) {
  const [copied, setCopied] = useState(false);
  const text = clientSnippet(connection);
  return (
    <section className="card" aria-label="Same settings in your code">
      <div className="conn-head">
        <h2>Same settings in your code</h2>
        <Button
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
          }}
        >
          Copy
        </Button>
      </div>
      <pre className="mono explorer-body" data-testid="client-snippet">{text}</pre>
      <p className="hint" role="status">{copied ? "Copied." : ""}</p>
    </section>
  );
}

export function ConnectionsPage() {
  const connections = useQuery({ queryKey: ["connections"], queryFn: fetchConnections });
  const c = connections.data?.items.find((x) => x.id === connections.data?.active);
  return (
    <>
      <h1 className="page-title">Connections</h1>
      <p className="page-sub">
        The Emulator this Console talks to. Its address and keys come from the Emulator's own files, so they are read-only here.
      </p>
      {connections.isError && <p role="alert" className="form-error">Could not load Connections: {(connections.error as Error).message}</p>}
      {c && (
        <>
          <section className="card" aria-label="Connection profile">
            <div className="conn-head">
              <h2>{c.name}</h2>
              <StatusPill tone="ok">Active</StatusPill>
            </div>
            <dl className="facts conn-facts">
              <dt>Endpoint for your apps</dt>
              <dd className="mono">{c.endpoint}</dd>
              <dt>Endpoint the Console dials</dt>
              <dd className="mono">{c.dialEndpoint}</dd>
              <dt>Region</dt>
              <dd>{c.region}</dd>
              <dt>Account</dt>
              <dd className="mono">{c.accountId}</dd>
              <dt>Emulator home</dt>
              <dd className="mono">
                {c.home.path} {c.home.found ? "" : "(not found)"}
              </dd>
              <dt>Credentials</dt>
              <dd>
                Read by the Gateway from the Emulator's credentials file. <span className="hint">Never shown here.</span>
              </dd>
            </dl>
            <p className="hint">Adding, editing and deleting Connections is not available yet.</p>
          </section>
          <Checks connection={c} />
          <BehaviourForm connection={c} />
          <Snippet connection={c} />
        </>
      )}
    </>
  );
}
