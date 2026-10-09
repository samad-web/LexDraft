import { useRef, useState, useEffect } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from '@lexdraft/ui';
import type { AutoDraftResponse, DraftChatResponse, DraftChatTurn } from '@lexdraft/types';
import { useDraftChat, type LlmProvider } from '@/hooks/useDrafting';
import { useDictation } from '@/hooks/useDictation';
import { contextToBriefPreamble, type DraftCaseContext } from '@/lib/draft-case-context';
import { classifyQuestions } from '@/lib/draft-clarify';
import {
  chatResponseToTurn, answersToBrief, CHAT_GREETING, CHAT_ERROR,
  type ChatTurn, type AssistantTurn,
} from '@/lib/draft-chat';

// =============================================================================
// DraftChatPanel — drafting as a conversation.
//
// The advocate types (or dictates) what happened in plain words. The tool
// replies IN THE THREAD — asks what it needs, they answer in words or by
// tapping a chip, and the finished draft appears right there. No forms, no
// software terms. It never invents legal facts: a skipped question becomes a
// ____ blank, and citations still pass the grounding + audit engine underneath.
// =============================================================================

interface Props {
  provider?: LlmProvider;
  caseContext?: DraftCaseContext | null;
  /** Called when the advocate taps "Use this draft" on a drafted turn. */
  onUseDraft: (response: AutoDraftResponse) => void;
}

export function DraftChatPanel({ provider, caseContext, onUseDraft }: Props) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const chat = useDraftChat();
  const dictation = useDictation();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, chat.isPending]);

  // Send a message to the conversational endpoint. `extra` carries a hidden
  // context suffix (case particulars on the first turn, or answered details from
  // a quick-answer card) that the engine should treat as facts but which we do
  // NOT echo as an advocate bubble.
  const send = (visibleText: string, extra?: string) => {
    if (chat.isPending) return;
    const shown = visibleText.trim();
    if (shown) setTurns((t) => [...t, { role: 'advocate', text: shown }]);

    // The message the SERVER sees: what the advocate said + any hidden context.
    const isFirst = turns.length === 0;
    const preamble = isFirst && caseContext ? `${contextToBriefPreamble(caseContext)}\n\n` : '';
    const serverMessage = `${preamble}${shown}${extra ?? ''}`.trim();

    // History for the model = the visible conversation so far (roles + text).
    const history: DraftChatTurn[] = turns
      .filter((t): t is { role: 'advocate' | 'assistant'; text: string } & ChatTurn =>
        t.role === 'advocate' || t.role === 'assistant')
      .map((t) => ({ role: t.role, text: t.role === 'advocate' ? t.text : (t as AssistantTurn).text }));

    chat.mutate(
      { message: serverMessage, history, ...(provider ? { provider } : {}) },
      {
        onSuccess: (res: DraftChatResponse) => setTurns((t) => [...t, chatResponseToTurn(res)]),
        onError: () => setTurns((t) => [...t, { role: 'assistant', kind: 'error', text: CHAT_ERROR }]),
      },
    );
  };

  const onComposerSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    send(text);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onComposerSend(); }
  };

  const toggleMic = () => dictation.toggle((t) => setInput((cur) => (cur ? `${cur} ${t}` : t)));

  const empty = turns.length === 0;

  return (
    <div className="col" style={{ gap: 0, height: '100%', minHeight: 480 }}>
      {/* ---- Conversation ---- */}
      <div ref={scrollRef} className="col" style={{ gap: 14, flex: 1, overflowY: 'auto', paddingBottom: 12 }}>
        {empty && <AssistantBubble text={CHAT_GREETING} />}
        {turns.map((turn, i) =>
          turn.role === 'advocate'
            ? <AdvocateBubble key={i} text={turn.text} />
            : <AssistantRenderer
                key={i}
                turn={turn}
                busy={chat.isPending}
                onAnswers={(appendix, summary) => send(summary, appendix)}
                onConfirmDoc={(dt) => send(`Yes, draft the ${dt}.`)}
                onUseDraft={onUseDraft}
              />,
        )}
        {chat.isPending && <AssistantBubble text="Working on it…" muted />}
      </div>

      {/* ---- Composer ---- */}
      <div className="card" style={{ padding: 10, display: 'flex', gap: 8, alignItems: 'flex-end', position: 'sticky', bottom: 0 }}>
        <textarea
          className="input"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder={empty ? 'Tell me what happened, e.g. "bail for Ramesh, cheating, no prior record"' : 'Answer, or tell me what to change…'}
          style={{ flex: 1, resize: 'none' }}
        />
        {dictation.supported && (
          <button
            type="button"
            className={`btn btn-ghost btn-sm ${dictation.listening ? 'active' : ''}`}
            onClick={toggleMic}
            title={dictation.listening ? 'Stop' : 'Dictate'}
          >
            <Icon name={dictation.listening ? 'micOff' : 'mic'} size={16} />
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={onComposerSend} disabled={chat.isPending || !input.trim()}>
          <Icon name="arrow" size={14} /> Send
        </button>
      </div>
    </div>
  );
}

// ---- Bubbles ---------------------------------------------------------------

function AdvocateBubble({ text }: { text: string }) {
  return (
    <div className="row" style={{ justifyContent: 'flex-end' }}>
      <div className="card" style={{ padding: '10px 14px', maxWidth: '78%', background: 'var(--bg-surface-2)', borderColor: 'var(--border-strong)' }}>
        <p className="body-sm" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{text}</p>
      </div>
    </div>
  );
}

function AssistantBubble({ text, children, muted }: { text: string; children?: React.ReactNode; muted?: boolean }) {
  return (
    <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
      <div style={{ marginTop: 2, flexShrink: 0 }}><Icon name="draft" size={16} /></div>
      <div className="card" style={{ padding: '10px 14px', maxWidth: '82%', display: 'flex', flexDirection: 'column', gap: 10, opacity: muted ? 0.7 : 1 }}>
        <p className="body-sm" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{text}</p>
        {children}
      </div>
    </div>
  );
}

// ---- Assistant turn renderers ----------------------------------------------

function AssistantRenderer({
  turn, busy, onAnswers, onConfirmDoc, onUseDraft,
}: {
  turn: AssistantTurn;
  busy: boolean;
  onAnswers: (briefAppendix: string, visibleSummary: string) => void;
  onConfirmDoc: (docType: string) => void;
  onUseDraft: (r: AutoDraftResponse) => void;
}) {
  if (turn.kind === 'error' || turn.kind === 'say') return <AssistantBubble text={turn.text} />;

  if (turn.kind === 'confirm') {
    return (
      <AssistantBubble text={turn.text}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onConfirmDoc(turn.docType!)}>
            Yes, {lowerLabel(turn.docType!)}
          </button>
          {(turn.alternatives ?? []).slice(0, 5).map((alt) => (
            <button key={alt} className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onConfirmDoc(alt)}>
              {alt}
            </button>
          ))}
        </div>
      </AssistantBubble>
    );
  }

  if (turn.kind === 'ask') {
    return <AssistantBubble text={turn.text}><QuickAnswers questions={turn.questions ?? []} busy={busy} onDone={onAnswers} /></AssistantBubble>;
  }

  // draft
  return (
    <AssistantBubble text={turn.text}>
      {turn.response && <DraftPreview response={turn.response} busy={busy} onUse={() => onUseDraft(turn.response!)} />}
    </AssistantBubble>
  );
}

