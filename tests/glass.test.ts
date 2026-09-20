import { expect, test } from "bun:test";
import { melt, sliderTravel, toggleTravel } from "../packages/view/src/glass/controls/geometry";
import { Morph } from "../packages/view/src/glass/motion";
import { fusion } from "../packages/view/src/glass/fusion";
import {
  DISPERSION_TAPS, SINGLE_TAP, buildLensMaps, colorControlsMatrix, cornerExponent, encodePng, gradSdRoundedRect, normalizeRadii, refract, rimIntensity, sdRoundedRect,
} from "../packages/view/src/glass/lens";

const geometry = { width: 340, height: 210, x: 318, y: 246, button: 44 };
const settle = (motion: Morph) => {
  let state = motion.step(0);
  for (let i = 0; i < 240 && state.active; i++) state = motion.step(1 / 60);
  expect(state.active).toBe(false);
  return state;
};

test("menu opens and returns to its anchor without a second shape", () => {
  const motion = new Morph(geometry);
  motion.set(true);
  const open = settle(motion);
  expect(open.shapes).toHaveLength(1);
  expect(open.shapes[0]).toEqual({ x: 0, y: 0, width: 340, height: 210, radius: 48 });
  motion.set(false);
  const closed = settle(motion);
  expect(closed.x).toBe(geometry.x);
  expect(closed.y).toBe(geometry.y);
  expect(closed.shapes[0].width).toBe(40);
});

test("reversing an opening menu preserves its displayed geometry", () => {
  const motion = new Morph(geometry);
  motion.set(true);
  const before = motion.step(.064);
  motion.set(false);
  const after = motion.step(0);
  expect(after.shapes).toEqual(before.shapes);
  expect(after.contentScale).toBe(before.contentScale);
  settle(motion);
});

test("reduced motion settles both directions immediately", () => {
  const motion = new Morph(geometry);
  motion.set(true, true);
  expect(motion.step(0).active).toBe(false);
  motion.set(false, true);
  const state = motion.step(0);
  expect(state.active).toBe(false);
  expect(state.x).toBe(geometry.x);
});

test("a delayed frame does not prolong menu dismissal", () => {
  const motion = new Morph(geometry);
  motion.set(true);
  settle(motion);
  motion.set(false);
  const closed = motion.step(.4);
  expect(closed.active).toBe(false);
  expect(closed.x).toBe(geometry.x);
  expect(closed.shapes[0].width).toBe(40);
  expect(closed.materialOpacity).toBe(0);
});

test("glass itself fades during dismissal and stays continuous on reversal", () => {
  const motion = new Morph(geometry);
  motion.set(true);
  expect(settle(motion).materialOpacity).toBe(1);
  motion.set(false);
  const first = motion.step(.05).materialOpacity;
  const second = motion.step(.05).materialOpacity;
  expect(first).toBeGreaterThan(second);
  expect(second).toBeGreaterThan(0);
  motion.set(true);
  expect(motion.step(0).materialOpacity).toBe(second);
  expect(settle(motion).materialOpacity).toBe(1);
});

test("liquid contact occurs in both directions and leaves no detached bubble", () => {
  const motion = new Morph(geometry);
  for (const open of [true, false]) {
    motion.set(open);
    let contacts = 0;
    for (let i = 0; i < 180; i++) {
      const frame = motion.step(1 / 60);
      if (frame.active && fusion(frame.shapes[0], geometry)) contacts++;
      if (!frame.active) break;
    }
    expect(contacts).toBeGreaterThanOrEqual(5);
  }
  expect(fusion({ x: 0, y: 0, width: 100, height: 80, radius: 30 }, geometry)).toBeNull();
});

test("an open menu follows resized content and returns to its updated anchor", () => {
  const motion = new Morph(geometry);
  motion.set(true);
  const before = settle(motion);
  motion.resize({ ...geometry, height: 310, y: 346 });
  expect(motion.step(0).shapes).toEqual(before.shapes);
  expect(settle(motion).shapes[0]).toEqual({ x: 0, y: 0, width: 340, height: 310, radius: 48 });
  motion.set(false);
  expect(settle(motion).y).toBe(346);
});

