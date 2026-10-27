// =============================================================================
// AuthArt - the sign-in page's left panel illustration.
//
// Monochrome line art (strokes/fills come from the panel's --art-* tokens, so
// it inverts with the theme): a courthouse in the distance, a drafted
// document with its seal, a gavel, and the next-hearing card - joined by a
// dotted thread (draft -> hearing). Composed around the side tabs
// (centre-right) and the tagline (bottom-left), which sit on top of it.
// =============================================================================

export function AuthArt() {
  return (
    <svg
      className="auth-art-svg"
      viewBox="0 0 440 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      focusable="false"
    >
      <defs>
        <pattern id="auth-dots" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="1.2" cy="1.2" r="1.2" className="aa-dot" />
        </pattern>
        <radialGradient id="auth-glow" cx="30%" cy="35%" r="70%">
          <stop offset="0%" className="aa-glow-a" />
          <stop offset="100%" className="aa-glow-b" />
        </radialGradient>
      </defs>

      {/* Ground: soft light from the upper left + a dotted paper texture. */}
      <rect width="440" height="600" fill="url(#auth-glow)" />
      <rect width="440" height="600" fill="url(#auth-dots)" className="aa-texture" />

      {/* Courthouse in the distance (top right). */}
      <g className="aa-faint" transform="translate(214 74)">
        <path d="M0 62 L102 10 L204 62 Z" />
        <path d="M14 62 H190" />
        <circle cx="102" cy="42" r="8" />
        {[22, 58, 94, 130, 166].map((x) => (
          <g key={x}>
            <path d={`M${x} 70 H${x + 18}`} />
            <path d={`M${x + 3} 70 V140 M${x + 15} 70 V140`} />
            <path d={`M${x} 140 H${x + 18}`} />
          </g>
        ))}
        <path d="M6 148 H198 M-4 156 H208 M-14 164 H218" />
      </g>

      {/* Drafted document, slightly tilted (left). */}
      <g transform="translate(40 112) scale(0.84) rotate(-6 80 110)">
        <path className="aa-sheet-back" d="M14 10 H170 V232 H14 Z" />
        <path className="aa-sheet" d="M0 0 H130 L160 30 V222 H0 Z" />
        <path className="aa-line" d="M130 0 V30 H160" />
        <path className="aa-strong" d="M44 28 H116" />
        <path className="aa-line" d="M58 40 H102" />
        {[64, 78, 92, 106, 120, 134, 148].map((y, i) => (
          <path key={y} className="aa-line" d={`M18 ${y} H${i % 3 === 2 ? 104 : 142}`} />
        ))}
        {/* Seal + signature */}
        <circle className="aa-seal" cx="42" cy="184" r="20" />
        <circle className="aa-line" cx="42" cy="184" r="14" />
        <path className="aa-strong" d="M35 184 l5 5 l9 -11" />
        <path className="aa-line" d="M84 192 c8 -14 14 -14 16 -2 c2 10 8 10 14 -4 c3 -6 8 -6 12 0" />
        <path className="aa-line" d="M82 202 H140" />
      </g>

      {/* Gavel on its block (bottom left, above the tagline). */}
      <g transform="translate(30 398) scale(0.9)">
        <rect className="aa-fill" x="18" y="74" width="92" height="16" rx="4" />
        <rect className="aa-fill" x="30" y="66" width="68" height="10" rx="3" />
        <g transform="rotate(-32 70 40)">
          <rect className="aa-fill" x="34" y="18" width="62" height="26" rx="6" />
          <path className="aa-line" d="M46 18 V44 M84 18 V44" />
          <rect className="aa-fill" x="62" y="44" width="8" height="58" rx="3" />
        </g>
      </g>

      {/* Next-hearing card (bottom right, under the tabs). */}
      <g transform="translate(206 396)">
        <rect className="aa-card" x="0" y="0" width="204" height="86" rx="14" />
        <rect className="aa-chip" x="14" y="16" width="40" height="44" rx="8" />
        <text className="aa-chip-m" x="34" y="32" textAnchor="middle">OCT</text>
        <text className="aa-chip-d" x="34" y="52" textAnchor="middle">27</text>
        <text className="aa-k" x="66" y="30">NEXT HEARING</text>
        <text className="aa-v" x="66" y="48">10:30 · Court 4</text>
        <text className="aa-s" x="66" y="64">Arguments · on time</text>
        <circle className="aa-ok" cx="186" cy="20" r="5" />
      </g>

      {/* Thread: draft -> next hearing. */}
      <path className="aa-thread" d="M112 318 C 112 372, 160 430, 204 436" />
      <circle className="aa-node" cx="112" cy="318" r="3.5" />

      {/* Small sparkles. */}
      <path className="aa-spark" d="M196 108 v12 M190 114 h12" />
      <path className="aa-spark" d="M28 362 v8 M24 366 h8" />
      <path className="aa-spark" d="M404 520 v10 M399 525 h10" />
    </svg>
  );
}
