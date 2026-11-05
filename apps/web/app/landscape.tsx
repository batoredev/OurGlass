/**
 * The landscape behind the sign-in hero and the chat greeting — an original
 * drawing in the spirit of the suggested design (2026-11-05): an ultramarine
 * sky, a sunlit snow peak, a lake, meadows, cypresses and one small house.
 *
 * The view box starts at y=140: the sky above the clouds is empty, so the
 * drawing scales by width without cropping a cloud.
 *
 * Decoration only: hidden from assistive technology, and the sky and halftone
 * texture come from the surrounding CSS (`.landscape-panel`), so this draws the
 * land and nothing that carries meaning.
 */
export function Landscape({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 140 1440 420"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      {/* Sunset clouds, left and right */}
      <g fill="#f3a079">
        <circle cx="70" cy="214" r="46" />
        <circle cx="130" cy="196" r="54" />
        <circle cx="205" cy="212" r="42" />
        <circle cx="262" cy="230" r="30" />
        <circle cx="318" cy="240" r="20" />
        <rect x="40" y="214" width="300" height="46" rx="23" />
        <circle cx="1180" cy="268" r="36" />
        <circle cx="1246" cy="246" r="50" />
        <circle cx="1320" cy="232" r="58" />
        <circle cx="1398" cy="250" r="46" />
        <rect x="1150" y="262" width="300" height="44" rx="22" />
      </g>
      <g fill="#f9cba6">
        <circle cx="118" cy="186" r="30" />
        <circle cx="176" cy="198" r="22" />
        <circle cx="1300" cy="222" r="34" />
        <circle cx="1352" cy="228" r="24" />
      </g>

      {/* The mountain range: shadowed rock, sunlit faces, snow */}
      <path
        d="M470 432 L612 352 L700 330 L760 300 L822 266 L900 206 L978 262 L1040 284 L1082 256 L1150 298 L1240 292 L1322 328 L1384 322 L1440 344 L1440 432 Z"
        fill="#3a3f9c"
      />
      <path d="M900 206 L822 266 L760 300 L700 330 L640 362 L736 386 L846 334 L906 268 Z" fill="#d8602f" />
      <path d="M900 206 L862 238 L840 268 L888 252 L910 228 Z" fill="#ef8b52" />
      <path d="M1082 256 L1040 284 L1004 312 L1060 318 L1090 282 Z" fill="#cf5a2c" />
      <path d="M1240 292 L1196 314 L1176 336 L1236 334 L1252 306 Z" fill="#cf5a2c" />
      <path d="M900 206 L872 232 L886 238 L898 230 L912 244 L928 234 L946 240 Z" fill="#fbf1e2" />
      <path d="M1082 256 L1066 270 L1078 273 L1090 266 L1102 275 Z" fill="#fbf1e2" />

      {/* The lake, its far shore and an island */}
      <path d="M500 424 L1440 408 L1440 500 L560 512 Z" fill="#2742c4" />
      <path d="M520 426 L1440 410 L1440 424 L540 438 Z" fill="#1c2f9a" />
      <g fill="#7f93ea" opacity=".75">
        <rect x="900" y="446" width="120" height="3" rx="1.5" />
        <rect x="1080" y="462" width="160" height="3" rx="1.5" />
        <rect x="760" y="472" width="90" height="3" rx="1.5" />
        <rect x="1260" y="444" width="110" height="3" rx="1.5" />
      </g>
      <ellipse cx="1150" cy="424" rx="92" ry="15" fill="#2f5a2a" />
      <ellipse cx="1126" cy="414" rx="34" ry="12" fill="#3f7530" />

      {/* Lakeside cypresses */}
      <g fill="#1d4a2a">
        <ellipse cx="1000" cy="408" rx="9" ry="34" />
        <ellipse cx="1024" cy="414" rx="8" ry="27" />
        <ellipse cx="1052" cy="404" rx="10" ry="38" />
      </g>

      {/* The hill with the house, its path and fence */}
      <path d="M0 326 C160 296 330 298 470 344 C600 386 700 430 770 476 L770 560 L0 560 Z" fill="#5f9a2e" />
      <path d="M0 358 C180 330 360 334 520 380 C620 410 700 450 742 490 L0 490 Z" fill="#79b53a" />
      <path d="M232 330 C300 344 380 358 456 374 C520 388 580 404 640 424" fill="none" stroke="#c99a68" strokeWidth="7" strokeLinecap="round" />
      <path d="M250 346 C330 360 404 372 474 388 C540 402 598 418 650 438" fill="none" stroke="#7a4b2c" strokeWidth="2" />
      <g stroke="#7a4b2c" strokeWidth="3" strokeLinecap="round">
        <line x1="262" y1="338" x2="262" y2="352" />
        <line x1="330" y1="350" x2="330" y2="364" />
        <line x1="398" y1="362" x2="398" y2="376" />
        <line x1="466" y1="378" x2="466" y2="392" />
        <line x1="534" y1="394" x2="534" y2="408" />
        <line x1="600" y1="412" x2="600" y2="426" />
      </g>
      <g>
        <rect x="160" y="290" width="66" height="36" fill="#f4e6cc" />
        <path d="M152 294 L193 266 L234 294 Z" fill="#d4532c" />
        <rect x="208" y="272" width="8" height="14" fill="#a8401f" />
        <rect x="172" y="302" width="10" height="10" fill="#3a3f9c" />
        <rect x="204" y="302" width="10" height="10" fill="#3a3f9c" />
      </g>
      <g fill="#1d4a2a">
        <ellipse cx="116" cy="270" rx="15" ry="62" />
        <ellipse cx="142" cy="282" rx="12" ry="48" />
        <ellipse cx="272" cy="292" rx="11" ry="40" />
      </g>
      <g fill="#2f6b37">
        <ellipse cx="112" cy="262" rx="6" ry="44" />
        <ellipse cx="138" cy="278" rx="5" ry="34" />
      </g>

      {/* The meadow in front, rocks and flowers */}
      <path d="M0 448 C220 426 420 446 600 498 C680 522 744 546 790 560 L0 560 Z" fill="#8cc444" />
      <ellipse cx="330" cy="522" rx="62" ry="26" fill="#7b6656" />
      <ellipse cx="316" cy="512" rx="40" ry="14" fill="#93806f" />
      <ellipse cx="660" cy="546" rx="44" ry="16" fill="#6c5a4c" />
      <g fill="#f6c34a">
        <circle cx="60" cy="500" r="5" />
        <circle cx="96" cy="520" r="4" />
        <circle cx="150" cy="506" r="5" />
        <circle cx="204" cy="532" r="4" />
        <circle cx="450" cy="530" r="4" />
        <circle cx="520" cy="546" r="5" />
      </g>
      <g fill="#f39a5a">
        <circle cx="76" cy="536" r="4" />
        <circle cx="128" cy="544" r="5" />
        <circle cx="240" cy="508" r="4" />
        <circle cx="410" cy="548" r="4" />
      </g>
    </svg>
  );
}
