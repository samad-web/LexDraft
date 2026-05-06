import {
  useEffect, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent,
} from 'react';
import { Icon } from './Icon';

export interface TimePickerProps {
  /** 24-hour HH:MM, or empty string for unselected. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  id?: string;
  style?: CSSProperties;
  name?: string;
  /** Minute step shown in the panel. Defaults to 5. */
  minuteStep?: number;
}

const PANEL_GAP = 6;
const PANEL_WIDTH = 240;
const PANEL_MAX_HEIGHT = 320;

function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }

function parseTime(v: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

function nowHM(): { h: number; m: number } {
  const t = new Date();
  return { h: t.getHours(), m: t.getMinutes() };
}

function format12(v: string): string {
  const p = parseTime(v);
  if (!p) return '';
  const period = p.h >= 12 ? 'PM' : 'AM';
  const hour12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${hour12}:${pad(p.m)} ${period}`;
}

export function TimePicker({
  value, onChange, placeholder = 'Pick a time', disabled, invalid,
  className = '', id, style, name, minuteStep = 5,
}: TimePickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hoursColRef = useRef<HTMLDivElement>(null);
  const minutesColRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const reactId = useId();
  const panelId = `${id ?? reactId}-tp`;

  const parsed = parseTime(value);
  const selH = parsed?.h ?? null;
  const selM = parsed?.m ?? null;

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes: number[] = [];
  for (let i = 0; i < 60; i += minuteStep) minutes.push(i);

  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return;
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const spaceBelow = window.innerHeight - r.bottom;
    const flipUp = spaceBelow < PANEL_MAX_HEIGHT && r.top > spaceBelow;
    setPanelStyle({
      position: 'fixed',
      left: Math.min(r.left, window.innerWidth - PANEL_WIDTH - 16),
      width: PANEL_WIDTH,
      top: flipUp ? undefined : r.bottom + PANEL_GAP,
      bottom: flipUp ? window.innerHeight - r.top + PANEL_GAP : undefined,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Centre the selected hour / minute when the panel opens.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const scrollSelected = (col: HTMLDivElement | null) => {
        if (!col) return;
        const sel = col.querySelector<HTMLElement>('[data-selected="true"]');
        if (sel) col.scrollTop = sel.offsetTop - col.clientHeight / 2 + sel.clientHeight / 2;
      };
      scrollSelected(hoursColRef.current);
      scrollSelected(minutesColRef.current);
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
      e.preventDefault();
      setOpen(true);
    }
  };

  const setH = (h: number) => onChange(`${pad(h)}:${pad(selM ?? 0)}`);
  const setM = (m: number) => onChange(`${pad(selH ?? 9)}:${pad(m)}`);
  const setNow = () => {
    const n = nowHM();
    onChange(`${pad(n.h)}:${pad(n.m)}`);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        name={name}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-invalid={invalid || undefined}
        className={`select-trigger ${className}`}
        style={style}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onTriggerKey}
      >
        <span className={value ? '' : 'muted'}>
          {value ? format12(value) : placeholder}
        </span>
        <span
          className="select-chevron"
          aria-hidden
          style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--text-secondary)' }}
        >
          <Icon name="limitation" size={14} />
        </span>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Choose time"
          id={panelId}
          className="select-menu timepicker-panel"
          style={{ ...panelStyle, padding: 12 }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div
                className="mono"
                style={{ fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'center', letterSpacing: '0.18em', marginBottom: 6 }}
              >
                HOUR
              </div>
              <div ref={hoursColRef} className="timepicker-col">
                {hours.map((h) => {
                  const isSel = selH === h;
                  return (
                    <button
                      key={h}
                      type="button"
                      data-selected={isSel}
                      className={`timepicker-cell${isSel ? ' is-selected' : ''}`}
                      onClick={() => setH(h)}
                    >
                      {pad(h)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div
                className="mono"
                style={{ fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'center', letterSpacing: '0.18em', marginBottom: 6 }}
              >
                MIN
              </div>
              <div ref={minutesColRef} className="timepicker-col">
                {minutes.map((m) => {
                  const isSel = selM === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      data-selected={isSel}
                      className={`timepicker-cell${isSel ? ' is-selected' : ''}`}
                      onClick={() => setM(m)}
                    >
                      {pad(m)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
            <button type="button" className="btn btn-sm" onClick={() => onChange('')}>Clear</button>
            <button type="button" className="btn btn-sm" onClick={setNow}>Now</button>
          </div>
        </div>
      )}
    </>
  );
}
