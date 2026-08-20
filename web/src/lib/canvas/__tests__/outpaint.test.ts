import { describe, expect, test } from "bun:test";

import { buildOutpaintPrompt, distanceToOutpaintSeam, outpaintBlendPx, outpaintCompositeWeight, outpaintMaskKeepAlpha } from "../canvas-image-data";

const rightExpand = { left: 0, top: 0, right: 200, bottom: 0, sourceWidth: 400, sourceHeight: 400 };
const allExpand = { left: 100, top: 80, right: 100, bottom: 80, sourceWidth: 400, sourceHeight: 400 };

describe("outpaint seam", () => {
    test("padding is generated, not original", () => {
        expect(distanceToOutpaintSeam(500, 200, rightExpand)).toBeNull();
        expect(outpaintMaskKeepAlpha(500, 200, rightExpand, 64)).toBe(0);
        expect(outpaintCompositeWeight(500, 200, rightExpand, 64)).toBe(0);
    });

    test("interior far from the expanded edge stays original", () => {
        expect(outpaintMaskKeepAlpha(100, 200, rightExpand, 64)).toBe(255);
        expect(outpaintCompositeWeight(100, 200, rightExpand, 64)).toBe(1);
    });

    test("composite weight uses a smooth ramp at the seam", () => {
        expect(outpaintCompositeWeight(399, 200, rightExpand, 12)).toBeGreaterThan(0);
        expect(outpaintCompositeWeight(399, 200, rightExpand, 12)).toBeLessThan(0.15);
        expect(outpaintCompositeWeight(388, 200, rightExpand, 12)).toBe(1);
    });

    test("unexpanded edges are not treated as seams", () => {
        expect(outpaintMaskKeepAlpha(0, 200, rightExpand, 64)).toBe(255);
        expect(outpaintCompositeWeight(0, 200, rightExpand, 64)).toBe(1);
    });

    test("all-side expansion keeps the original center", () => {
        expect(outpaintMaskKeepAlpha(100, 280, allExpand, 64)).toBe(0);
        expect(outpaintMaskKeepAlpha(300, 280, allExpand, 64)).toBe(255);
        expect(outpaintCompositeWeight(300, 280, allExpand, 64)).toBe(1);
        expect(distanceToOutpaintSeam(50, 280, allExpand)).toBeNull();
    });

    test("blend width is clamped", () => {
        expect(outpaintBlendPx(1024, 1024)).toBe(64);
        expect(outpaintBlendPx(128, 128)).toBe(16);
    });

    test("prompt keeps user additive request in the mask region", () => {
        expect(buildOutpaintPrompt()).toContain("不要新增");
        expect(buildOutpaintPrompt()).toContain("蒙版");
        expect(buildOutpaintPrompt("不同品种的小猫")).toContain("不同品种的小猫");
        expect(buildOutpaintPrompt("不同品种的小猫")).toContain("蒙版");
        expect(buildOutpaintPrompt("不同品种的小猫")).not.toContain("不要新增");
    });
});
