import { kebabCase } from "change-case";
import { compareTreeNodes, type TreeNode } from "./store";
import type { TreeNodeMeta } from "./state.svelte";
import { resolveTokenValue } from "./state.svelte";
import { serializeColor } from "./color";
import type {
  BorderValue,
  CubicBezierValue,
  DimensionValue,
  DurationValue,
  FontFamilyValue,
  GradientValue,
  ShadowValue,
  StrokeStyleValue,
  TransitionValue,
  TypographyValue,
} from "./schema";

// https://www.designtokens.org/tr/2025.10/color

export const toDimensionValue = (value: DimensionValue) => {
  return `${value.value}${value.unit}`;
};

export const toDurationValue = (value: DurationValue) => {
  return `${value.value}${value.unit}`;
};

export const toCubicBezierValue = (value: CubicBezierValue) => {
  return `cubic-bezier(${value.join(", ")})`;
};

export const toFontFamily = (value: FontFamilyValue) => {
  return Array.isArray(value) ? value.join(", ") : value;
};

export const toShadow = (value: ShadowValue) => {
  const shadows = Array.isArray(value) ? value : [value];
  const shadowStrings = shadows.map((shadow) => {
    const color = serializeColor(shadow.color);
    const inset = shadow.inset ? "inset " : "";
    const offsetX = toDimensionValue(shadow.offsetX);
    const offsetY = toDimensionValue(shadow.offsetY);
    const blur = toDimensionValue(shadow.blur);
    const spread = shadow.spread ? toDimensionValue(shadow.spread) : "";
    return `${inset}${offsetX} ${offsetY} ${blur} ${spread} ${color}`;
  });
  return shadowStrings.join(", ");
};

export const toGradient = (value: GradientValue) => {
  const stops = value.map(
    (stop) => `${serializeColor(stop.color)} ${stop.position * 100}%`,
  );
  return `linear-gradient(90deg, ${stops.join(", ")})`;
};

const addTransition = (
  propertyName: string,
  value: TransitionValue,
  cssLines: string[],
) => {
  const duration = toDurationValue(value.duration);
  const delay = toDurationValue(value.delay);
  const timingFunction = toCubicBezierValue(value.timingFunction);
  cssLines.push(`  ${propertyName}-duration: ${duration};`);
  cssLines.push(`  ${propertyName}-delay: ${delay};`);
  cssLines.push(`  ${propertyName}-timing-function: ${timingFunction};`);
  cssLines.push(`  ${propertyName}: ${duration} ${timingFunction} ${delay};`);
};

const addStrokeStyle = (
  propertyName: string,
  value: StrokeStyleValue,
  cssLines: string[],
) => {
  if (typeof value === "string") {
    cssLines.push(`  ${propertyName}: ${value};`);
  } else {
    const dashArray = value.dashArray.map(toDimensionValue).join(", ");
    cssLines.push(`  ${propertyName}-dash-array: ${dashArray};`);
    cssLines.push(`  ${propertyName}-line-cap: ${value.lineCap};`);
  }
};

const addBorder = (
  propertyName: string,
  value: BorderValue,
  cssLines: string[],
) => {
  const color = serializeColor(value.color);
  const width = toDimensionValue(value.width);
  const style = typeof value.style === "string" ? value.style : "solid";
  cssLines.push(`  ${propertyName}-color: ${color};`);
  cssLines.push(`  ${propertyName}-width: ${width};`);
  cssLines.push(`  ${propertyName}-style: ${style};`);
  cssLines.push(`  ${propertyName}: ${width} ${style} ${color};`);
};

