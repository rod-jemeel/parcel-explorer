"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowUp, Ellipsis, Plus, X } from "lucide-react";
import { defaultFilters, Filters } from "@/lib/search";
import { FilterPanel } from "./Tools";

type Plan = { q: string; filters: Partial<Filters>; limits: string[] };
type Answer = { kind: "answer"; answer: string; sources: { id: number; label: string; url: string }[] };
type Reply = Answer | (Plan & { kind: "search" });
export type ParcelMention = { bbl: string; label: string };
type Turn = { mentions?: ParcelMention[]; question: string; bbl: string | null; parcelLabel?: string | null; result: Reply };
type Chat = { id: string; turns: Turn[] };
type ChatState = { active: string; sessions: Chat[] };

const chatStorageKey = "parcel-explorer:ai-chats:v1";

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

export default function LotSearchAssistant({ onApply, areaActive, canLimitArea, bbl, release, mentions, onRemoveMention, onClose }: {
  onApply: (q: string, filters: Filters, useMap: boolean) => void;
  bbl: string | null;
  release: string;
  mentions: ParcelMention[];
  onRemoveMention: (bbl: string) => void;
  onClose: () => void;
  areaActive: boolean;
  canLimitArea: boolean;
}) {
  const inputId = useId();
  const menu = useRef<HTMLDetailsElement>(null);
  const [mode, setMode] = useState<Mode>();
  const [question, setQuestion] = useState("");
  const [chats, setChats] = useState<ChatState>({ active: "", sessions: [] });
  const [storageReady, setStorageReady] = useState(false);
  const endOfChat = useRef<HTMLDivElement>(null);
  const chat = chats.sessions.find((item) => item.id === chats.active);
  const turns = chat?.turns;

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

  useEffect(() => {
    try {
      const saved = localStorage.getItem(chatStorageKey);
      if (saved) {
        const state = JSON.parse(saved) as ChatState;
        if (Array.isArray(state.sessions) && typeof state.active === "string") setChats(state);
      }
    } catch {
      // Chat still works when browser storage is unavailable.
    }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem(chatStorageKey, JSON.stringify(chats));
    } catch {
      // Keep the current chat usable if the storage quota is exceeded.
    }
  }, [chats, storageReady]);

  useEffect(() => {
    const end = endOfChat.current;
    if (end?.parentElement) end.parentElement.scrollTop = end.parentElement.scrollHeight;
  }, [turns, busy, plan]);

  function switchChat(id: string) {
    if (menu.current) menu.current.open = false;
    setChats((state) => ({ ...state, active: id }));
    setQuestion("");
    setError("");
    setPlan(undefined);
  }

  function reviewPlan(result: Plan) {
    setAddress(result.q);
    setPlan(result);
  }

  async function run() {
    if (!storageReady || !mode || mode === "disconnected" || busy || !question.trim()) return;
    setError("");
    setPlan(undefined);
    setBusy(true);
    try {
      const previous = turns?.at(-1);
      const bbls = mentions.map((item) => item.bbl);
      const priorBbls = previous?.mentions?.map((item) => item.bbl) ?? (previous?.bbl ? [previous.bbl] : []);
      const sameLots = bbls.length === priorBbls.length && bbls.every((id) => priorBbls.includes(id));
      const result = await request<Reply>("chat", {
        question,
        previous: sameLots ? previous?.question ?? "" : "",
        bbls,
        release,
      });
      const id = chat?.id ?? crypto.randomUUID();
      const turn = { question, bbl: bbls[0] ?? null, mentions, result };
      setChats((state) => ({
        active: id,
        sessions: [
          { id, turns: [...(turns ?? []), turn] },
          ...state.sessions.filter((item) => item.id !== id),
        ],
      }));
      setQuestion("");
      if (result.kind === "search") reviewPlan(result);
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
            <div>
              <button type="button" className="text-button" onClick={() => setPlan(undefined)}>Back to chat</button>
              <button type="button" className="icon-button" aria-label="Close ask ai" onClick={onClose}><X size={16} /></button>
            </div>
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
          onApply={(filters, area) => {
            setPlan(undefined);
            onApply(address.trim(), filters, area !== "all");
          }}
        />
      </>
    );
  }

  return (
    <div className="assistant-content floating-chat">
      <div className="chat-transcript" role="log" aria-label="Chat messages">
      {turns?.map(({ question, mentions, parcelLabel, result }, index) => (
        <div key={index} className="chat-turn">
          <p className="chat-question">{(!!mentions?.length || !!parcelLabel) && <><strong>{mentions?.map((item) => "@" + item.label).join(" · ") || "@" + parcelLabel}</strong><br /></>}{question}</p>
          {result.kind === "answer" ? (
            <div className="assistant-answer">
              <p>{result.answer}</p>
              {result.sources.length > 0 && <ol>{result.sources.map((source) => (
                <li key={source.id} value={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a></li>
              ))}</ol>}
            </div>
          ) : (
            <button type="button" className="text-button" disabled={busy} onClick={() => reviewPlan(result)}>
              Review suggested filters
            </button>
          )}
        </div>
      ))}
      <div ref={endOfChat} />
      </div>
      <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); void run(); }}>
        {mentions.length > 0 && (
          <div className="chat-mentions" aria-label="Attached lots">
            {mentions.map(({ bbl, label }) => (
              <button key={bbl} type="button" className="chat-mention" aria-label={`Remove parcel mention: ${label}`}
                onClick={() => onRemoveMention(bbl)}>
                <span>@{label}</span><X size={13} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
        <label className="sr-only" htmlFor={inputId}>What are you looking for?</label>
        <textarea id={inputId} rows={2} maxLength={700} value={question} disabled={busy}
          placeholder={mentions.length > 1 ? "Ask about these lots…" : mentions.length === 1 ? "What work was permitted here?" : "Find vacant lots over 3,000 sq ft"}
          onChange={(event) => { setQuestion(event.target.value); setPlan(undefined); }} />
        <div className="chat-composer-actions">
          <details ref={menu} className="chat-menu">
            <summary className="icon-button" aria-label="Chat menu" title="Chat menu">
              <Ellipsis size={18} aria-hidden="true" />
            </summary>
            <div className="chat-menu-content">
              <button type="button" disabled={busy} onClick={() => switchChat("")}>
                <Plus size={14} aria-hidden="true" /> New chat
              </button>
              <div className="chat-menu-sessions" role="group" aria-label="Sessions">
                <strong>Sessions</strong>
                {!chats.sessions.length && <span>No saved chats yet</span>}
                {chats.sessions.map(({ id, turns }) => (
                  <button key={id} type="button" disabled={busy} aria-current={id === chat?.id}
                    onClick={() => switchChat(id)}>
                    {turns[0]?.question.trim().slice(0, 70) || "Chat"}
                  </button>
                ))}
              </div>
              {mode === "api" ? <span>API key connected</span> : (
                <button type="button" disabled={busy || mode === undefined} onClick={changeConnection}>
                  {mode === "chatgpt" ? "Disconnect ChatGPT" : "Connect ChatGPT"}
                </button>
              )}
            </div>
          </details>
          <button type="button" className="icon-button" aria-label="Close ask ai" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
          <button className="primary-button assistant-send" type="submit" aria-label="Send"
          title={mode === "disconnected" ? "Connect ChatGPT in AI settings" : "Send"}
          disabled={busy || !storageReady || !mode || mode === "disconnected" || !question.trim()}>
          {busy ? <span role="status">Working…</span> : <ArrowUp size={16} aria-hidden="true" />}
          </button>
        </div>
      </form>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
