import { useEffect, useRef } from 'react';

// Pulled from the app's own palette so the burst reads as part of the UI
// rather than a generic party effect: the browns and cream of the panels,
// plus the green already used for "done" pills.
const CONFETTI_COLORS = ['#6f2f1d', '#964127', '#c8763f', '#e0b784', '#1e6a3c', '#8d5a46'];

const PARTICLE_COUNT = 90;
const GRAVITY = 0.22;
const DRAG = 0.988;
const MAX_LIFE_MS = 1800;

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  width: number;
  height: number;
  color: string;
  born: number;
};

function createParticles(width: number, height: number, now: number): Particle[] {
  const originX = width / 2;
  const originY = height * 0.42;

  return Array.from({ length: PARTICLE_COUNT }, () => {
    // Bias the spread wide and slightly upward so it arcs like a popper
    // instead of raining straight down.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    const speed = 6 + Math.random() * 9;
    return {
      x: originX + (Math.random() - 0.5) * 60,
      y: originY + (Math.random() - 0.5) * 30,
      vx: Math.cos(angle) * speed * (0.7 + Math.random() * 0.9),
      vy: Math.sin(angle) * speed,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.3,
      width: 6 + Math.random() * 6,
      height: 9 + Math.random() * 7,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      born: now + Math.random() * 120,
    };
  });
}

/**
 * Fires a one-off confetti burst whenever `burstKey` increases. Renders a
 * fixed, non-interactive canvas that only paints while a burst is running.
 */
export default function Confetti({ burstKey }: { burstKey: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (burstKey <= 0) return;

    // Someone who has asked the OS to reduce motion should not get a screenful
    // of flying paper.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.opacity = '1';
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const start = performance.now();
    const particles = createParticles(width, height, start);

    function draw(now: number) {
      if (!canvas || !context) return;
      context.clearRect(0, 0, width, height);
      let alive = 0;

      for (const particle of particles) {
        if (now < particle.born) {
          alive += 1;
          continue;
        }

        const age = now - particle.born;
        if (age > MAX_LIFE_MS) continue;
        alive += 1;

        particle.vy += GRAVITY;
        particle.vx *= DRAG;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.rotation += particle.spin;

        // Hold full opacity for most of the flight, then fade out over the
        // last third so pieces dissolve instead of blinking away.
        const fade = Math.max(0, Math.min(1, (1 - age / MAX_LIFE_MS) * 3));

        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.globalAlpha = fade;
        context.fillStyle = particle.color;
        context.fillRect(-particle.width / 2, -particle.height / 2, particle.width, particle.height);
        context.restore();
      }

      if (alive > 0) {
        frameRef.current = requestAnimationFrame(draw);
      } else {
        context.clearRect(0, 0, width, height);
        canvas.style.opacity = '0';
        frameRef.current = null;
      }
    }

    frameRef.current = requestAnimationFrame(draw);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      context.clearRect(0, 0, width, height);
      canvas.style.opacity = '0';
    };
  }, [burstKey]);

  return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true" />;
}
