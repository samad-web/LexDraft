// =============================================================================
// LandingArt - the landing hero's background illustration.
//
// Monochrome line art in theme tokens (inverts with dark mode): a courthouse
// with the scales of justice hung between its pillars, and the app's own
// pieces floating in front of it - an eCourts sync chip, a drafted document
// with its seal, the next-hearing card and a paid invoice - joined by dotted
// threads. Sits behind the hero copy on the right and fades out to the left
// (CSS mask) so the headline always reads cleanly.
// =============================================================================

export function LandingArt() {
  return (
    <div className="lx-art" aria-hidden>
      <svg viewBox="0 0 760 640" preserveAspectRatio="xMaxYMid meet" focusable="false">
        <defs>
          <pattern id="lx-dots" width="18" height="18" patternUnits="userSpaceOnUse">
            <circle cx="1.3" cy="1.3" r="1.3" className="lx-dot" />
          </pattern>
          <filter id="lx-shadow" x="-20%" y="-20%" width="140%" height="160%">
            <feDropShadow dx="0" dy="10" stdDeviation="12" className="lx-shadow" />
          </filter>
        </defs>

        <rect width="760" height="640" fill="url(#lx-dots)" />

        {/* Courthouse */}
        <g className="lx-faint" transform="translate(300 92)">
          <path d="M0 96 L210 8 L420 96 Z" />
          <path d="M26 96 H394 M14 108 H406" />
          <circle cx="210" cy="66" r="14" />
          <path d="M210 52 V80 M196 66 H224" />
          {[40, 112, 266, 338].map((x) => (
            <g key={x}>
              <path d={`M${x - 6} 118 H${x + 30}`} />
              <path d={`M${x} 118 V358 M${x + 8} 122 V354 M${x + 16} 122 V354 M${x + 24} 118 V358`} />
              <path d={`M${x - 6} 358 H${x + 30}`} />
            </g>
          ))}
          <path d="M-6 372 H426 M-22 388 H442 M-38 404 H458" />
        </g>

        {/* Scales of justice, hung between the inner pillars */}
        <g className="lx-mid" transform="translate(510 214)">
          <path d="M0 -4 V128" />
          <path d="M-22 140 H22 M-34 150 H34" />
          <path d="M-70 10 H70" />
          <circle cx="0" cy="-8" r="5" />
          <path d="M-70 10 L-96 72 M-70 10 L-44 72 M70 10 L44 72 M70 10 L96 72" />
          <path d="M-102 72 Q-70 98 -38 72 Z" />
          <path d="M38 72 Q70 98 102 72 Z" />
        </g>

        {/* eCourts sync chip (top right) */}
        <g filter="url(#lx-shadow)" transform="translate(500 34) rotate(2)">
          <rect className="lx-card" width="232" height="58" rx="29" />
          <circle className="lx-ink" cx="30" cy="29" r="15" />
          <path className="lx-on-ink" d="M23 29 l5 5 l9 -10" />
          <text className="lx-v" x="56" y="26">CNR synced</text>
          <text className="lx-s" x="56" y="43">eCourts · 2 new orders</text>
        </g>

        {/* Paid invoice chip (right, mid) */}
        <g filter="url(#lx-shadow)" transform="translate(586 298) rotate(-3)">
          <rect className="lx-card" width="156" height="62" rx="14" />
          <text className="lx-k" x="16" y="24">INVOICE</text>
          <text className="lx-v" x="16" y="46">₹ 45,000</text>
          <rect className="lx-pill" x="98" y="32" width="44" height="20" rx="10" />
          <text className="lx-pill-t" x="120" y="46" textAnchor="middle">PAID</text>
        </g>

        {/* Drafted document (left of the courthouse, low) */}
        <g filter="url(#lx-shadow)" transform="translate(316 360) rotate(-8 80 110)">
          <path className="lx-card" d="M0 0 H128 L160 32 V226 H0 Z" />
          <path className="lx-line" d="M128 0 V32 H160" />
          <path className="lx-strong" d="M44 30 H116" />
          <path className="lx-line" d="M58 44 H102" />
          {[70, 86, 102, 118, 134, 150].map((y, i) => (
            <path key={y} className="lx-line" d={`M18 ${y} H${i % 3 === 2 ? 100 : 142}`} />
          ))}
          <circle className="lx-seal" cx="42" cy="190" r="20" />
          <circle className="lx-line" cx="42" cy="190" r="14" />
          <path className="lx-strong" d="M35 190 l5 5 l9 -11" />
          <path className="lx-line" d="M84 198 c8 -14 14 -14 16 -2 c2 10 8 10 14 -4 c3 -6 8 -6 12 0" />
          <path className="lx-line" d="M82 208 H140" />
        </g>

        {/* Next-hearing card (bottom right) */}
        <g filter="url(#lx-shadow)" transform="translate(512 486) rotate(1.5)">
          <rect className="lx-card" width="226" height="90" rx="16" />
          <rect className="lx-ink" x="16" y="18" width="44" height="54" rx="10" />
          <text className="lx-chip-m" x="38" y="38" textAnchor="middle">OCT</text>
          <text className="lx-chip-d" x="38" y="61" textAnchor="middle">27</text>
          <text className="lx-k" x="76" y="34">NEXT HEARING</text>
          <text className="lx-v" x="76" y="53">10:30 · Court 4</text>
          <text className="lx-s" x="76" y="70">High Court of Madras</text>
        </g>

        {/* Threads */}
        <path className="lx-thread" d="M470 470 C 500 520, 500 530, 512 530" />
        <path className="lx-thread" d="M616 92 C 640 160, 680 230, 664 298" />
        <circle className="lx-node" cx="470" cy="470" r="4" />
        <circle className="lx-node" cx="616" cy="92" r="4" />

        {/* Sparkles */}
        <path className="lx-spark" d="M452 64 v14 M445 71 h14" />
        <path className="lx-spark" d="M740 420 v10 M735 425 h10" />
        <path className="lx-spark" d="M290 300 v10 M285 305 h10" />
      </svg>
    </div>
  );
}
