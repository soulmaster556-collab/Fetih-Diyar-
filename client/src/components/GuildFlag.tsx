import { GUILD_FLAG_DEFS } from "../game/guildFlags";

function GuildFlagEmblem({ emblem }: { emblem: string }) {
  const fill = "rgba(255,255,255,0.92)";
  switch (emblem) {
    case "star":
      return (
        <path
          d="M0,-3.2 L0.9,-1 L3.2,-1 L1.3,0.4 L2,2.8 L0,1.4 L-2,2.8 L-1.3,0.4 L-3.2,-1 L-0.9,-1 Z"
          fill={fill}
        />
      );
    case "wave":
      return (
        <g fill="none" stroke={fill} strokeWidth="1" strokeLinecap="round">
          <path d="M-3.4,-1.2 Q-1.7,-2.6 0,-1.2 T3.4,-1.2" />
          <path d="M-3.4,1.6 Q-1.7,0.2 0,1.6 T3.4,1.6" />
        </g>
      );
    case "tree":
      return (
        <g fill={fill}>
          <path d="M0,-3.4 L2.6,1.2 H1 L2.2,3 H-2.2 L-1,1.2 H-2.6 Z" />
        </g>
      );
    case "diamond":
      return <rect x="-2.2" y="-2.2" width="4.4" height="4.4" transform="rotate(45)" fill={fill} />;
    case "moon":
      return <path d="M0.6,-3.2 A3.2,3.2 0 1 0 0.6,3.2 A2.3,2.3 0 1 1 0.6,-3.2 Z" fill={fill} />;
    case "tower":
      return (
        <g fill={fill}>
          <path d="M-2,-1 L0,-3.4 L2,-1 Z" />
          <rect x="-1.6" y="-1" width="3.2" height="4.4" />
          <rect x="-0.5" y="0.6" width="1" height="1.2" fill="rgba(0,0,0,0.32)" />
        </g>
      );
    case "cross":
      return (
        <g fill={fill}>
          <rect x="-0.7" y="-3" width="1.4" height="6" />
          <rect x="-2.6" y="-0.7" width="5.2" height="1.4" />
        </g>
      );
    case "sun":
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
    case "paw":
      return (
        <g fill={fill}>
          <ellipse cx="0" cy="1" rx="1.8" ry="1.4" />
          <circle cx="-1.6" cy="-1.4" r="0.85" />
          <circle cx="0" cy="-2.1" r="0.85" />
          <circle cx="1.6" cy="-1.4" r="0.85" />
        </g>
      );
    case "stripe":
    default:
      return <rect x="-4.6" y="-0.8" width="9.2" height="1.6" transform="rotate(-18)" fill={fill} opacity="0.8" />;
  }
}

export function GuildFlag({ flagId, size = 28, title }: { flagId: number; size?: number; title?: string }) {
  const def = GUILD_FLAG_DEFS.find((f) => f.id === flagId) ?? GUILD_FLAG_DEFS[0];
  const gradId = `guildFlagGrad${def.id}`;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="guild-flag-svg">
      {title ? <title>{def.name}</title> : null}
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={def.colors[0]} />
          <stop offset="100%" stopColor={def.colors[1]} />
        </linearGradient>
      </defs>
      <rect x="3" y="1.6" width="1.6" height="20.8" rx="0.6" fill="#caa23a" />
      <path
        d="M4.6 3 H19.5 L15.8 8 L19.5 13 H4.6 Z"
        fill={`url(#${gradId})`}
        stroke="rgba(0,0,0,0.25)"
        strokeWidth="0.4"
      />
      <g transform="translate(10.9 8)">
        <GuildFlagEmblem emblem={def.emblem} />
      </g>
    </svg>
  );
}
