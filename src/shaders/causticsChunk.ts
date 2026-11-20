/**
 * Shared dual-layer animated underwater caustics GLSL library.
 * Projects refracted sunlit water caustics onto submerged sand, boulders,
 * beach props, coral, and submerged character/NPC meshes, attenuating
 * smoothly at the waterline and with water depth.
 */
export const CAUSTICS_GLSL = /* glsl */ `
vec2 causticHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Sharp cellular caustic ridge field inspired by refractive wave focusing
float causticLayer(vec2 uv, float t) {
  vec2 i = floor(uv);
  vec2 f = fract(uv);
  float minDist1 = 8.0;
  float minDist2 = 8.0;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 rnd = causticHash22(i + neighbor);
      vec2 pt = 0.5 + 0.46 * sin(t * 1.15 + 6.2831 * rnd);
      vec2 diff = neighbor + pt - f;
      float d = length(diff);
      if (d < minDist1) {
        minDist2 = minDist1;
        minDist1 = d;
      } else if (d < minDist2) {
        minDist2 = d;
      }
    }
  }

  float edge = minDist2 - minDist1;
  float filament = pow(clamp(1.0 - edge * 2.1, 0.0, 1.0), 4.0);
  float glow = smoothstep(0.65, 0.0, edge) * 0.22;
  return filament + glow;
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

  // Project along refracted sun vector onto water plane
  vec3 refrSun = normalize(vec3(sunDir.x * 0.72, max(sunDir.y, 0.22), sunDir.z * 0.72));
  vec2 projXZ = worldPos.xz + refrSun.xz * (subDepth / max(refrSun.y, 0.25));

  // Dual counter-drifting layers with subtle chromatic dispersion
  vec2 uv1 = projXZ * 0.48 + vec2(time * 0.11, -time * 0.16);
  vec2 uv2 = projXZ * 0.76 + vec2(-time * 0.14, -time * 0.09);

  float cR = causticLayer(uv1 + vec2(0.025, 0.0), time) * 0.68 +
             causticLayer(uv2 - vec2(0.02, 0.01), time * 1.18) * 0.58;
  float cG = causticLayer(uv1, time) * 0.68 +
             causticLayer(uv2, time * 1.18) * 0.58;
  float cB = causticLayer(uv1 - vec2(0.025, 0.01), time) * 0.68 +
             causticLayer(uv2 + vec2(0.02, 0.015), time * 1.18) * 0.58;

  // Attenuate cleanly right at waterline and exponentially with depth
  float surfaceFade = smoothstep(0.0, 0.22, subDepth);
  float depthAtten = exp(-subDepth * 0.145);
  float upMask = clamp(dot(worldNormal, refrSun) * 0.75 + 0.35, 0.0, 1.0);
  float sunHeightMask = smoothstep(0.02, 0.28, sunDir.y);

  vec3 causticColor = vec3(cR * 0.92, cG * 1.06, cB * 1.14);
  return causticColor * surfaceFade * depthAtten * upMask * sunHeightMask * 1.15;
}
`;
