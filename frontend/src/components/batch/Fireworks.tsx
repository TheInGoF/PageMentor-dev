// Statisches Feuerwerk für den Abschluss: drei Bursts aus Strahlen und Funken, kein Bewegtbild
const BURSTS = [
  { x: 90, y: 70, r: 46, color: "#eb6834" },
  { x: 210, y: 50, r: 56, color: "#2a78d6" },
  { x: 320, y: 80, r: 40, color: "#1baf7a" },
  { x: 150, y: 120, r: 30, color: "#eda100" },
  { x: 270, y: 125, r: 26, color: "#e87ba4" },
];

export function Fireworks() {
  return (
    <svg viewBox="0 0 400 170" className="w-full h-auto" role="img" aria-hidden>
      <rect width="400" height="170" rx="12" fill="#0f1730" />
      {Array.from({ length: 40 }, (_, i) => (
        <circle key={`s${i}`} cx={(i * 97) % 400} cy={(i * 53) % 170} r={i % 3 === 0 ? 1.2 : 0.7} fill="#ffffff" opacity={0.5} />
      ))}
      {BURSTS.map((b, bi) =>
        Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2;
          const x1 = b.x + Math.cos(a) * b.r * 0.25;
          const y1 = b.y + Math.sin(a) * b.r * 0.25;
          const x2 = b.x + Math.cos(a) * b.r;
          const y2 = b.y + Math.sin(a) * b.r;
          return (
            <g key={`${bi}-${i}`}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={b.color} strokeWidth={2} strokeLinecap="round" />
              <circle cx={b.x + Math.cos(a) * b.r * 1.15} cy={b.y + Math.sin(a) * b.r * 1.15} r={1.8} fill={b.color} />
            </g>
          );
        })
      )}
      {BURSTS.map((b, bi) => (
        <line key={`t${bi}`} x1={b.x - 6} y1={170} x2={b.x} y2={b.y + b.r * 0.3} stroke={b.color} strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="3 4" />
      ))}
    </svg>
  );
}
