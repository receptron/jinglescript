// The built-in demo clip, for visitors without a video of their own: a ball drops in, bounces three
// times, rolls to the middle and turns into a logo. Drawn from the time alone, so it follows the
// audio exactly when scrubbed or replayed. The default marks sit on its moments.
import type { Mark } from "./score.ts";

export const DEMO_SECONDS = 7;
export const DEMO_WIDTH = 640;
export const DEMO_HEIGHT = 360;

/** Where the ball touches the ground, and when the logo appears. */
export const DEMO_MOMENTS = { bounces: [1.0, 1.8, 2.4], logo: 4.0 } as const;

export const DEMO_MARKS: readonly Mark[] = [
  { id: "b1", t: DEMO_MOMENTS.bounces[0], sound: "pop" },
  { id: "b2", t: DEMO_MOMENTS.bounces[1], sound: "pop" },
  { id: "b3", t: DEMO_MOMENTS.bounces[2], sound: "pop" },
  { id: "in", t: DEMO_MOMENTS.logo, sound: "whoosh" },
  { id: "logo", t: DEMO_MOMENTS.logo, sound: "impact" },
];
export const DEMO_HIT_MARK = "logo";

const GROUND = 300;
const BALL = 26;
const LOGO_POP_SECONDS = 0.35;

/** The ball's height above the ground: a fall, then three shrinking hops between the bounces. */
function ballLift(t: number): number {
  const [b1, b2, b3] = DEMO_MOMENTS.bounces;
  if (t < b1) return 260 * (1 - (t / b1) ** 2);
  const hop = (start: number, end: number, height: number) => {
    const u = (t - start) / (end - start);
    return 4 * height * u * (1 - u);
  };
  if (t < b2) return hop(b1, b2, 120);
  if (t < b3) return hop(b2, b3, 50);
  return 0;
}

function ballX(t: number): number {
  const rollEnd = DEMO_MOMENTS.logo - 0.4;
  const u = Math.min(1, t / rollEnd);
  return 90 + (DEMO_WIDTH / 2 - 90) * (1 - (1 - u) ** 2);
}

function drawBackground(context: CanvasRenderingContext2D): void {
  const sky = context.createLinearGradient(0, 0, 0, DEMO_HEIGHT);
  sky.addColorStop(0, "#7dd3fc");
  sky.addColorStop(1, "#e0f2fe");
  context.fillStyle = sky;
  context.fillRect(0, 0, DEMO_WIDTH, DEMO_HEIGHT);
  context.fillStyle = "#65a30d";
  context.fillRect(0, GROUND + BALL, DEMO_WIDTH, DEMO_HEIGHT - GROUND - BALL);
}

function drawBall(context: CanvasRenderingContext2D, t: number): void {
  const squash = DEMO_MOMENTS.bounces.some((b) => Math.abs(t - b) < 0.05) ? 0.75 : 1;
  context.fillStyle = "#f97316";
  context.beginPath();
  context.ellipse(ballX(t), GROUND - ballLift(t) + BALL * (1 - squash), BALL / squash, BALL * squash, 0, 0, 2 * Math.PI);
  context.fill();
}

function drawLogo(context: CanvasRenderingContext2D, t: number): void {
  const since = t - DEMO_MOMENTS.logo;
  const grow = Math.min(1, since / LOGO_POP_SECONDS);
  const scale = grow < 1 ? 0.3 + 0.95 * grow : 1 + 0.03 * Math.sin(since * 6);
  context.save();
  context.translate(DEMO_WIDTH / 2, DEMO_HEIGHT / 2 - 10);
  context.scale(scale, scale);
  context.fillStyle = "#1e293b";
  context.font = "bold 56px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("YOUR LOGO", 0, 0);
  context.restore();
}

/** Draws the demo clip at `t` seconds. */
export function drawDemo(context: CanvasRenderingContext2D, t: number): void {
  drawBackground(context);
  if (t < DEMO_MOMENTS.logo) drawBall(context, t);
  else drawLogo(context, t);
}