test("lens leaves the interior alone and bends the edge band inward", () => {
  const radii = normalizeRadii(48, 360, 200);
  expect(radii).toEqual([48, 48, 48, 48]);
  // Lens.kt: `if (-sd >= refractionHeight) return content.eval(coord)`.
  expect(refract(180, 100, 360, 200, radii, 24, 48, 0).slice(0, 2)).toEqual([0, 0]);
  // On the left edge the SDF gradient points left; the sample moves right (inward).
  const [dx, dy] = refract(0.5, 100, 360, 200, radii, 24, 48, 0);
  // circleMap(1 - 0.5 / 24) * 48 ≈ 38.25.
  expect(dx).toBeCloseTo(38.253, 2);
  expect(Math.abs(dy)).toBeLessThan(1e-9);
  // circleMap(1 - inside/height) falls off to zero at the band's inner edge.
  const [near] = refract(12, 100, 360, 200, radii, 24, 48, 0);
  const [far] = refract(23.5, 100, 360, 200, radii, 24, 48, 0);
  expect(near).toBeGreaterThan(far);
  expect(far).toBeGreaterThan(0);
  // depthEffect tilts the gradient toward the centre.
  const [, dyDome] = refract(0.5, 40, 360, 200, radii, 24, 48, 1);
  expect(dyDome).toBeGreaterThan(0);
  expect(sdRoundedRect(0, 0, 180, 100, 48)).toBe(-100);
});

