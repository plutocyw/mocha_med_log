/** One-time Halloween 2026 event; never repeats next year. */
export function isHalloweenCelebration(now: Date): boolean {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return date >= '2026-10-29' && date < '2026-11-01';
}

export const BAT_LIFE_MS = 2200;
export type Bat = {
  x: number; y: number; dx: number; dy: number; size: number;
  phase: number; born: number; color: string;
};

export function createBats(width: number, height: number, now: number): Bat[] {
  return Array.from({ length: 64 }, (_, i) => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.45;
    const distance = Math.max(width, height) * (0.55 + Math.random() * 0.5);
    return {
      x: width / 2 + (Math.random() - 0.5) * 80,
      y: height * 0.48 + (Math.random() - 0.5) * 40,
      dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance,
      size: 12 + Math.random() * 13, phase: Math.random() * Math.PI * 2,
      born: now + i * 7, color: i % 3 === 0 ? '#48273f' : '#211d2b',
    };
  });
}

/** Time-based flight and flapping keep the same speed on 60/120 Hz displays. */
export function drawBat(ctx: CanvasRenderingContext2D, bat: Bat, age: number) {
  const t = age / BAT_LIFE_MS;
  const flight = 1 - Math.pow(1 - t, 1.6);
  const flap = Math.sin(age / 65 + bat.phase);
  ctx.save();
  ctx.translate(bat.x + bat.dx * flight + Math.sin(age / 150 + bat.phase) * 18,
    bat.y + bat.dy * flight + Math.sin(age / 180 + bat.phase) * 12);
  ctx.rotate(Math.max(-0.45, Math.min(0.45, bat.dx / 1000)));
  ctx.scale(bat.size, bat.size * (0.65 + flap * 0.25));
  ctx.globalAlpha = Math.min(1, age / 100, (1 - t) * 5);
  ctx.fillStyle = bat.color;
  ctx.strokeStyle = '#b995c6';
  ctx.lineWidth = 0.035;
  // Pointed ears and scalloped wings form a recognizable bat silhouette.
  ctx.beginPath();
  ctx.moveTo(0, -0.16);
  ctx.lineTo(-0.17, -0.48); ctx.lineTo(-0.25, -0.10);
  ctx.quadraticCurveTo(-0.55, -0.22, -1.05, -0.65);
  ctx.quadraticCurveTo(-0.91, -0.10, -0.98, 0.15);
  ctx.quadraticCurveTo(-0.62, -0.06, -0.57, 0.36);
  ctx.quadraticCurveTo(-0.33, 0.13, -0.21, 0.48);
  ctx.lineTo(0, 0.69); ctx.lineTo(0.21, 0.48);
  ctx.quadraticCurveTo(0.33, 0.13, 0.57, 0.36);
  ctx.quadraticCurveTo(0.62, -0.06, 0.98, 0.15);
  ctx.quadraticCurveTo(0.91, -0.10, 1.05, -0.65);
  ctx.quadraticCurveTo(0.55, -0.22, 0.25, -0.10);
  ctx.lineTo(0.17, -0.48); ctx.lineTo(0, -0.16);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}