const addTypography = (
  propertyName: string,
  value: TypographyValue,
  cssLines: string[],
) => {
  const fontFamily = toFontFamily(value.fontFamily);
  const fontSize = toDimensionValue(value.fontSize);
  const letterSpacing = toDimensionValue(value.letterSpacing);
  cssLines.push(`  ${propertyName}-font-family: ${fontFamily};`);
  cssLines.push(`  ${propertyName}-font-size: ${fontSize};`);
  cssLines.push(`  ${propertyName}-font-weight: ${value.fontWeight};`);
  cssLines.push(`  ${propertyName}-line-height: ${value.lineHeight};`);
  cssLines.push(`  ${propertyName}-letter-spacing: ${letterSpacing};`);
  cssLines.push(
    `  ${propertyName}: ${value.fontWeight} ${fontSize}/${value.lineHeight} ${fontFamily};`,
  );
};

/**
 * Convert a token reference like "{colors.primary}" to a CSS variable like "var(--colors-primary)"
 */
export const referenceToVariable = (reference: string): string => {
  // Remove curly braces and split by dots
  const path = reference.replace(/[{}]/g, "").split(".");
  // Convert to kebab-case and create CSS variable
  return `var(--${kebabCase(path.join("-"))})`;
};

const processNode = (
  node: TreeNode<TreeNodeMeta>,
  path: string[],
  childrenByParent: Map<string | undefined, TreeNode<TreeNodeMeta>[]>,
  allNodes: Map<string, TreeNode<TreeNodeMeta>>,
  cssLines: string[],
) => {
  // group is only added to variable name
  if (node.meta.nodeType === "token-group") {
    const children = childrenByParent.get(node.nodeId) ?? [];
    for (const child of children) {
      processNode(
        child,
        [...path, node.meta.name],
        childrenByParent,
        allNodes,
        cssLines,
      );
    }
  }

  if (node.meta.nodeType === "token") {
    const token = node.meta as any;
    const propertyName = `--${kebabCase([...path, node.meta.name].join("-"))}`;

    // Handle token aliases (references to other tokens)
    if (token.extends) {
      const variable = referenceToVariable(token.extends);
      cssLines.push(`  ${propertyName}: ${variable};`);
      return;
    }

    const tokenValue = resolveTokenValue(node, allNodes);
    switch (tokenValue.type) {
      case "color":
        cssLines.push(
          `  ${propertyName}: ${serializeColor(tokenValue.value)};`,
        );
        break;
      case "dimension":
        cssLines.push(
          `  ${propertyName}: ${toDimensionValue(tokenValue.value)};`,
        );
        break;
      case "duration":
        cssLines.push(
          `  ${propertyName}: ${toDurationValue(tokenValue.value)};`,
        );
        break;
      case "cubicBezier":
        cssLines.push(
          `  ${propertyName}: ${toCubicBezierValue(tokenValue.value)};`,
        );
        break;
      case "number":
        cssLines.push(`  ${propertyName}: ${tokenValue.value};`);
        break;
      case "fontFamily":
        cssLines.push(`  ${propertyName}: ${toFontFamily(tokenValue.value)};`);
        break;
      case "fontWeight":
        cssLines.push(`  ${propertyName}: ${tokenValue.value};`);
        break;
      case "shadow":
        cssLines.push(`  ${propertyName}: ${toShadow(tokenValue.value)};`);
        break;
      case "gradient":
        cssLines.push(`  ${propertyName}: ${toGradient(tokenValue.value)};`);
        break;
      case "transition":
        addTransition(propertyName, tokenValue.value, cssLines);
        break;
      case "strokeStyle":
        addStrokeStyle(propertyName, tokenValue.value, cssLines);
        break;
      case "border":
        addBorder(propertyName, tokenValue.value, cssLines);
        break;
      case "typography":
        addTypography(propertyName, tokenValue.value, cssLines);
        break;
      default:
        tokenValue satisfies never;
        break;
    }
  }
};

export const generateCssVariables = (
  nodes: Map<string, TreeNode<TreeNodeMeta>>,
): string => {
  const cssLines: string[] = [];
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
  cssLines.push(":root {");
  const rootChildren = childrenByParent.get(undefined) ?? [];
  for (const node of rootChildren) {
    processNode(node, [], childrenByParent, nodes, cssLines);
  }
  cssLines.push("}");
  return cssLines.join("\n");
};
