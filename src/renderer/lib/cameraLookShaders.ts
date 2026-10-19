import {
  cameraLookExtraUniformNames,
  isCustomCameraLookId,
  type CameraLookId
} from '@shared/cameraLook'

/**
 * One fullscreen pass. Each body defines `vec3 apply(vec2 p, vec3 col, float seed)`.
 * Helpers in the wrapper: tap(uv), grain(), spin(p, radians), luma(col), hash21(p), uTexel.
 * Built-ins also read uP0–uP5. Custom looks add one uniform per slider name.
 * Add a look by appending CAMERA_LOOKS and a body here.
 */

const PRELUDE_UNIFORMS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform vec4 uFit;
uniform float uSeed;
uniform float uP0;
uniform float uP1;
uniform float uP2;
uniform float uP3;
uniform float uP4;
uniform float uP5;
`

const PRELUDE_HELPERS = `
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float grain() {
  return hash21(gl_FragCoord.xy + uSeed * 41.7) - 0.5;
}
vec3 tap(vec2 p) {
  return texture2D(uTex, clamp(p, 0.0, 1.0)).rgb;
}
vec2 spin(vec2 p, float rad) {
  vec2 c = p - 0.5;
  float s = sin(rad);
  float co = cos(rad);
  return vec2(co * c.x - s * c.y, s * c.x + co * c.y) + 0.5;
}
float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}
`

const EPILOGUE = `
void main() {
  vec2 p = (vUv - uFit.zw) / max(uFit.xy, vec2(0.0001));
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 col = tap(p);
  gl_FragColor = vec4(clamp(apply(p, col, uSeed), 0.0, 1.0), 1.0);
}
`

export function cameraLookFragmentSource(body: string, uniformNames: readonly string[] = []): string {
  const extra = cameraLookExtraUniformNames(uniformNames)
    .map((name) => `uniform float ${name};`)
    .join('\n')
  return `${PRELUDE_UNIFORMS}${extra ? `${extra}\n` : ''}${PRELUDE_HELPERS}${body}\n${EPILOGUE}`
}
export const CAMERA_LOOK_BODIES: Record<CameraLookId, string> = {
  'dslr-natural': `
vec3 apply(vec2 p, vec3 col, float seed) {
  col = mix(col, col * col * (3.0 - 2.0 * col), uP0);
  col *= mix(vec3(1.02, 1.0, 0.98), vec3(1.0), 0.5);
  vec2 q = p - 0.5;
  float vig = 1.0 - smoothstep(0.35, 0.95, dot(q, q) * 2.4);
  col *= mix(1.0 - uP1, 1.0, vig);
  col += grain() * uP2 * (0.75 + 0.5 * hash21(vec2(seed, 0.4)));
  return col;
}`,
  'fine-grain': `
vec3 apply(vec2 p, vec3 col, float seed) {
  float g = hash21(gl_FragCoord.xy + seed) - 0.5;
  col += g * uP0;
  col = (col - 0.5) * uP1 + 0.5;
  return col;
}`,
  'high-iso': `
vec3 apply(vec2 p, vec3 col, float seed) {
  float g = grain();
  float c1 = hash21(gl_FragCoord.xy + vec2(seed, 19.0)) - 0.5;
  float c2 = hash21(gl_FragCoord.xy + vec2(7.0, seed * 3.0)) - 0.5;
  col += vec3(g * uP0, c1 * uP1, c2 * uP1);
  float l = luma(col);
  col = mix(vec3(l), col, uP2);
  return col * uP3;
}`,
  'amateur-wb': `
vec3 apply(vec2 p, vec3 col, float seed) {
  float coin = step(0.5, hash21(vec2(seed, 1.7)));
  vec3 warm = vec3(1.0) + vec3(0.12, 0.02, -0.14) * uP0;
  vec3 cool = vec3(1.0) + vec3(-0.1, -0.02, 0.14) * uP0;
  vec3 tint = mix(warm, cool, coin);
  float exposure = 1.0 + (hash21(vec2(seed, 4.2)) - 0.5) * 2.0 * uP1;
  col = col * tint * exposure;
  col += grain() * uP2;
  return col;
}`,
  temperature: `
