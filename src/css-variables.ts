import { kebabCase, noCase } from "change-case";
import { compareTreeNodes, type TreeNode } from "./store";
import { type GroupMeta, type TokenMeta } from "./state.svelte";
import { isTokenReference } from "./tokens";
import { serializeColor } from "./color";
import type {
  CubicBezierValue,
  DimensionValue,
  DurationValue,
  FontFamilyValue,
  StrokeStyleValue,
  RawBorderValue,
  RawGradientValue,
  RawShadowValue,
  RawTransitionValue,
  RawTypographyValue,
} from "./schema";

type TreeNodeMeta = GroupMeta | TokenMeta;

export const toDimensionValue = (value: DimensionValue) => {
  return `${value.value}${value.unit}`;
};

export const toDurationValue = (value: DurationValue) => {
  return `${value.value}${value.unit}`;
};

export const toCubicBezierValue = (value: CubicBezierValue) => {
  return `cubic-bezier(${value.join(", ")})`;
};

export const toFontFamilyValue = (value: FontFamilyValue) => {
  return Array.isArray(value) ? value.join(", ") : value;
};

const toStrokeStyleValue = (value: StrokeStyleValue) => {
  return typeof value === "string" ? value : "solid";
};

/**
 * Convert a value or reference to a string or nested var()
 */
const valueOrVar = <T>(
  value: T | string,
  converter: (v: T) => string,
): string => {
  if (isTokenReference(value)) {
    return referenceToVariable(value);
  }
  return converter(value as T);
};

export const toShadowValue = (value: RawShadowValue) => {
  const shadows = Array.isArray(value) ? value : [value];
  const shadowStrings = shadows.map((shadow) => {
    const color = valueOrVar(shadow.color, serializeColor);
    const inset = shadow.inset ? "inset " : "";
    const offsetX = valueOrVar(shadow.offsetX, toDimensionValue);
    const offsetY = valueOrVar(shadow.offsetY, toDimensionValue);
    const blur = valueOrVar(shadow.blur, toDimensionValue);
    const spread = shadow.spread
      ? valueOrVar(shadow.spread, toDimensionValue)
      : "";
    return `${inset}${offsetX} ${offsetY} ${blur} ${spread} ${color}`;
  });
  return shadowStrings.join(", ");
};

