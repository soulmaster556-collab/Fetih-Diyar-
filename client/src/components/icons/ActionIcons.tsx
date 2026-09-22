// Aksiyon menüsünün cilalı/3D altıgen rozetlerinin üzerine oturan sade,
// beyaz siluetli vektör ikonlar. Renk rozetten (hex-action-shape
// gradyanı) geliyor, ikon sadece net bir silüet olsun diye düz beyaz.
export function ActionIconSword() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <g transform="rotate(45 12 12)">
        <rect x="10.6" y="1.2" width="2.8" height="12.4" rx="1.2" fill="#fff" />
        <rect x="6.8" y="13.4" width="10.4" height="2.6" rx="1.1" fill="#fff" />
        <rect x="10.8" y="15.6" width="2.4" height="5.2" rx="1" fill="#fff" opacity="0.92" />
        <circle cx="12" cy="21.4" r="1.7" fill="#fff" />
      </g>
    </svg>
  );
}
export function ActionIconShield() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path
        d="M12 2.2L19.5 5.1V10.4C19.5 15.6 16.5 19.5 12 21.6C7.5 19.5 4.5 15.6 4.5 10.4V5.1L12 2.2Z"
        fill="#fff"
      />
      <path d="M12 4.6V19.1" stroke="rgba(0,0,0,0.22)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
export function ActionIconScout() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <g transform="rotate(-38 12 12)">
        <path d="M8.5 4.2 L18 6.4 L18.6 9.4 L8 10.8 Z" fill="#fff" />
        <rect x="4.6" y="9.6" width="4.4" height="4.4" rx="1" fill="#fff" />
        <circle cx="18.3" cy="7.9" r="1" fill="rgba(0,0,0,0.25)" />
      </g>
    </svg>
  );
}
export function ActionIconUpgrade() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path d="M12 3.2L19.6 11.6H15.4V20.4H8.6V11.6H4.4L12 3.2Z" fill="#fff" />
    </svg>
  );
}
