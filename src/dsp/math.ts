// Deterministic math for rendering. JavaScript engines may compute Math.sin, Math.exp, Math.pow
// (and `**`) differently across versions and CPUs — Node 22 and 24 already disagree on pow — so
// the same score would render different PCM on different machines. These functions use only
// +, −, ×, ÷, Math.sqrt, Math.floor and comparisons, which IEEE 754 makes identical everywhere.
// They follow fdlibm (the classic C library algorithms): range reduction, then minimax
// polynomials; accuracy is within a few ulps of Math.* (tested).
//
// Rendering code imports from here; the lint config forbids Math.sin & co. and `**` in src/.

const HALF_PI_1 = 1.5707963267341256; // first 33 bits of π/2
const HALF_PI_2 = 6.077100506303966e-11; // next 33 bits
const HALF_PI_3 = 2.0222662487111665e-21; // the rest
const TWO_OVER_PI = 0.6366197723675814;

const S1 = -1.6666666666666632e-1;
const S2 = 8.33333333332249e-3;
const S3 = -1.984126982985795e-4;
const S4 = 2.7557313707070068e-6;
const S5 = -2.5050760253406863e-8;
const S6 = 1.5896909952115501e-10;
const C1 = 4.16666666666666e-2;
const C2 = -1.388888888874114e-3;
const C3 = 2.480158728947673e-5;
const C4 = -2.7557314351390663e-7;
const C5 = 2.087572321298175e-9;
const C6 = -1.1359647557788195e-11;

function kernelSin(x: number): number {
  const z = x * x;
  return x + z * x * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
}

function kernelCos(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z;
  const w = 1 - hz;
  return w + (1 - w - hz + z * r);
}

/** x reduced to [−π/4, π/4] and the quadrant it came from (0–3). */
function reduce(x: number): { r: number; quadrant: number } {
  const n = Math.floor(x * TWO_OVER_PI + 0.5);
  const r = x - n * HALF_PI_1 - n * HALF_PI_2 - n * HALF_PI_3;
  const quadrant = n - 4 * Math.floor(n / 4);
  return { r, quadrant };
}

export function sin(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  const { r, quadrant } = reduce(x);
  if (quadrant === 0) return kernelSin(r);
  if (quadrant === 1) return kernelCos(r);
  if (quadrant === 2) return -kernelSin(r);
  return -kernelCos(r);
}

export function cos(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  const { r, quadrant } = reduce(x);
  if (quadrant === 0) return kernelCos(r);
  if (quadrant === 1) return -kernelSin(r);
  if (quadrant === 2) return -kernelCos(r);
  return kernelSin(r);
}

export function tan(x: number): number {
  return sin(x) / cos(x);
}

// Powers of two, exact, for scaling: POW2[k + 1074] = 2^k for k in [−1074, 1023].
const POW2_MIN = -1074;
const POW2 = (() => {
  const table = new Float64Array(1023 - POW2_MIN + 1);
  let v = 1;
  for (let k = 0; k <= 1023; k++, v *= 2) table[k - POW2_MIN] = v;
  v = 1;
  for (let k = 0; k >= POW2_MIN; k--, v /= 2) table[k - POW2_MIN] = v;
  return table;
})();

function pow2(k: number): number {
  if (k > 1023) return Infinity;
  if (k < POW2_MIN) return 0;
  return POW2[k - POW2_MIN] ?? 0;
}

const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.4426950408889634;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;

export function exp(x: number): number {
  if (Number.isNaN(x)) return x;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  const k = Math.floor(x * INV_LN2 + 0.5);
  const hi = x - k * LN2_HI;
  const lo = k * LN2_LO;
  const r = hi - lo;
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const y = 1 - (lo - (r * c) / (2 - c) - hi);
  // Scale in two steps so a result near the subnormal range is not rounded twice wrongly.
  return k < -1000 ? y * pow2(k + 100) * pow2(-100) : y * pow2(k);
}

const SQRT2 = 1.4142135623730951;
const LG1 = 6.66666666666673513e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

/** k such that x / 2^k is in [√2/2, √2), by binary search over exact powers of two. */
function exponentOf(x: number): number {
  let low = POW2_MIN;
  let high = 1023;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (pow2(mid) * (SQRT2 / 2) <= x) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function log(x: number): number {
  if (Number.isNaN(x) || x < 0) return Number.NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  const k = exponentOf(x);
  // x / 2^k, exactly (a power-of-two scale), in two steps for subnormal x.
  const m = k < -1000 ? x * pow2(100) * pow2(-k - 100) : x * pow2(-k);
  const f = m - 1;
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const hfsq = 0.5 * f * f;
  return k * LN2_HI - (hfsq - (s * (hfsq + t2 + t1) + k * LN2_LO) - f);
}

const LN10 = 2.302585092994046;
export function log10(x: number): number {
  return log(x) / LN10;
}

export function log2(x: number): number {
  return log(x) * INV_LN2;
}

/** x^y. For x > 0 it is exp(y·log x); a negative x needs an integer y. */
export function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) {
    if (!Number.isInteger(y)) return Number.NaN;
    const magnitude = exp(y * log(-x));
    return y % 2 === 0 ? magnitude : -magnitude;
  }
  return exp(y * log(x));
}

/** 10^(dB/20): a level in dB as a gain. */
export function dbToGain(db: number): number {
  return exp(db * (LN10 / 20));
}

/** 20·log10(gain): a gain as a level in dB. */
export function gainToDb(gain: number): number {
  return (20 / LN10) * log(gain);
}

const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.570796326794896558];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.1111110405462355788e-1, 9.09088713343650656196e-2,
  -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2, -3.6531572744216915527e-2,
  1.62858201153657823623e-2,
];

function atanReduced(x: number): { x: number; id: number } {
  if (x < 0.4375) return { x, id: -1 };
  if (x < 0.6875) return { x: (2 * x - 1) / (2 + x), id: 0 };
  if (x < 1.1875) return { x: (x - 1) / (x + 1), id: 1 };
  if (x < 2.4375) return { x: (x - 1.5) / (1 + 1.5 * x), id: 2 };
  return { x: -1 / x, id: 3 };
}

export function atan(value: number): number {
  if (Number.isNaN(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const { x, id } = atanReduced(sign * value);
  const a = (i: number): number => AT[i] ?? 0;
  const z = x * x;
  const w = z * z;
  const s1 = z * (a(0) + w * (a(2) + w * (a(4) + w * (a(6) + w * (a(8) + w * a(10))))));
  const s2 = w * (a(1) + w * (a(3) + w * (a(5) + w * (a(7) + w * a(9)))));
  if (id < 0) return sign * (x - x * (s1 + s2));
  return sign * ((ATAN_HI[id] ?? 0) - (x * (s1 + s2) - (ATAN_LO[id] ?? 0) - x));
}

export const PI = 3.141592653589793;

export function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  if (y > 0) return PI / 2;
  if (y < 0) return -PI / 2;
  return 0;
}

export function hypot(a: number, b: number): number {
  return Math.sqrt(a * a + b * b);
}
