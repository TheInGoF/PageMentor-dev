// Kräfte-Layout fürs Begriffsnetz: ohne Ränder rechnen, am Ende ins Bild einpassen (sonst kleben Punkte an der Kante).
// Deterministisch: Startpunkte auf einer Spirale, gleiche Daten ergeben dasselbe Bild
export function brainLayout(ids: string[], edges: Array<{ a: string; b: string }>, W: number, H: number, margin = 60): Map<string, { x: number; y: number }> {
  const n = Math.max(1, ids.length);
  const pos = ids.map((_, i) => {
    const a = i * 2.39996;
    const r = 10 * Math.sqrt(i + 1);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
  const idx = new Map(ids.map((id, i) => [id, i]));
  const links = edges.map((e) => [idx.get(e.a), idx.get(e.b)] as const).filter((l): l is readonly [number, number] => l[0] !== undefined && l[1] !== undefined && l[0] !== l[1]);
  const k = 30;
  const steps = n > 200 ? 200 : 300;
  for (let s = 0; s < steps; s++) {
    const temp = 12 * (1 - s / steps) + 0.5;
    const dx = new Float64Array(n), dy = new Float64Array(n);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const x = pos[i].x - pos[j].x, y = pos[i].y - pos[j].y;
        const d2 = Math.max(1, x * x + y * y);
        const f = (k * k) / d2;
        dx[i] += x * f; dy[i] += y * f;
        dx[j] -= x * f; dy[j] -= y * f;
      }
    for (const [a, b] of links) {
      const x = pos[a].x - pos[b].x, y = pos[a].y - pos[b].y;
      const d = Math.max(1, Math.hypot(x, y));
      const f = d / k;
      dx[a] -= x * f; dy[a] -= y * f;
      dx[b] += x * f; dy[b] += y * f;
    }
    for (let i = 0; i < n; i++) {
      // Schwerkraft zur Mitte: einzelne Begriffe und getrennte Gruppen bleiben nah
      dx[i] -= pos[i].x * 0.6;
      dy[i] -= pos[i].y * 0.6;
      const l = Math.max(1e-6, Math.hypot(dx[i], dy[i]));
      const m = Math.min(l, temp);
      pos[i].x += (dx[i] / l) * m;
      pos[i].y += (dy[i] / l) * m;
    }
  }
  // Einpassen: Seitenverhältnis des Bildes, Rand für Beschriftungen
  const xs = pos.map((p) => p.x), ys = pos.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const sx = (W - 2 * margin) / Math.max(1, maxX - minX), sy = (H - 2 * margin) / Math.max(1, maxY - minY);
  return new Map(ids.map((id, i) => [id, { x: margin + (pos[i].x - minX) * sx, y: margin + (pos[i].y - minY) * sy }]));
}