vec3 apply(vec2 p, vec3 col, float seed) {
  float lo = min(uP0, uP1);
  float hi = max(uP0, uP1);
  float t = mix(lo, hi, hash21(vec2(seed, 21.0)));
  vec3 cold = vec3(0.82, 0.93, 1.16);
  vec3 warm = vec3(1.16, 1.04, 0.78);
  vec3 tint = mix(cold, vec3(1.0), smoothstep(-1.0, 0.0, t));
  tint = mix(tint, warm, smoothstep(0.0, 1.0, t));
  return col * tint;
}`,
  'point-and-shoot': `
vec3 apply(vec2 p, vec3 col, float seed) {
  vec2 s = spin(p, (hash21(vec2(seed, 2.0)) - 0.5) * 0.03);
  float blur = max(uP4, 0.0);
  vec3 soft = tap(s);
  soft += tap(s + uTexel * blur);
  soft += tap(s - uTexel * blur);
  soft += tap(s + vec2(uTexel.x, -uTexel.y) * blur);
  soft += tap(s + vec2(-uTexel.x, uTexel.y) * blur);
  soft /= 5.0;
  col = mix(soft, tap(s), uP0);
  float d = length(s - 0.5);
  vec2 dir = normalize(s - 0.5 + 0.0001);
  float fringe = uP1;
  float r = tap(s + dir * d * fringe).r;
  float b = tap(s - dir * d * fringe).b;
  col = vec3(r, col.g, b);
  col = col * vec3(1.04, 1.02, 0.94) + vec3(0.03, 0.025, 0.01);
  col = (col - 0.5) * 0.9 + 0.52;
  vec2 q = s - 0.5;
  float vig = 1.0 - smoothstep(0.28, 0.8, dot(q, q) * 2.6);
  col *= mix(uP2, 1.0, vig);
  col += grain() * uP3;
  return col;
}`,
  disposable: `
vec3 apply(vec2 p, vec3 col, float seed) {
  vec2 s = spin(p, (hash21(vec2(seed, 8.0)) - 0.5) * 0.045);
  float blur = max(uP0, 0.0);
  vec3 soft = tap(s) + tap(s + uTexel * blur) + tap(s - uTexel * blur);
  soft /= 3.0;
  float rad = length(s - 0.5);
  float flash = 1.0 - smoothstep(0.05, max(uP1, 0.06), rad);
  col = soft * mix(0.45, 1.25, flash);
  col = col * vec3(1.15, 0.98, 0.9);
  col = (col - 0.5) * 1.15 + 0.48;
  col += grain() * uP2;
  return col;
}`,
  'direct-flash': `
vec3 apply(vec2 p, vec3 col, float seed) {
  float rad = length(p - vec2(0.5, 0.42 + (hash21(vec2(seed, 1.0)) - 0.5) * 0.06));
  float flash = 1.0 - smoothstep(0.0, max(uP0, 0.05), rad);
  col *= mix(uP2, uP1, flash);
  col = col * vec3(1.05, 1.0, 0.92);
  col = (col - 0.5) * 1.25 + 0.5;
  float l = luma(col);
  col = mix(vec3(l), col, 0.75);
  col += grain() * uP3;
  return col;
}`,
  'eighties-print': `
vec3 apply(vec2 p, vec3 col, float seed) {
  float l = luma(col);
  col += (hash21(vec2(seed, 3.0)) - 0.5) * 0.02;
  col = mix(vec3(l), col, 0.7);
  col = col * mix(vec3(1.0), vec3(1.12, 1.02, 0.82), uP1) + vec3(0.06, 0.03, 0.0) * uP1;
  col = (col - 0.5) * uP0 + 0.5;
  vec2 q = p - 0.5;
  float vig = 1.0 - smoothstep(0.3, 0.9, dot(q, q) * 2.1);
  col *= mix(uP3, 1.0, vig);
  col += grain() * uP2;
  return col;
}`,
  'slide-film': `
