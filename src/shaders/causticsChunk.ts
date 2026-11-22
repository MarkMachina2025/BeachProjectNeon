/**
 * Realistic Optical Wave-Interference Curvature Caustics (Jos Stam wave-superposition method).
 * Replaces artificial Voronoi hexagons/honeycombs with flowing, curved, organic
 * refractive sunlit light webs derived from multi-directional interfering wave trains
 * and their spatial curvature (Laplacian lensing).
 */
export const CAUSTICS_GLSL = /* glsl */ `
float causticWaveField(vec2 p, float t) {
  float w = 0.0;
  float freq = 1.0;
  float amp = 1.0;

  // Non-orthogonal wave vectors eliminate any hexagonal or grid symmetry
  vec2 d1 = vec2( 0.891,  0.454);
  vec2 d2 = vec2(-0.529,  0.848);
  vec2 d3 = vec2(-0.788, -0.616);
  vec2 d4 = vec2( 0.258, -0.966);

  mat2 rot = mat2(0.84, -0.54, 0.54, 0.84);

  for (int i = 0; i < 3; i++) {
    float p1 = dot(p, d1) * freq + t * 1.15;
    float p2 = dot(p, d2) * freq - t * 0.92;
    float p3 = dot(p, d3) * freq + t * 0.78;
    float p4 = dot(p, d4) * freq - t * 1.08;

    w += (sin(p1) + cos(p2) + sin(p3) + cos(p4)) * amp;
    p = rot * p * 1.37 + vec2(1.7, -2.3);
    freq *= 1.18;
    amp *= 0.50;
  }
  return w;
}

float opticalCausticIntensity(vec2 uv, float t) {
  float eps = 0.14;
  float c  = causticWaveField(uv, t);
  float cx = causticWaveField(uv + vec2(eps, 0.0), t);
  float mx = causticWaveField(uv - vec2(eps, 0.0), t);
  float cy = causticWaveField(uv + vec2(0.0, eps), t);
  float my = causticWaveField(uv - vec2(0.0, eps), t);

  // Local wave curvature (Laplacian): light focuses sharply into curved glowing ribbons
  float lap = (cx + mx + cy + my - 4.0 * c) / (eps * eps);
  // Secondary cross-wave shimmer along surface slope
  vec2 grad = vec2(cx - mx, cy - my) / (2.0 * eps);
  float warped = causticWaveField(uv + grad * 0.08, t * 1.05);

  float focus = clamp(-lap * 0.068, 0.0, 1.8);
  float ribbon = pow(clamp(focus, 0.0, 1.0), 2.15);
  float shimmer = pow(clamp(0.5 + 0.5 * sin(warped * 1.15), 0.0, 1.0), 3.0) * 0.26;
  return ribbon + shimmer * focus * 0.55;
}

vec3 computeUnderwaterCaustics(
  vec3 worldPos,
  vec3 worldNormal,
  vec3 sunDir,
  float waterHeight,
  float time
) {
  float subDepth = waterHeight - worldPos.y;
  if (subDepth <= 0.0) return vec3(0.0);

  // Project along refracted sun vector onto the wave plane
  vec3 refrSun = normalize(vec3(sunDir.x * 0.72, max(sunDir.y, 0.22), sunDir.z * 0.72));
  vec2 projXZ = worldPos.xz + refrSun.xz * (subDepth / max(refrSun.y, 0.25));

  vec2 uv = projXZ * 1.18 + vec2(time * 0.08, -time * 0.14);
  float t = time * 1.15;

  // Delicate spectral dispersion (warm gold / cyan optical fringe)
  float cR = opticalCausticIntensity(uv + vec2(0.045, 0.015), t);
  float cG = opticalCausticIntensity(uv, t);
  float cB = opticalCausticIntensity(uv - vec2(0.045, 0.020), t);

  // Gentle ramp from crystal shallow edge -> peak in 0.8m-4m -> smooth exponential decay in deep water
  float surfaceFade = smoothstep(0.06, 0.72, subDepth);
  float depthAtten = exp(-subDepth * 0.145);
  float upMask = clamp(dot(worldNormal, refrSun) * 0.75 + 0.32, 0.0, 1.0);
  float sunHeightMask = smoothstep(0.02, 0.28, sunDir.y);

  vec3 causticColor = vec3(cR * 0.96, cG * 1.04, cB * 1.10);
  return causticColor * surfaceFade * depthAtten * upMask * sunHeightMask * 0.68;
}
`;
