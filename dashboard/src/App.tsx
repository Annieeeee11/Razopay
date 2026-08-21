import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import type {
  AmbiguityLevel,
  Exception,
  FullReport,
  MatchResult,
} from "./types";
import { pct } from "./types";
import "./App.css";

type Tab = "exceptions" | "matches";

type PendingCorrection = {
  recordId: string;
  source: string;
  decision: "accept" | "reject";
  correctedMatchId?: string;
};

const DIFFICULTY_META: Record<
  AmbiguityLevel,
  { title: string; subtitle: string }
> = {
  clear: {
    title: "Clear cases",
    subtitle: "Exact / easy fuzzy",
  },
  boundary: {
    title: "Boundary cases",
    subtitle: "At fuzzy threshold edge",
  },
  decoy: {
    title: "Decoy (correctly deferred)",
    subtitle: "Should not auto-resolve",
  },
  unresolvable: {
    title: "Unresolvable (correctly flagged)",
    subtitle: "True noise / exceptions",
  },
};

function findCounterpart(
  row: Exception,
  exceptions: Exception[],
): string | undefined {
  const sameReason = exceptions.filter(
    (e) =>
      e.reason === row.reason &&
      e.recordId !== row.recordId &&
      e.source !== row.source,
  );
  if (sameReason.length === 0) return undefined;
  const digits = row.recordId.replace(/\D/g, "");
  const byDigits = sameReason.find(
    (e) => e.recordId.replace(/\D/g, "") === digits,
  );
  return (byDigits ?? sameReason[0])?.recordId;
}

