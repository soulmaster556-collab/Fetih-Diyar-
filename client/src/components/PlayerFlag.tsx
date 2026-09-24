import { FLAG_COLORS, FLAG_LOGOS, FLAG_SHAPES } from "../game/playerFlags";

// İlk 10 case GuildFlagEmblem'deki (GuildFlag.tsx) amblemlerle aynı --
// bilerek kod tekrarı: iki dosya birbirinden habersiz, ayrı sistemler
// (bkz. playerFlags.ts dosya başı yorumu), ortak bir bileşene çıkarmak
// gereksiz bir bağımlılık yaratırdı.
function PlayerFlagLogo({ logoId }: { logoId: number }) {
  const fill = "rgba(255,255,255,0.92)";
  switch (logoId) {
    case 1: // Yıldız
      return <path d="M0,-3.2 L0.9,-1 L3.2,-1 L1.3,0.4 L2,2.8 L0,1.4 L-2,2.8 L-1.3,0.4 L-3.2,-1 L-0.9,-1 Z" fill={fill} />;
    case 2: // Dalga
      return (
        <g fill="none" stroke={fill} strokeWidth="1" strokeLinecap="round">
          <path d="M-3.4,-1.2 Q-1.7,-2.6 0,-1.2 T3.4,-1.2" />
          <path d="M-3.4,1.6 Q-1.7,0.2 0,1.6 T3.4,1.6" />
        </g>
      );
    case 3: // Ağaç
      return <path d="M0,-3.4 L2.6,1.2 H1 L2.2,3 H-2.2 L-1,1.2 H-2.6 Z" fill={fill} />;
    case 4: // Elmas
      return <rect x="-2.2" y="-2.2" width="4.4" height="4.4" transform="rotate(45)" fill={fill} />;
    case 5: // Ay
      return <path d="M0.6,-3.2 A3.2,3.2 0 1 0 0.6,3.2 A2.3,2.3 0 1 1 0.6,-3.2 Z" fill={fill} />;
    case 6: // Kule
      return (
        <g fill={fill}>
          <path d="M-2,-1 L0,-3.4 L2,-1 Z" />
          <rect x="-1.6" y="-1" width="3.2" height="4.4" />
          <rect x="-0.5" y="0.6" width="1" height="1.2" fill="rgba(0,0,0,0.32)" />
        </g>
      );
    case 7: // Haç
      return (
        <g fill={fill}>
          <rect x="-0.7" y="-3" width="1.4" height="6" />
          <rect x="-2.6" y="-0.7" width="5.2" height="1.4" />
        </g>
      );
    case 8: // Güneş
      return (
        <g stroke={fill} strokeWidth="0.9" strokeLinecap="round">
          <circle cx="0" cy="0" r="1.6" fill={fill} stroke="none" />
          <line x1="0" y1="-2" x2="0" y2="-3.5" />
          <line x1="0" y1="2" x2="0" y2="3.5" />
          <line x1="-2" y1="0" x2="-3.5" y2="0" />
          <line x1="2" y1="0" x2="3.5" y2="0" />
          <line x1="-1.4" y1="-1.4" x2="-2.5" y2="-2.5" />
          <line x1="1.4" y1="1.4" x2="2.5" y2="2.5" />
          <line x1="-1.4" y1="1.4" x2="-2.5" y2="2.5" />
          <line x1="1.4" y1="-1.4" x2="2.5" y2="-2.5" />
        </g>
      );
    case 9: // Pati
      return (
        <g fill={fill}>
          <ellipse cx="0" cy="1" rx="1.8" ry="1.4" />
          <circle cx="-1.6" cy="-1.4" r="0.85" />
          <circle cx="0" cy="-2.1" r="0.85" />
          <circle cx="1.6" cy="-1.4" r="0.85" />
        </g>
      );
    case 10: // Şerit
      return <rect x="-4.6" y="-0.8" width="9.2" height="1.6" transform="rotate(-18)" fill={fill} opacity="0.8" />;
    case 11: // Çapraz kılıçlar
      return (
        <g stroke={fill} strokeWidth="1" strokeLinecap="round">
          <line x1="-2.8" y1="-2.8" x2="2.8" y2="2.8" />
          <line x1="2.8" y1="-2.8" x2="-2.8" y2="2.8" />
          <circle cx="-2.8" cy="-2.8" r="0.6" fill={fill} stroke="none" />
          <circle cx="2.8" cy="-2.8" r="0.6" fill={fill} stroke="none" />
        </g>
      );
    case 12: // Kalkan
      return <path d="M0,-3.2 L2.6,-2 V0.6 Q2.6,2.6 0,3.4 Q-2.6,2.6 -2.6,0.6 V-2 Z" fill={fill} />;
    case 13: // Yıldırım
      return <path d="M0.8,-3.4 L-2,0.4 H-0.2 L-0.8,3.4 L2.2,-0.6 H0.4 Z" fill={fill} />;
    case 14: // Alev
      return <path d="M0,-3.4 Q2.4,-0.8 1.4,1 Q1.8,-0.2 0.8,-0.4 Q1.2,1.4 0,3.4 Q-2.4,1.6 -1.6,-0.6 Q-1.2,0.6 -0.6,0.2 Q-1.4,-1.6 0,-3.4 Z" fill={fill} />;
    case 15: // Damla
      return <path d="M0,-3.4 Q2.4,0.6 2.4,2 A2.4,2.4 0 1 1 -2.4,2 Q-2.4,0.6 0,-3.4 Z" fill={fill} />;
    case 16: // Çapa
      return (
        <g stroke={fill} strokeWidth="0.9" strokeLinecap="round" fill="none">
          <circle cx="0" cy="-2.4" r="0.9" fill={fill} stroke="none" />
          <line x1="0" y1="-1.5" x2="0" y2="3" />
          <line x1="-1.8" y1="-0.4" x2="1.8" y2="-0.4" />
          <path d="M-2.6,1 Q-2.6,3.4 0,3.4" />
          <path d="M2.6,1 Q2.6,3.4 0,3.4" />
        </g>
      );
    case 17: // Ok
      return (
        <g stroke={fill} strokeWidth="0.9" strokeLinecap="round">
          <line x1="0" y1="3.2" x2="0" y2="-2.4" />
          <path d="M-2,-0.6 L0,-3.2 L2,-0.6" fill="none" />
        </g>
      );
    case 18: // Taç
      return <path d="M-2.8,1.8 L-2.2,-1.4 L-0.9,0.4 L0,-2 L0.9,0.4 L2.2,-1.4 L2.8,1.8 Z" fill={fill} />;
    case 19: // Halka
      return <circle cx="0" cy="0" r="2.4" fill="none" stroke={fill} strokeWidth="1.1" />;
    case 20: // Kurukafa
    default:
      return (
        <g fill={fill}>
          <circle cx="0" cy="-0.6" r="2.4" />
          <rect x="-1.6" y="1.2" width="3.2" height="1.6" />
          <circle cx="-0.9" cy="-0.6" r="0.6" fill="rgba(0,0,0,0.5)" />
          <circle cx="0.9" cy="-0.6" r="0.6" fill="rgba(0,0,0,0.5)" />
        </g>
      );
  }
}

