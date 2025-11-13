import { test, expect, describe } from "vitest";
import { parseColor } from "./color";

describe("parseColor", () => {
  test("parses hex color", () => {
    expect(parseColor("#ff0000")).toEqual({
      colorSpace: "srgb",
      components: [1, 0, 0],
      hex: "#ff0000",
    });
    expect(parseColor("#F00")).toEqual({
      colorSpace: "srgb",
      components: [1, 0, 0],
      hex: "#ff0000",
    });
  });

  test("parses rgb color", () => {
    expect(parseColor("rgb(100% 0% 0%)")).toEqual({
      colorSpace: "srgb",
      components: [1, 0, 0],
      hex: "#ff0000",
    });
  });

  test("parses rgba with alpha", () => {
    expect(parseColor("rgba(255 0 0 / 0.5)")).toEqual({
      colorSpace: "srgb",
      components: [1, 0, 0],
      alpha: 0.5,
    });
  });

  test("gives transparent for invalid colors", () => {
    expect(parseColor("#gggggg")).toEqual({
      colorSpace: "srgb",
      components: [0, 0, 0],
      alpha: 0,
    });
  });

  test("parses rgb with none keyword", () => {
    expect(parseColor("rgb(none 0% 0%)")).toEqual({
      colorSpace: "srgb",
      components: ["none", 0, 0],
    });
  });

  test("parses oklch color", () => {
    expect(parseColor("oklch(0.5 0.1 0)")).toEqual({
      colorSpace: "oklch",
      components: [0.5, 0.1, 0],
    });
  });

  test("parses display-p3 color", () => {
    expect(parseColor("color(display-p3 1 0 0)")).toEqual({
      colorSpace: "display-p3",
      components: [1, 0, 0],
    });
  });

  describe("supports all design token color spaces", () => {
    test.each([
      ["srgb", "rgb(255 0 0)"],
      ["hsl", "hsl(0 100% 50%)"],
      ["hwb", "hwb(0 0% 0%)"],
      ["lab", "lab(50 0 0)"],
      ["lch", "lch(50 50 0)"],
      ["oklab", "oklab(0.5 0 0)"],
      ["oklch", "oklch(0.5 0.1 0)"],
      ["display-p3", "color(display-p3 1 0 0)"],
      ["a98-rgb", "color(a98-rgb 1 0 0)"],
      ["prophoto-rgb", "color(prophoto-rgb 1 0 0)"],
      ["rec2020", "color(rec2020 1 0 0)"],
      ["srgb-linear", "color(srgb-linear 1 0 0)"],
      ["xyz-d65", "color(xyz-d65 0.5 0.3 0.8)"],
      ["xyz-d50", "color(xyz-d50 0.5 0.3 0.8)"],
    ])("extracts %s color space from %s color", (expected, color) => {
      expect(parseColor(color).colorSpace).toBe(expected);
    });
  });
});
