"use client";

import { useEffect, useId, useState } from "react";
import { Settings } from "lucide-react";
import { defaultFilters, Filters } from "@/lib/search";
import { FilterPanel } from "./Tools";

type Plan = { q: string; filters: Partial<Filters>; limits: string[] };
type Answer = { kind: "answer"; answer: string; sources: { id: number; label: string; url: string }[] };
type Mode = "disconnected" | "chatgpt" | "api";

async function request<T>(action: string, body?: object): Promise<T> {
  const response = await fetch("/api/assistant/" + action, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { cache: "no-store" });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Use the local Parcel Explorer launcher for AI search.");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "AI search could not complete.");
  return result;
}

export default function LotSearchAssistant({ onApply, areaActive, canLimitArea, bbl, release, addressLabel }: {
  onApply: (q: string, filters: Filters, useMap: boolean) => void;
  bbl: string | null;
  release: string;
  addressLabel: string | null;
  areaActive: boolean;
  canLimitArea: boolean;
}) {
  const inputId = useId();
  const [mode, setMode] = useState<Mode>();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<{ question: string; result: Answer }[]>([]);
  const [previous, setPrevious] = useState("");
  const [plan, setPlan] = useState<Plan>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState("");
  const addressId = useId();

  useEffect(() => {
    let active = true;
    request<{ mode: Mode }>("status")
      .then((result) => { if (active) setMode(result.mode); })
      .catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);

  async function run() {
    if (!mode || mode === "disconnected" || busy || !question.trim()) return;
    setError("");
    setPlan(undefined);
    setBusy(true);
    try {
      const result = await request<Answer | (Plan & { kind: "search" })>("chat", { question, previous, bbl, release });
      setPrevious(question);
      if (result.kind === "search") {
        setAddress(result.q);
        setPlan(result);
      } else {
        setMessages((items) => [...items, { question, result }]);
        setQuestion("");
      }
    } catch (err) {
      setError((err as Error).message);
      request<{ mode: Mode }>("status").then((result) => setMode(result.mode)).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function changeConnection() {
    setError("");
    setBusy(true);
    try {
      if (mode === "chatgpt") {
        const result = await request<{ mode: Mode }>("disconnect", {});
        setMode(result.mode);
      } else {
        const { url } = await request<{ url: string }>("connect", { bbl });
        sessionStorage.setItem("parcel:lot-search", question);
        location.assign(url);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const draft = sessionStorage.getItem("parcel:lot-search");
    if (draft) {
      setQuestion(draft);
      sessionStorage.removeItem("parcel:lot-search");
    }
  }, []);

  if (plan) {
    return (
      <>
        <div className="assistant-content ai-filter-review">
          <div className="section-heading">
            <strong>Review and edit filters</strong>
            <button type="button" className="text-button" onClick={() => setPlan(undefined)}>Edit request</button>
          </div>
          {plan.limits.length > 0 && (
            <section className="assistant-answer" aria-label="Couldn’t apply">
              <strong>Couldn’t apply</strong>
              <ul>{plan.limits.map((limit, index) => <li key={index}>{limit}</li>)}</ul>
            </section>
          )}
          <label htmlFor={addressId}>Street address or lot ID</label>
          <input id={addressId} value={address} maxLength={200} onChange={(event) => setAddress(event.target.value)} />
        </div>
        <FilterPanel
          filters={{ ...defaultFilters(), ...plan.filters }}
          areaActive={areaActive}
          canLimitArea={canLimitArea}
          aiReview
          onApply={(filters, area) => onApply(address.trim(), filters, area !== "all")}
        />
      </>
    );
  }

  return (
    <div className="tool-scroll assistant-content">
      <div className="section-heading">
        <p>{addressLabel ? "Selected parcel: " + addressLabel : "No parcel selected"}</p>
        <details className="ai-connection-settings">
          <summary aria-label="AI connection settings" title="AI connection settings">
            <Settings size={16} aria-hidden="true" />
          </summary>
          <div>
            <p>{mode === "chatgpt" ? "ChatGPT connected" : mode === "api" ? "Using configured API key" : "Connect ChatGPT to use Ask AI."}</p>
            <button type="button" className="text-button" disabled={busy || mode === undefined} onClick={changeConnection}>
              {mode === "chatgpt" ? "Disconnect" : "Continue with ChatGPT"}
            </button>
          </div>
        </details>
      </div>
      <p>Ask about a parcel or describe the Brooklyn lots you want to find.</p>
      {messages.map(({ question, result }, index) => (
        <section key={index} className="assistant-answer" aria-live="polite">
          <strong>{question}</strong><p>{result.answer}</p>
          {result.sources.length > 0 && <ol>{result.sources.map((source) => (
            <li key={source.id} value={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a></li>
          ))}</ol>}
        </section>
      ))}
      <form onSubmit={(event) => { event.preventDefault(); void run(); }}>
        <label htmlFor={inputId}>What are you looking for?</label>
        <textarea id={inputId} rows={3} maxLength={700} value={question} disabled={busy}
          placeholder={bbl ? "What work was permitted here?" : "Find vacant lots over 3,000 sq ft"}
          onChange={(event) => { setQuestion(event.target.value); setPlan(undefined); }} />
        <button className="primary-button" type="submit"
          disabled={busy || !mode || mode === "disconnected" || !question.trim()}>
          {busy ? "Working…" : "Send"}
        </button>
      </form>
      {mode === "disconnected" && <p>Connect ChatGPT in AI settings to send a message.</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