vec3 apply(vec2 p, vec3 col, float seed) {
  float l = luma(col);
  col += vec3(hash21(vec2(seed, 6.0)) * 0.02);
  vec3 shadow = vec3(0.05, 0.16, 0.18);
  vec3 high = vec3(1.05, 0.92, 0.78);
  col = mix(shadow, high, clamp(col * mix(1.0, 1.05, uP1), 0.0, 1.0));
  col = mix(col, vec3(l), 0.15 * uP1);
  col = (col - 0.5) * uP0 + 0.5;
  col += grain() * uP2;
  return col;
}`,
  polaroid: `
vec3 apply(vec2 p, vec3 col, float seed) {
  vec2 s = spin(p, (hash21(vec2(seed, 2.2)) - 0.5) * 0.02);
  float blur = max(uP4, 0.0);
  vec3 soft = tap(s);
  soft += tap(s + uTexel * blur);
  soft += tap(s - uTexel * blur);
  soft /= 3.0;
  col = mix(soft, col, uP0);
  col = col * mix(vec3(1.0), vec3(1.14, 1.04, 0.86), uP1) + vec3(0.04, 0.02, 0.0) * uP1;
  col = (col - 0.5) * 0.86 + 0.52;
  vec2 q = (s - 0.5) * vec2(1.15, 1.0);
  float vig = 1.0 - smoothstep(0.22, 0.62, dot(q, q));
  col *= mix(uP2, 1.0, vig);
  col += grain() * uP3;
  return col;
}`,
  'faded-snapshot': `
vec3 apply(vec2 p, vec3 col, float seed) {
  float lift = mix(0.72, 0.84, hash21(vec2(seed, 1.1)));
  col = col * mix(1.0, lift, uP0) + vec3(0.12, 0.11, 0.08) * uP0;
  col = col * mix(vec3(1.0), vec3(1.05, 1.0, 0.9), uP0);
  float l = luma(col);
  col = mix(col, vec3(l * 0.85, l * 0.95, l), 0.25 * uP0);
  col += grain() * uP1;
  return col;
}`,
  'candid-phone': `
vec3 apply(vec2 p, vec3 col, float seed) {
  vec3 n = tap(p + vec2(uTexel.x, 0.0));
  vec3 s = tap(p - vec2(uTexel.x, 0.0));
  vec3 e = tap(p + vec2(0.0, uTexel.y));
  vec3 w = tap(p - vec2(0.0, uTexel.y));
  vec3 blur = (n + s + e + w) * 0.25;
  col = col + (col - blur) * uP0;
  float c1 = hash21(gl_FragCoord.xy + seed) - 0.5;
  float c2 = hash21(gl_FragCoord.yx + seed * 2.0) - 0.5;
  col += vec3(grain() * uP1, c1 * uP1, c2 * uP1 * 0.9);
  col *= mix(vec3(1.0), vec3(0.96, 1.0, 1.06), uP2);
  return col;
}`,
  'lens-fringe': `
vec3 apply(vec2 p, vec3 col, float seed) {
  float fringe = uP0 * mix(0.7, 1.3, hash21(vec2(seed, 4.0)));
  vec2 c = p - 0.5;
  float d = length(c);
  vec2 dir = c / max(d, 0.0001);
  vec2 off = dir * d * fringe;
  float r = tap(p + off).r;
  float b = tap(p - off).b;
  col = vec3(r, col.g, b);
  float vig = 1.0 - smoothstep(0.3, 0.85, d * 1.4);
  col *= mix(uP1, 1.0, vig);
  col += grain() * uP2;
  return col;
}`,
  'dusty-lens': `
