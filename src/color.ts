import Color from "colorjs.io";
import type { ColorValue } from "./schema";

/**
 * Converts hex color to 6-digit format
 */
const expandHexTo6Digits = (hex: string) => {
  if (hex.length === 4 && hex.startsWith("#")) {
    // #RGB -> #RRGGBB
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
};

/**
 * Extracts raw numeric value from colorjs.io coordinate or alpha value
 * Handles special Number objects with metadata
 */
const getCoord = (value: number): number | "none" => {
  // Check for "none" property
  if ((value as any)?.none === true) {
    return "none";
  }
  return value.valueOf();
};

// Mapping from design token color spaces to colorjs.io space ID
const spaceIdByColorSpace: Record<ColorValue["colorSpace"], string> = {
  srgb: "srgb",
  "display-p3": "p3",
  "srgb-linear": "srgb-linear",
  hsl: "hsl",
  hwb: "hwb",
  lab: "lab",
  lch: "lch",
  oklab: "oklab",
  oklch: "oklch",
  "a98-rgb": "a98rgb",
  "prophoto-rgb": "prophoto",
  rec2020: "rec2020",
  "xyz-d65": "xyz-d65",
  "xyz-d50": "xyz-d50",
};

const colorSpaceBySpaceId = Object.fromEntries(
  Object.entries(spaceIdByColorSpace).map(([colorSpace, spaceId]) => [
    spaceId,
    colorSpace,
  ]),
) as Record<string, ColorValue["colorSpace"]>;

/**
 * Parses a CSS color string into the design tokens color format
 * Uses colorjs.io to parse and normalize color values.
 */
export const parseColor = (input: string): ColorValue => {
  try {
    const color = new Color(input);
    const components = color.coords.map(getCoord);
    const hasNoneComponent = components.some((c) => c === "none");
    const alphaCoord = getCoord(color.alpha);
    const alpha = alphaCoord === "none" ? 1 : alphaCoord;
    const result: ColorValue = {
      colorSpace: colorSpaceBySpaceId[color.spaceId],
      components,
    };
    // Only add alpha if not fully opaque
    if (alpha !== 1) {
      result.alpha = alpha;
    }
    // For sRGB colors, add hex if fully opaque and no "none" components
    if (color.spaceId === "srgb" && !hasNoneComponent && alpha === 1) {
      result.hex = expandHexTo6Digits(color.toString({ format: "hex" }));
    }
    return result;
  } catch {
    // For invalid color return transparent
    return {
      colorSpace: "srgb",
      components: [0, 0, 0],
      alpha: 0,
    };
  }
};

/**
 * Converts a design tokens color value back to a CSS color string
 * Uses colorjs.io to ensure proper serialization across all color spaces
 */
export const serializeColor = (colorValue: ColorValue): string => {
  try {
    const spaceId = spaceIdByColorSpace[colorValue.colorSpace];
    const color = new Color(
      spaceId,
      colorValue.components as any,
      colorValue.alpha,
    );
    return color.toString({ precision: 2 });
  } catch {
    // Fallback to transparent if serialization fails
    return "transparent";
  }
};