export default function App() {
  const [report, setReport] = useState<FullReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("exceptions");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<MatchResult | null>(null);
  const [sortKey, setSortKey] = useState<"source" | "type">("source");
  const [pending, setPending] = useState<Record<string, PendingCorrection>>({});
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);

  const loadReport = useCallback(() => {
    return fetch(`/report.json?t=${Date.now()}`)
      .then((r) => {
        if (!r.ok)
          throw new Error("Missing report.json — run npm run reconcile first");
        return r.json();
      })
      .then((data: FullReport) => {
        setReport(data);
        setError(null);
      });
  }, []);

  useEffect(() => {
    loadReport().catch((e: Error) => setError(e.message));
  }, [loadReport]);

  const filteredExceptions = useMemo(() => {
    if (!report) return [];
    let rows = [...report.exceptions];
    if (filter !== "all") {
      rows = rows.filter(
        (e) => e.exceptionType === filter || e.source === filter,
      );
    }
    rows.sort((a, b) => {
      if (sortKey === "source") return a.source.localeCompare(b.source);
      return (a.exceptionType ?? "").localeCompare(b.exceptionType ?? "");
    });
    return rows;
  }, [report, filter, sortKey]);

  const exceptionTypes = useMemo(() => {
    if (!report) return [];
    return [
      ...new Set(
        report.exceptions
          .map((e) => e.exceptionType ?? e.source)
          .filter(Boolean),
      ),
    ];
  }, [report]);

  async function sendCorrection(
    row: Exception,
    decision: "accept" | "reject",
  ) {
    const key = `${row.source}:${row.recordId}`;
    const correctedMatchId =
      decision === "accept"
        ? findCounterpart(row, report?.exceptions ?? [])
        : undefined;

    const res = await fetch("/api/corrections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recordId: row.recordId,
        source: row.source,
        decision,
        correctedMatchId,
        score: 0.7,
      }),
    });
    if (!res.ok) {
      setStatusMsg(`Failed to write correction for ${row.recordId}`);
      return;
    }
    setPending((prev) => ({
      ...prev,
      [key]: {
        recordId: row.recordId,
        source: row.source,
        decision,
        correctedMatchId,
      },
    }));
    setStatusMsg(
      decision === "accept"
        ? `${row.recordId} accepted — will resolve as human match on next run`
        : `${row.recordId} rejected — stays exception on next run`,
    );
  }

  async function rerunWithCorrections() {
    setRerunning(true);
    setStatusMsg("Re-running reconcile with --apply-corrections…");
    try {
      const res = await fetch("/api/rerun", { method: "POST" });
      const body = (await res.json()) as {
        ok: boolean;
        error?: string;
        human?: number;
      };
      if (!res.ok || !body.ok) {
        setStatusMsg(
          body.error ??
            "Re-run failed. From the project root run: npm run reconcile -- --seed 42 --skip-llm --apply-corrections",
        );
        return;
      }
      await loadReport();
      setPending({});
      setStatusMsg(
        `Re-run complete — human matches in breakdown: ${body.human ?? "?"}`,
      );
    } catch {
      setStatusMsg(
        "Re-run API unavailable. Run: npm run reconcile -- --seed 42 --skip-llm --apply-corrections",
      );
    } finally {
      setRerunning(false);
    }
  }

  if (error) {
    return (
      <div className="shell">
        <p className="error">{error}</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="shell">
        <p className="muted">Loading report…</p>
      </div>
    );
  }

  const m = report.metrics;
  const breakdown = m.matchSourceBreakdown;
  const maxBar = Math.max(
    1,
    breakdown.exact,
    breakdown.fuzzy,
    breakdown.split,
    breakdown.llm,
    breakdown.human,
  );
  const byLevel = m.byAmbiguityLevel;
  const pendingCount = Object.keys(pending).length;

  return (
    <div className="shell">
      <header className="hero">
        <p className="brand">Razopay</p>
        <h1>Settlement reconciliation</h1>
        <p className="sub">
          Payment → Settlement → Bank credit · seed {m.seed} ·{" "}
          {m.paymentCount} payments · {m.settlementCount} settlements ·{" "}
          {m.bankCount} credits
        </p>
      </header>

      <section className="metrics" aria-label="Headline metrics">
        <Metric label="Match rate" value={pct(m.matchRate)} />
        <Metric label="Precision" value={pct(m.precision)} />
        <Metric label="Recall" value={pct(m.recall)} />
        <Metric label="FP rate" value={pct(m.falsePositiveRate)} danger />
        <Metric
          label="Throughput"
          value={`${m.throughputRecordsPerSec.toFixed(0)}/s`}
        />
      </section>

      {byLevel && (
        <section className="panel difficulty" aria-label="Accuracy by difficulty">
          <div className="panel-head">
            <h2>Accuracy by case difficulty</h2>
            <p className="panel-note">
              One number is not enough — this is where the system is actually
              being tested.
            </p>
          </div>
          <div className="difficulty-grid">
            {(
              [
                "clear",
                "boundary",
                "decoy",
                "unresolvable",
              ] as AmbiguityLevel[]
            ).map((level) => {
              const slice = byLevel[level];
              const meta = DIFFICULTY_META[level];
              if (!slice) return null;
              const deferred =
                slice.deferredTotal != null && slice.deferredTotal > 0
                  ? `${slice.correctlyDeferred ?? 0}/${slice.deferredTotal}`
                  : null;
              return (
                <div className={`diff-card diff-${level}`} key={level}>
                  <h3>{meta.title}</h3>
                  <p className="diff-sub">{meta.subtitle}</p>
                  {level === "decoy" || level === "unresolvable" ? (
                    <p className="diff-main">
                      correctly deferred: <strong>{deferred ?? "—"}</strong>
                    </p>
                  ) : (
                    <>
                      <p className="diff-main">
                        match rate <strong>{pct(slice.matchRate)}</strong>
                      </p>
                      <p className="diff-sec">
                        precision {pct(slice.precision)}
                      </p>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {m.llmAblation && (
        <section className="panel" aria-label="LLM impact">
          <h2>LLM impact</h2>
          {!m.llmAblation.providerAvailable && (
            <p className="panel-note">
              No LLM provider available for this report — both columns fell back
              to none. Set <code>ANTHROPIC_API_KEY</code> or run Ollama, then{" "}
              <code>npm run reconcile -- --seed 42 --compare-llm</code>.
            </p>
          )}
          <div className="ablation-grid">
            <div>
              <h3>With LLM ({m.llmAblation.withLlm.provider})</h3>
              <p>Recall {pct(m.llmAblation.withLlm.recall)}</p>
              <p>Precision {pct(m.llmAblation.withLlm.precision)}</p>
              <p>LLM matches {m.llmAblation.withLlm.llmMatches}</p>
            </div>
            <div>
              <h3>Without LLM</h3>
              <p>Recall {pct(m.llmAblation.withoutLlm.recall)}</p>
              <p>Precision {pct(m.llmAblation.withoutLlm.precision)}</p>
              <p>LLM matches {m.llmAblation.withoutLlm.llmMatches}</p>
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head row">
          <h2>Match source</h2>
          <button
            className="btn primary"
            disabled={rerunning}
            onClick={() => void rerunWithCorrections()}
          >
            {rerunning ? "Re-running…" : "Re-run with corrections"}
          </button>
        </div>
        {statusMsg && <p className="status-msg">{statusMsg}</p>}
        {pendingCount > 0 && (
          <p className="panel-note">
            {pendingCount} correction(s) queued — re-run to apply as human
            matches.
          </p>
        )}
        <div className="bars">
          {(
            [
              ["exact", breakdown.exact],
              ["fuzzy", breakdown.fuzzy],
              ["split", breakdown.split],
              ["llm", breakdown.llm],
              ["human", breakdown.human],
            ] as const
          ).map(([name, count]) => (
            <div className="bar-row" key={name}>
              <span className="bar-label">{name}</span>
              <div className="bar-track">
                <div
                  className={`bar-fill bar-${name}`}
                  style={{ width: `${(count / maxBar) * 100}%` }}
                />
              </div>
              <span className="bar-count">{count}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="tabs">
        <button
          className={tab === "exceptions" ? "active" : ""}
          onClick={() => setTab("exceptions")}
        >
          Exceptions ({report.exceptions.length})
        </button>
        <button
          className={tab === "matches" ? "active" : ""}
          onClick={() => setTab("matches")}
        >
          Matches ({report.matches.length})
        </button>
      </div>

      {tab === "exceptions" && (
        <section className="panel">
          <div className="toolbar">
            <label>
              Filter{" "}
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">all</option>
                {exceptionTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sort{" "}
              <select
                value={sortKey}
                onChange={(e) =>
                  setSortKey(e.target.value as "source" | "type")
                }
              >
                <option value="source">source</option>
                <option value="type">type</option>
              </select>
            </label>
          </div>
          <table>
            <thead>
              <tr>
                <th>Record</th>
                <th>Source</th>
                <th>Type</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredExceptions.map((e) => {
                const key = `${e.source}:${e.recordId}`;
                const open = expanded === key;
                const queued = pending[key];
                return (
                  <Fragment key={key}>
                    <tr
                      className={`clickable ${queued ? "row-pending" : ""}`}
                      onClick={() => setExpanded(open ? null : key)}
                    >
                      <td>{e.recordId}</td>
                      <td>{e.source}</td>
                      <td>{e.exceptionType ?? "—"}</td>
                      <td onClick={(ev) => ev.stopPropagation()}>
                        {queued ? (
                          <span className="pending-tag">
                            resolved — pending re-run ({queued.decision})
                          </span>
                        ) : (
                          <>
                            <button
                              className="btn accept"
                              onClick={() => void sendCorrection(e, "accept")}
                            >
                              Accept
                            </button>
                            <button
                              className="btn reject"
                              onClick={() => void sendCorrection(e, "reject")}
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="detail">
                        <td colSpan={4}>{e.reason}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {tab === "matches" && (
        <section className="panel split-view">
          <ul className="match-list">
            {report.matches.map((match) => (
              <li key={`${match.bankCreditId}-${match.settlementId}`}>
                <button
                  className={
                    selectedMatch?.bankCreditId === match.bankCreditId
                      ? "match-item active"
                      : "match-item"
                  }
                  onClick={() => setSelectedMatch(match)}
                >
                  <span className="pill">{match.matchedBy}</span>
                  {match.bankCreditId} → {match.settlementId}
                </button>
              </li>
            ))}
          </ul>
          <div className="inspector">
            {selectedMatch ? (
              <>
                <h2>Match inspector</h2>
                <dl>
                  <dt>Pass</dt>
                  <dd>{selectedMatch.matchedBy}</dd>
                  <dt>Confidence</dt>
                  <dd>{selectedMatch.confidence}</dd>
                  <dt>Bank credit</dt>
                  <dd>{selectedMatch.bankCreditId}</dd>
                  <dt>Settlement</dt>
                  <dd>{selectedMatch.settlementId}</dd>
                  {selectedMatch.components && (
                    <>
                      <dt>Components</dt>
                      <dd>{selectedMatch.components.join(", ")}</dd>
                    </>
                  )}
                  <dt>Reasoning</dt>
                  <dd>{selectedMatch.reasoning ?? "—"}</dd>
                </dl>
              </>
            ) : (
              <p className="muted">Select a match to inspect.</p>
            )}
          </div>
        </section>
      )}

      <footer className="foot">
        CLI remains the source of truth · this view reads{" "}
        <code>output/report.json</code>
      </footer>
    </div>
  );
}

function Metric({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className={`metric ${danger ? "danger" : ""}`}>
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}
