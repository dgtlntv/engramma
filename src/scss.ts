import { kebabCase, noCase } from "change-case";
import { compareTreeNodes, type TreeNode } from "./store";
import { type GroupMeta, type TokenMeta } from "./state.svelte";
import type {
  RawBorderValue,
  RawGradientValue,
  RawShadowValue,
  RawTransitionValue,
  RawTypographyValue,
  StrokeStyleValue,
} from "./schema";
import {
  toCubicBezierValue,
  toDimensionValue,
  toDurationValue,
  toFontFamilyValue,
} from "./css-variables";
import { isTokenReference } from "./tokens";
import { serializeColor } from "./color";

type TreeNodeMeta = GroupMeta | TokenMeta;

const toStrokeStyleValue = (value: StrokeStyleValue) => {
  return typeof value === "string" ? value : "solid";
};

/**
 * Convert a value or reference to a string or SCSS variable
 */
const valueOrScssVar = <T>(
  value: T | string,
  converter: (v: T) => string,
): string => {
  if (isTokenReference(value)) {
    return referenceToVariable(value);
  }
  return converter(value as T);
};

const toShadowValue = (value: RawShadowValue) => {
  const shadows = Array.isArray(value) ? value : [value];
  const shadowStrings = shadows.map((shadow) => {
    const color = valueOrScssVar(shadow.color, serializeColor);
    const inset = shadow.inset ? "inset " : "";
    const offsetX = valueOrScssVar(shadow.offsetX, toDimensionValue);
    const offsetY = valueOrScssVar(shadow.offsetY, toDimensionValue);
    const blur = valueOrScssVar(shadow.blur, toDimensionValue);
    const spread = shadow.spread
      ? valueOrScssVar(shadow.spread, toDimensionValue)
      : "";
    return `${inset}${offsetX} ${offsetY} ${blur} ${spread} ${color}`;
  });
  return shadowStrings.join(", ");
};

const toGradientValue = (value: RawGradientValue) => {
  const stops = value.map((stop) => {
    const color = valueOrScssVar(stop.color, serializeColor);
    return `${color} ${stop.position * 100}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
};

const toBorderValue = (value: RawBorderValue) => {
  const style = valueOrScssVar(value.style, toStrokeStyleValue);
  const width = valueOrScssVar(value.width, toDimensionValue);
  const color = valueOrScssVar(value.color, serializeColor);
  return `${width} ${style} ${color}`;
};

const toTransitionValue = (value: RawTransitionValue) => {
  const duration = valueOrScssVar(value.duration, toDurationValue);
  const timingFunction = valueOrScssVar(
    value.timingFunction,
    toCubicBezierValue,
  );
  const delay = valueOrScssVar(value.delay, toDurationValue);
  return `${duration} ${timingFunction} ${delay}`;
};

const addStrokeStyle = (
  variableName: string,
  value: StrokeStyleValue | string,
  lines: string[],
) => {
  if (isTokenReference(value)) {
    lines.push(`${variableName}: ${referenceToVariable(value)};`);
    return;
  }
  if (typeof value === "string") {
    lines.push(`${variableName}: ${value};`);
  } else {
    const dashArray = value.dashArray
      .map((d) => valueOrScssVar(d, toDimensionValue))
      .join(", ");
    lines.push(`${variableName}-dash-array: ${dashArray};`);
    lines.push(`${variableName}-line-cap: ${value.lineCap};`);
  }
};

const addTypography = (
  variableName: string,
  value: RawTypographyValue,
  lines: string[],
) => {
  const fontFamily = valueOrScssVar(value.fontFamily, toFontFamilyValue);
  const fontSize = valueOrScssVar(value.fontSize, toDimensionValue);
  const letterSpacing = valueOrScssVar(value.letterSpacing, toDimensionValue);
  const fontWeight = valueOrScssVar(value.fontWeight, (v) => `${v}`);
  const lineHeight = valueOrScssVar(value.lineHeight, (v) => `${v}`);
  lines.push(`${variableName}-font-family: ${fontFamily};`);
  lines.push(`${variableName}-font-size: ${fontSize};`);
  lines.push(`${variableName}-font-weight: ${fontWeight};`);
  lines.push(`${variableName}-line-height: ${lineHeight};`);
  lines.push(`${variableName}-letter-spacing: ${letterSpacing};`);
  lines.push(
    `${variableName}: ${fontWeight} ${fontSize}/${lineHeight} ${fontFamily};`,
  );
};

/**
 * Convert a token reference like "{colors.primary}" to an SCSS variable like "$colors-primary"
 */
const referenceToVariable = (reference: string): string => {
  // Remove curly braces and split by dots
  const path = reference.replace(/[{}]/g, "").split(".");
  // Convert to kebab-case and create SCSS variable
  return `$${kebabCase(path.join("-"))}`;
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
    const variableName = `$${kebabCase(noCase([...path, node.meta.name].join("-")))}`;
    // Handle token aliases (references to other tokens)
    if (isTokenReference(token.value)) {
      const variable = referenceToVariable(token.value);
      lines.push(`${variableName}: ${variable};`);
      return;
    }
    switch (token.type) {
      case "color":
        lines.push(`${variableName}: ${serializeColor(token.value)};`);
        break;
      case "dimension":
        lines.push(`${variableName}: ${toDimensionValue(token.value)};`);
        break;
      case "duration":
        lines.push(`${variableName}: ${toDurationValue(token.value)};`);
        break;
      case "cubicBezier":
        lines.push(`${variableName}: ${toCubicBezierValue(token.value)};`);
        break;
      case "number":
      case "fontWeight":
        lines.push(`${variableName}: ${token.value};`);
        break;
      case "fontFamily":
        lines.push(`${variableName}: ${toFontFamilyValue(token.value)};`);
        break;
      case "shadow":
        lines.push(`${variableName}: ${toShadowValue(token.value)};`);
        break;
      case "gradient":
        lines.push(`${variableName}: ${toGradientValue(token.value)};`);
        break;
      case "border":
        lines.push(`${variableName}: ${toBorderValue(token.value)};`);
        break;
      case "transition":
        lines.push(`${variableName}: ${toTransitionValue(token.value)};`);
        break;
      case "strokeStyle":
        addStrokeStyle(variableName, token.value, lines);
        break;
      case "typography":
        addTypography(variableName, token.value, lines);
        break;
      default:
        token satisfies never;
        break;
    }
  }
};

export const generateScssVariables = (
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
  // render scss variables
  const rootChildren = childrenByParent.get(undefined) ?? [];
  for (const node of rootChildren) {
    processNode(node, [], childrenByParent, lines);
  }
  return lines.join("\n");
};