/** The in-thread quick-answer form: chips for known options, inputs otherwise.
 *  Reuses the classification from draft-clarify so options are legally sensible.
 *  onDone gets (hiddenAppendix, visibleSummary): the appendix is folded into the
 *  message the engine reads; the summary is echoed as the advocate's reply so
 *  the thread reads naturally. */
function QuickAnswers({ questions, busy, onDone }: { questions: string[]; busy: boolean; onDone: (appendix: string, summary: string) => void }) {
  const fields = classifyQuestions(questions);
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const f of fields) if (f.kind === 'choice' && f.options?.length) seed[f.question] = f.options[0]!;
    return seed;
  });
  const [done, setDone] = useState(false);
  const set = (q: string, v: string) => setAnswers((cur) => ({ ...cur, [q]: v }));

  if (done) return <p className="body-xs muted" style={{ margin: 0 }}>Thanks, drafting with those.</p>;

  return (
    <div className="col" style={{ gap: 12 }}>
      {fields.map((f) => (
        <div key={f.question} className="col" style={{ gap: 5 }}>
          <span className="body-sm" style={{ fontWeight: 600 }}>{f.question.replace(/\s*\?\s*$/, '')}</span>
          {f.kind === 'choice' && f.options ? (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {f.options.map((opt) => {
                const active = answers[f.question] === opt;
                return (
                  <button key={opt} type="button" className={`btn btn-sm${active ? ' btn-primary' : ' btn-ghost'}`}
                    onClick={() => set(f.question, active ? '' : opt)}>{opt}</button>
                );
              })}
            </div>
          ) : f.kind === 'longtext' ? (
            <textarea className="input" rows={2} value={answers[f.question] ?? ''} placeholder={f.hint ?? ''} onChange={(e) => set(f.question, e.target.value)} style={{ resize: 'vertical' }} />
          ) : (
            <input className="input" value={answers[f.question] ?? ''} placeholder={f.hint ?? ''} onChange={(e) => set(f.question, e.target.value)} style={{ maxWidth: 420 }} />
          )}
        </div>
      ))}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setDone(true); onDone('', 'Go ahead and draft it, leaving blanks for the rest.'); }}>
          Skip: draft with blanks
        </button>
        <span className="spacer" style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => {
          setDone(true);
          const filled = Object.entries(answers).filter(([, v]) => (v ?? '').trim());
          const summary = filled.length
            ? filled.map(([q, v]) => `${q.replace(/\s*\?\s*$/, '')}: ${v}`).join('; ')
            : 'Draft it.';
          onDone(answersToBrief(answers), summary);
        }}>
          <Icon name="draft" size={13} /> Draft it
        </button>
      </div>
    </div>
  );
}

function DraftPreview({ response, busy, onUse }: { response: AutoDraftResponse; busy: boolean; onUse: () => void }) {
  const draft = response.pipeline?.draft ?? {};
  const entries = Object.entries(draft);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="card" style={{ padding: 12, maxHeight: 320, overflowY: 'auto', background: 'var(--bg-surface-2)' }}>
        {entries.length === 0
          ? <p className="body-sm muted" style={{ margin: 0 }}>(empty draft)</p>
          : entries.map(([key, text]) => (
              <div key={key} className="col" style={{ gap: 3, marginBottom: 10 }}>
                <span className="body-xs muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>{key}</span>
                <p className="body-sm" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{text}</p>
              </div>
            ))}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <span className="spacer" style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onUse}>
          <Icon name="check" size={13} /> Use this draft
        </button>
      </div>
    </div>
  );
}

function lowerLabel(s: string): string {
  if (/^[A-Z0-9 ()/]+$/.test(s)) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}