vec2 dustCenter(float i, float seed, float band) {
  float h1 = hash21(vec2(i + 1.7, seed));
  float h2 = hash21(vec2(i + 9.2, seed));
  float h3 = hash21(vec2(seed + 3.0, i + 4.4));
  float side = floor(h1 * 4.0);
  vec2 uv = vec2(h2, h3 * band);
  if (side < 1.0) uv = vec2(h2, h3 * band);
  else if (side < 2.0) uv = vec2(h2, 1.0 - h3 * band);
  else if (side < 3.0) uv = vec2(h3 * band, mix(band, 1.0 - band, h2));
  else uv = vec2(1.0 - h3 * band, mix(band, 1.0 - band, h2));
  return uv;
}
vec3 apply(vec2 p, vec3 col, float seed) {
  col = col * 0.92 + vec3(0.05, 0.04, 0.025);
  col *= vec3(1.06, 1.02, 0.94);
  float lo = min(uP0, uP1);
  float hi = max(uP0, uP1);
  float span = max(hi - lo, 0.0);
  float count = min(hi, lo + floor(hash21(vec2(seed, 18.0)) * (span + 0.999)));
  float sizeLo = min(uP2, uP3);
  float sizeHi = max(uP2, uP3);
  float band = clamp(uP5, 0.08, 0.45);
  float acc = 0.0;
  for (int i = 0; i < 32; i++) {
    float fi = float(i);
    float on = step(fi + 0.5, count);
    vec2 uv = dustCenter(fi, seed, band);
    float sz = max(mix(sizeLo, sizeHi, hash21(vec2(seed, fi + 11.0))), 1.0);
    vec2 delta = (p - uv) / max(uTexel, vec2(0.00001));
    delta.x *= mix(0.75, 1.35, hash21(vec2(fi, seed + 6.0)));
    float d = length(delta);
    float blob = (1.0 - smoothstep(sz * 0.2, sz, d)) * on;
    acc = max(acc, blob * mix(0.72, 1.0, hash21(vec2(seed, fi + 3.0))));
  }
  vec3 dustCol = vec3(0.72, 0.66, 0.52);
  vec3 spot = mix(col, dustCol, 0.82);
  col = mix(col, spot, clamp(acc * uP4, 0.0, 0.95));
  vec2 q = p - 0.5;
  float vig = 1.0 - smoothstep(0.25, 0.9, dot(q, q) * 2.2);
  col *= mix(0.6, 1.0, vig);
  col += grain() * 0.04;
  return col;
}`,
  handshake: `
vec3 apply(vec2 p, vec3 col, float seed) {
  float ang = hash21(vec2(seed, 5.5)) * 6.28318;
  ang = mix(ang, 0.0, step(0.5, uP2) * (1.0 - step(1.5, uP2)));
  ang = mix(ang, 1.5707963, step(1.5, uP2));
  vec2 dir = vec2(cos(ang), sin(ang)) * uTexel * max(uP0, 0.0);
  vec3 sharp = tap(p);
  col = sharp * 0.36;
  col += tap(p + dir) * 0.2;
  col += tap(p - dir) * 0.2;
  col += tap(p + dir * 2.0) * 0.12;
  col += tap(p - dir * 2.0) * 0.12;
  col = mix(col, sharp, clamp(uP1, 0.0, 0.9));
  col += grain() * 0.03;
  return col;
}`,
  'available-light': `
vec3 apply(vec2 p, vec3 col, float seed) {
  col *= uP0 * mix(0.85, 1.15, hash21(vec2(seed, 9.0)));
  col *= vec3(0.92, 1.05, 0.9);
  float g = grain();
  float c1 = hash21(gl_FragCoord.xy * 1.7 + seed) - 0.5;
  col += vec3(g * uP1, c1 * uP1 * 0.57, g * uP1 * 0.43);
  vec2 q = p - 0.5;
  float vig = 1.0 - smoothstep(0.2, 0.75, dot(q, q) * 2.8);
  col *= mix(uP2, 1.0, vig);
  return col;
}`
}

export const CAMERA_LOOK_PLAIN_BODY = `vec3 apply(vec2 p, vec3 col, float seed) {
  return col;
}`

export function cameraLookFragmentBody(id: string, customFragment: string): string | null {
  if (isCustomCameraLookId(id)) {
    const body = customFragment.trim()
    if (!body.includes('vec3 apply')) return null
    return body
  }
  if (!Object.prototype.hasOwnProperty.call(CAMERA_LOOK_BODIES, id)) return null
  return CAMERA_LOOK_BODIES[id as CameraLookId]
}

export const CAMERA_LOOK_CUSTOM_PLACEHOLDER = `vec3 apply(vec2 p, vec3 col, float seed) {
  // p is 0..1 over the photo.
  // tap(uv), grain(), spin(p, radians), luma(col), hash21(p), uTexel.
  // Slider names are uniforms. The first one is amount.
  return col;
}`
