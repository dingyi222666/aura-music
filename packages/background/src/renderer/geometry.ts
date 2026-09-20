// Hermite evaluation and localized folding in the mesh vertex shader.
export const GEOMETRY = `vec4 basis(float t) {
  return vec4(2.0 * t * t * t - 3.0 * t * t + 1.0,
    -2.0 * t * t * t + 3.0 * t * t,
    t * t * t - 2.0 * t * t + t,
    t * t * t - t * t);
}
vec2 surfaceAt(vec2 point) {
  float gx = clamp(point.x * 3.0, 0.0, 3.0);
  float gy = clamp(point.y * 3.0, 0.0, 3.0);
  int cx = min(2, int(floor(gx)));
  int cy = min(2, int(floor(gy)));
  vec4 bx = basis(gx - float(cx));
  vec4 by = basis(gy - float(cy));
  // Tensor-product Hermite interpolation: evaluate each row along x, then
  // combine along y. This shares the y weights across four x terms.
  int top = cy * 4 + cx;
  mat4x2 tl = control(top), tr = control(top + 1);
  mat4x2 bl = control(top + 4), br = control(top + 5);
  vec2 a = tl[0] * bx.x + tr[0] * bx.y + tl[1] * bx.z + tr[1] * bx.w;
  vec2 b = bl[0] * bx.x + br[0] * bx.y + bl[1] * bx.z + br[1] * bx.w;
  vec2 c = tl[2] * bx.x + tr[2] * bx.y + tl[3] * bx.z + tr[3] * bx.w;
  vec2 d = bl[2] * bx.x + br[2] * bx.y + bl[3] * bx.z + br[3] * bx.w;
  return a * by.x + b * by.y + c * by.z + d * by.w;
}

vec2 mapPoint(vec2 point) {
  float d = (point.y - foldB.x) / foldB.y;
  float w = max(0.0, 1.0 - d * d);
  float amount = foldA.z * 0.78 * w * w;
  // A quiet region needs only the smooth surface, with no fold or tanh work.
  if (amount <= 0.0) {
    vec2 curved = surfaceAt(point);
    return vec2(curved.x * 2.0 - 1.0, 1.0 - curved.y * 2.0);
  }
  float center = foldA.x + foldA.y * (point.y - foldB.x) + foldB.z * d * d;
  float left = amount * tanh(center / foldA.w);
  float right = 1.0 - amount * tanh((1.0 - center) / foldA.w);
  float x = clamp((point.x - amount * tanh((point.x - center) / foldA.w) - left) / (right - left), 0.0, 1.0);
  float weight = min(1.0, amount / foldA.w);
  float blendAmount = weight * weight * (3.0 - 2.0 * weight) * 0.62;
  vec2 curved = surfaceAt(vec2(x, point.y));
  curved = vec2(curved.x * 2.0 - 1.0, 1.0 - curved.y * 2.0);
  vec2 plane = vec2(x * 2.0 - 1.0, 1.0 - point.y * 2.0);
  return curved * (1.0 - blendAmount) + plane * blendAmount;
}
`;
