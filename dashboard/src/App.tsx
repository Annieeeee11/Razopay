import { useEffect, useMemo, useState, Fragment } from "react";
import type { Exception, FullReport, MatchResult } from "./types";
import { pct } from "./types";
import "./App.css";

type Tab = "exceptions" | "matches";

export default function App() {
  const [report, setReport] = useState<FullReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("exceptions");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<MatchResult | null>(null);
  const [sortKey, setSortKey] = useState<"source" | "type">("source");

  useEffect(() => {
    fetch("/report.json")
      .then((r) => {
        if (!r.ok) throw new Error("Missing report.json — run npm run reconcile first");
        return r.json();
      })
      .then((data: FullReport) => setReport(data))
      .catch((e: Error) => setError(e.message));
  }, []);

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
        report.exceptions.map((e) => e.exceptionType ?? e.source).filter(Boolean),
      ),
    ];
  }, [report]);

  async function sendCorrection(
    row: Exception,
    decision: "accept" | "reject",
  ) {
    await fetch("/api/corrections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recordId: row.recordId,
        source: row.source,
        decision,
      }),
    });
    alert(`Recorded ${decision} for ${row.recordId}`);
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

      <section className="panel">
        <h2>Match source</h2>
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
                return (
                  <Fragment key={key}>
                    <tr
                      className="clickable"
                      onClick={() => setExpanded(open ? null : key)}
                    >
                      <td>{e.recordId}</td>
                      <td>{e.source}</td>
                      <td>{e.exceptionType ?? "—"}</td>
                      <td onClick={(ev) => ev.stopPropagation()}>
                        <button
                          className="btn accept"
                          onClick={() => sendCorrection(e, "accept")}
                        >
                          Accept
                        </button>
                        <button
                          className="btn reject"
                          onClick={() => sendCorrection(e, "reject")}
                        >
                          Reject
                        </button>
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