// Referans görseldeki kumaş kıvrımı -- TÜM renk/şekil kombinasyonlarında
// AYNI, renkten bağımsız yarı saydam katman (bkz. playerFlags.ts dosya başı
// yorumu). Sadece gövdenin üst üçte birinde, ince koyu eğrilerle.
function FlagFolds() {
  return (
    <g stroke="rgba(0,0,0,0.18)" strokeWidth="0.6" fill="none" strokeLinecap="round">
      <path d="M6,8 Q11,11 16,8 T27,8" />
      <path d="M6,13 Q11,16.5 16,13 T27,13" />
      <path d="M8,4 L11,8" stroke="rgba(255,255,255,0.22)" />
      <path d="M22,4 L19,8" stroke="rgba(255,255,255,0.22)" />
    </g>
  );
}

export function PlayerFlag({
  shapeId,
  colorId,
  logoId,
  size = 28,
  title,
}: {
  shapeId: number;
  colorId: number;
  logoId: number;
  size?: number;
  title?: string;
}) {
  const shape = FLAG_SHAPES.find((s) => s.id === shapeId) ?? FLAG_SHAPES[0];
  const color = FLAG_COLORS.find((c) => c.id === colorId) ?? FLAG_COLORS[0];
  const logo = FLAG_LOGOS.find((l) => l.id === logoId) ?? FLAG_LOGOS[0];
  const clipId = `playerFlagClip${shapeId}`;
  return (
    <svg viewBox="0 0 32 64" width={size} height={size * 2} className="player-flag-svg">
      {title ? <title>{`${shape.name} · ${color.name} · ${logo.name}`}</title> : null}
      <defs>
        <clipPath id={clipId}>
          <path d={shape.path} />
        </clipPath>
      </defs>
      <rect x="2" y="2" width="1.8" height="60" rx="0.7" fill="#caa23a" />
      <path d={shape.path} fill={color.hex} stroke="rgba(0,0,0,0.28)" strokeWidth="0.5" />
      <g clipPath={`url(#${clipId})`}>
        <FlagFolds />
      </g>
      <g transform="translate(16 22)">
        <PlayerFlagLogo logoId={logo.id} />
      </g>
    </svg>
  );
}