test("dispersion taps carry the Kotlin channel weights and encode within range", () => {
  const sum = (key: "r" | "g" | "b") => DISPERSION_TAPS.reduce((acc, tap) => acc + tap[key], 0);
  expect(sum("r")).toBeCloseTo(3 / 3.5 + 1 / 7, 6);
  expect(sum("g")).toBeCloseTo(1 / 7 + 3 / 3.5, 6);
  expect(sum("b")).toBeCloseTo(1, 6);
  const maps = buildLensMaps(90, 50, 360, 200, normalizeRadii(48, 360, 200), { height: 24, amount: 48, depth: 1, dispersion: 1 }, DISPERSION_TAPS);
  expect(maps).toHaveLength(7);
  for (const map of maps) {
    let min = 255;
    let max = 0;
    for (let i = 0; i < map.data.length; i += 4) {
      min = Math.min(min, map.data[i], map.data[i + 1]);
      max = Math.max(max, map.data[i], map.data[i + 1]);
      expect(map.data[i + 3]).toBe(255);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(255);
    expect(map.data[(25 * 90 + 45) * 4]).toBe(128);
  }
  const [single] = buildLensMaps(90, 50, 360, 200, normalizeRadii(48, 360, 200), { height: 24, amount: 48, depth: 0, dispersion: 0 }, SINGLE_TAP);
  expect(single.scale).toBe(96);
  expect(single.data[(25 * 90) * 4]).toBeGreaterThan(200);
});

test("colour controls reproduce Kotlin's vibrancy matrix and the rim follows the light", () => {
  const identity = colorControlsMatrix();
  expect(identity).toEqual([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
  const vibrant = colorControlsMatrix(0, 1, 1.5);
  expect(vibrant[0]).toBeCloseTo(0.213 * -0.5 + 1.5, 6);
  expect(vibrant[1]).toBeCloseTo(0.715 * -0.5, 6);
  expect(vibrant[4]).toBe(0);
  const radii = normalizeRadii(48, 360, 200);
  const angle = Math.PI / 4;
  // Light from the top-left / bottom-right diagonal: the right edge faces it, the top does not.
  expect(rimIntensity(359.5, 100, 360, 200, radii, angle, 1)).toBeCloseTo(Math.SQRT1_2, 6);
  expect(rimIntensity(180, 0.5, 360, 200, radii, angle, 1)).toBeCloseTo(Math.SQRT1_2, 6);
  expect(rimIntensity(0.5, 100, 360, 200, radii, angle, 1, "ambient")).toBe(0);
  expect(rimIntensity(0.5, 100, 360, 200, radii, angle, 1, "plain")).toBe(1);
});

test("squircle corners follow the CSS superellipse and keep the circle for pills", () => {
  expect(cornerExponent("round")).toBe(2);
  expect(cornerExponent("superellipse(2)")).toBe(4);
  expect(cornerExponent("squircle")).toBe(4);
  expect(cornerExponent("superellipse(1)")).toBe(2);
  expect(cornerExponent("")).toBe(2);
  // On the curve |x|^4 + |y|^4 = r^4 the distance is zero; the circle is not there.
  const r = 48;
  const t = Math.PI / 5;
  const px = 180 - r + r * Math.cbrt(Math.cos(t)) ** 0 * Math.sqrt(Math.cos(t));
  const py = 100 - r + r * Math.sqrt(Math.sin(t));
  expect(Math.abs(sdRoundedRect(px, py, 180, 100, r, 4))).toBeLessThan(1e-9);
  expect(sdRoundedRect(px, py, 180, 100, r, 2)).toBeGreaterThan(1);
  // Straight edges and the interior are unchanged by the exponent.
  expect(sdRoundedRect(0, 99, 180, 100, r, 4)).toBe(sdRoundedRect(0, 99, 180, 100, r, 2));
  expect(sdRoundedRect(0, 0, 180, 100, r, 4)).toBe(-100);
  // The squircle normal on the corner diagonal is still the diagonal.
  const [gx, gy] = gradSdRoundedRect(150, 70, 180, 100, r, 4);
  expect(gx).toBeCloseTo(gy, 9);
  expect(Math.hypot(gx, gy)).toBeCloseTo(1, 9);
});

test("displacement maps encode as valid PNGs", async () => {
  const [map] = buildLensMaps(70, 40, 280, 160, normalizeRadii(40, 280, 160), { height: 20, amount: 30, depth: 0, dispersion: 0 }, SINGLE_TAP);
  const png = encodePng(map.data, 70, 40);
  expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(new TextDecoder().decode(png.subarray(12, 16))).toBe("IHDR");
  expect(new TextDecoder().decode(png.subarray(png.length - 8, png.length - 4))).toBe("IEND");
  // The zlib stream is a stored block: inflate it back and compare the rows.
  const idatLength = new DataView(png.buffer).getUint32(8 + 25);
  const idat = png.subarray(8 + 25 + 8, 8 + 25 + 8 + idatLength);
  const inflated = new Uint8Array(await new Response(new Blob([idat]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  expect(inflated.length).toBe((70 * 4 + 1) * 40);
  expect(inflated[0]).toBe(0);
  expect(Array.from(inflated.subarray(1, 9))).toEqual(Array.from(map.data.subarray(0, 8)));
});


test("control melt keeps the track endpoint registered while the thumb scales and moves", () => {
  for (const width of [160, 296, 400]) {
    for (const progress of [0, .1, .33, .7, 1]) {
      for (const sx of [1, 1.5, 1.7]) {
        const offset = sliderTravel(progress, width);
        const source = melt(offset, 6, sx, 1.5, 1, true);
        // Map the fill endpoint through source and thumb transforms to page space.
        const endpoint = offset + 20 + (source.x + width * progress * source.sx - 20) * sx;
        expect(endpoint).toBeCloseTo(width * progress, 8);
        expect(6 * source.sy * 1.5).toBeCloseTo(6, 8);
      }
    }
  }
});

test("switch melt leaves clear glass around the track and collapses only its source at rest", () => {
  for (const progress of [0, .5, 1]) {
    const offset = toggleTravel(progress);
    const source = melt(offset, 28, 1.5, 1.5, 1, false);
    expect(64 * source.sx * 1.5).toBeCloseTo(48, 8);
    expect(28 * source.sy * 1.5).toBeCloseTo(21, 8);
    expect(28 * source.sy * 1.5).toBeLessThan(24 * 1.5);
    expect(melt(offset, 28, 1, 1, 0, false).sy).toBe(0);
  }
});