export const toGradientValue = (value: RawGradientValue) => {
  const stops = value.map((stop) => {
    const color = valueOrVar(stop.color, serializeColor);
    return `${color} ${stop.position * 100}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
};

const toBorderValue = (value: RawBorderValue) => {
  const style = valueOrVar(value.style, toStrokeStyleValue);
  const width = valueOrVar(value.width, toDimensionValue);
  const color = valueOrVar(value.color, serializeColor);
  return `${width} ${style} ${color}`;
};

const toTransitionValue = (value: RawTransitionValue) => {
  const duration = valueOrVar(value.duration, toDurationValue);
  const timingFunction = valueOrVar(value.timingFunction, toCubicBezierValue);
  const delay = valueOrVar(value.delay, toDurationValue);
  return `${duration} ${timingFunction} ${delay}`;
};

const addStrokeStyle = (
  propertyName: string,
  value: StrokeStyleValue | string,
  lines: string[],
) => {
  if (isTokenReference(value)) {
    lines.push(`  ${propertyName}: ${referenceToVariable(value)};`);
    return;
  }
  if (typeof value === "string") {
    lines.push(`  ${propertyName}: ${value};`);
  } else {
    const dashArray = value.dashArray
      .map((d) => valueOrVar(d, toDimensionValue))
      .join(", ");
    lines.push(`  ${propertyName}-dash-array: ${dashArray};`);
    lines.push(`  ${propertyName}-line-cap: ${value.lineCap};`);
  }
};

const addTypography = (
  propertyName: string,
  value: RawTypographyValue,
  lines: string[],
) => {
  const fontFamily = valueOrVar(value.fontFamily, toFontFamilyValue);
  const fontSize = valueOrVar(value.fontSize, toDimensionValue);
  const letterSpacing = valueOrVar(value.letterSpacing, toDimensionValue);
  const fontWeight = valueOrVar(value.fontWeight, (v) => `${v}`);
  const lineHeight = valueOrVar(value.lineHeight, (v) => `${v}`);
  lines.push(`  ${propertyName}-font-family: ${fontFamily};`);
  lines.push(`  ${propertyName}-font-size: ${fontSize};`);
  lines.push(`  ${propertyName}-font-weight: ${fontWeight};`);
  lines.push(`  ${propertyName}-line-height: ${lineHeight};`);
  lines.push(`  ${propertyName}-letter-spacing: ${letterSpacing};`);
  lines.push(
    `  ${propertyName}: ${fontWeight} ${fontSize}/${lineHeight} ${fontFamily};`,
  );
};

/**
 * Convert a token reference like "{colors.primary}" to a CSS variable like "var(--colors-primary)"
 */
export const referenceToVariable = (reference: string): string => {
  // Remove curly braces and split by dots
  const path = reference.replace(/[{}]/g, "").split(".");
  // Convert to kebab-case and create CSS variable
  return `var(--${kebabCase(noCase(path.join("-")))})`;
};

const processNode = (
  node: TreeNode<TreeNodeMeta>,
  path: string[],
  childrenByParent: Map<string | undefined, TreeNode<TreeNodeMeta>[]>,
  lines: string[],
) => {
  // group is only added to variable name
  if (node.meta.nodeType === "token-group") {
    const children = childrenByParent.get(node.nodeId) ?? [];
    for (const child of children) {
      processNode(child, [...path, node.meta.name], childrenByParent, lines);
    }
  }

  if (node.meta.nodeType === "token") {
    const token = node.meta;
    const propertyName = `--${kebabCase([...path, node.meta.name].join("-"))}`;
    // Handle token aliases (references to other tokens)
    if (isTokenReference(token.value)) {
      const variable = referenceToVariable(token.value);
      lines.push(`  ${propertyName}: ${variable};`);
      return;
    }
    switch (token.type) {
      case "color":
        lines.push(`  ${propertyName}: ${serializeColor(token.value)};`);
        break;
      case "dimension":
        lines.push(`  ${propertyName}: ${toDimensionValue(token.value)};`);
        break;
      case "duration":
        lines.push(`  ${propertyName}: ${toDurationValue(token.value)};`);
        break;
      case "cubicBezier":
        lines.push(`  ${propertyName}: ${toCubicBezierValue(token.value)};`);
        break;
      case "number":
      case "fontWeight":
        lines.push(`  ${propertyName}: ${token.value};`);
        break;
      case "fontFamily":
        lines.push(`  ${propertyName}: ${toFontFamilyValue(token.value)};`);
        break;
      case "shadow":
        lines.push(`  ${propertyName}: ${toShadowValue(token.value)};`);
        break;
      case "gradient":
        lines.push(`  ${propertyName}: ${toGradientValue(token.value)};`);
        break;
      case "border":
        lines.push(`  ${propertyName}: ${toBorderValue(token.value)};`);
        break;
      case "transition":
        lines.push(`  ${propertyName}: ${toTransitionValue(token.value)};`);
        break;
      case "strokeStyle":
        addStrokeStyle(propertyName, token.value, lines);
        break;
      case "typography":
        addTypography(propertyName, token.value, lines);
        break;
      default:
        token satisfies never;
        break;
    }
  }
};

export const generateCssVariables = (
  nodes: Map<string, TreeNode<TreeNodeMeta>>,
): string => {
  const lines: string[] = [];
  const childrenByParent = new Map<
    string | undefined,
    TreeNode<TreeNodeMeta>[]
  >();
  // build index for children
  for (const node of nodes.values()) {
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }
  for (const children of childrenByParent.values()) {
    children.sort(compareTreeNodes);
  }
  // render css variables in root element
  lines.push(":root {");
  const rootChildren = childrenByParent.get(undefined) ?? [];
  for (const node of rootChildren) {
    processNode(node, [], childrenByParent, lines);
  }
  lines.push("}");
  return lines.join("\n");
};
