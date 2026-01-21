import { formatError } from "zod";
import { createSubscriber } from "svelte/reactivity";
import { TreeStore, type Transaction, type TreeNode } from "./store";
import {
  type RawValue,
  type RawValueWithReference,
  type Value,
  type NodeRef,
  RawValueSchema,
  isNodeRef,
} from "./schema";
import { setDataInUrl } from "./url-data";
import { serializeTokenResolver } from "./resolver";
import type { JsonPointerRefInfo } from "./tokens";

export type ResolverMeta = {
  nodeType: "resolver";
  name: string;
  description?: string;
  extensions?: Record<string, unknown>;
};

export type SetMeta = {
  nodeType: "token-set";
  name: string;
  description?: string;
  extensions?: Record<string, unknown>;
};

export type ModifierMeta = {
  nodeType: "modifier";
  name: string;
  description?: string;
  default?: string;
  extensions?: Record<string, unknown>;
};

export type ModifierContextMeta = {
  nodeType: "modifier-context";
  name: string;
  description?: string;
  extensions?: Record<string, unknown>;
};

export type GroupMeta = {
  nodeType: "token-group";
  name: string;
  type?: Value["type"];
  description?: string;
  deprecated?: boolean | string;
  extensions?: Record<string, unknown>;
};

export type TokenMeta = {
  nodeType: "token";
  name: string;
  description?: string;
  deprecated?: boolean | string;
  extensions?: Record<string, unknown>;
  /** JSON Pointer $refs found within this token's $value (captured before dereferencing) */
  jsonPointerRefs?: JsonPointerRefInfo[];
} & RawValueWithReference;

/**
 * Helper function to find the type of a token
 * Searches through reference chain or parent group hierarchy
 */
export const findTokenType = (
  node: TreeNode<TreeNodeMeta>,
  nodes: Map<string, TreeNode<TreeNodeMeta>>,
): Value["type"] | undefined => {
  // Resolver, token-set, modifier, and modifier-context nodes don't have types
  if (
    node.meta.nodeType === "resolver" ||
    node.meta.nodeType === "token-set" ||
    node.meta.nodeType === "modifier" ||
    node.meta.nodeType === "modifier-context"
  ) {
    return;
  }
  // If token has explicit type, use it
  if (node.meta.type) {
    return node.meta.type;
  }
  // If token is a child of a group, check parent group's type
  let currentParentId: string | undefined = node?.parentId;
  while (currentParentId !== undefined) {
    const parentNode = nodes.get(currentParentId);
    if (parentNode?.meta.nodeType === "token-group" && parentNode.meta.type) {
      return parentNode.meta.type;
    }
    currentParentId = parentNode?.parentId;
  }
};

/**
 * Get the full path to a token as an array of names
 * Useful for displaying reference paths like "colors > primary > base"
 */
export const getTokenPath = (
  nodeId: string,
  nodes: Map<string, TreeNode<TreeNodeMeta>>,
): string[] => {
  const path: string[] = [];
  let currentId: string | undefined = nodeId;
  while (currentId !== undefined) {
    const currentNode = nodes.get(currentId);
    if (!currentNode) break;
    path.unshift(currentNode.meta.name);
    currentId = currentNode.parentId;
  }
  return path;
};

/**
 * Information about a token reference
 */
export type TokenReference = {
  /** The node ID being referenced */
  nodeId: string;
  /** The path to the referenced token */
  path: string[];
};

/**
 * Get reference information for a token if it's an alias
 * Returns undefined if the token has a direct value (not a reference)
 */
export const getTokenReference = (
  node: TreeNode<TreeNodeMeta>,
  nodes: Map<string, TreeNode<TreeNodeMeta>>,
): TokenReference | undefined => {
  if (node.meta.nodeType !== "token") {
    return undefined;
  }
  if (!isNodeRef(node.meta.value)) {
    return undefined;
  }
  const refNodeId = node.meta.value.ref;
  return {
    nodeId: refNodeId,
    path: getTokenPath(refNodeId, nodes),
  };
};

/**
 * Reference information for a component within a composite token
 */
export type ComponentReference = {
  /** The component key (e.g., "color", "width", "fontFamily") */
  key: string;
  /** The reference information */
  reference: TokenReference;
};

/**
 * Get all component references within a composite token's raw value
 * Returns an array of component references for any sub-values that are references
 */
export const getComponentReferences = (
  node: TreeNode<TreeNodeMeta>,
  nodes: Map<string, TreeNode<TreeNodeMeta>>,
): ComponentReference[] => {
  if (node.meta.nodeType !== "token") {
    return [];
  }
  // If the whole token is a reference, don't return component references
  if (isNodeRef(node.meta.value)) {
    return [];
  }

  const refs: ComponentReference[] = [];

  const addRefIfPresent = (key: string, value: unknown) => {
    if (isNodeRef(value)) {
      refs.push({
        key,
        reference: {
          nodeId: value.ref,
          path: getTokenPath(value.ref, nodes),
        },
      });
    }
  };

  switch (node.meta.type) {
    case "transition": {
      const val = node.meta.value;
      addRefIfPresent("duration", val.duration);
      addRefIfPresent("delay", val.delay);
      addRefIfPresent("timingFunction", val.timingFunction);
      break;
    }
    case "border": {
      const val = node.meta.value;
      addRefIfPresent("color", val.color);
      addRefIfPresent("width", val.width);
      addRefIfPresent("style", val.style);
      break;
    }
    case "shadow": {
      const shadows = node.meta.value;
      for (let i = 0; i < shadows.length; i++) {
        const shadow = shadows[i];
        addRefIfPresent(`shadow[${i}].color`, shadow.color);
        addRefIfPresent(`shadow[${i}].offsetX`, shadow.offsetX);
        addRefIfPresent(`shadow[${i}].offsetY`, shadow.offsetY);
        addRefIfPresent(`shadow[${i}].blur`, shadow.blur);
        addRefIfPresent(`shadow[${i}].spread`, shadow.spread);
      }
      break;
    }
    case "typography": {
      const val = node.meta.value;
      addRefIfPresent("fontFamily", val.fontFamily);
      addRefIfPresent("fontSize", val.fontSize);
      addRefIfPresent("fontWeight", val.fontWeight);
      addRefIfPresent("letterSpacing", val.letterSpacing);
      addRefIfPresent("lineHeight", val.lineHeight);
      break;
    }
    case "gradient": {
      const stops = node.meta.value;
      for (let i = 0; i < stops.length; i++) {
        addRefIfPresent(`stop[${i}].color`, stops[i].color);
      }
      break;
    }
  }

  return refs;
};

/**
 * Information about a JSON Pointer reference for display in the UI
 */
export type JsonPointerReference = {
  /** The component key (e.g., "fontFamily") */
  componentKey: string;
  /** The full $ref path to display (e.g., "#/typography/text/primary/$root/$value/fontFamily") */
  displayRef: string;
  /** The target node ID to navigate to (if found) */
  targetNodeId: string | undefined;
};

/**
 * Get JSON Pointer references for a token
 * Returns the refs with resolved target node IDs for navigation
 */
export const getJsonPointerReferences = (
  node: TreeNode<TreeNodeMeta>,
  nodes: Map<string, TreeNode<TreeNodeMeta>>,
): JsonPointerReference[] => {
  if (node.meta.nodeType !== "token") {
    return [];
  }
  const jsonPointerRefs = node.meta.jsonPointerRefs;
  if (!jsonPointerRefs || jsonPointerRefs.length === 0) {
    return [];
  }

  // Build maps for token path lookup
  // Full path map: "theme.light.color.palette.black" -> nodeId
  // We also need to match partial paths since JSON Pointer targets don't include container hierarchy
  const fullPathToNodeId = new Map<string, string>();
  const nodeEntries: Array<{ nodeId: string; path: string[] }> = [];

  for (const [nodeId, n] of nodes) {
    if (n.meta.nodeType === "token" || n.meta.nodeType === "token-group") {
      const pathParts = getTokenPath(nodeId, nodes);
      const fullPath = pathParts.join(".");
      fullPathToNodeId.set(fullPath, nodeId);
      nodeEntries.push({ nodeId, path: pathParts });
    }
  }

  // Find a node whose path ends with the target path
  const findNodeByTargetPath = (targetPath: string): string | undefined => {
    // First try exact match
    if (fullPathToNodeId.has(targetPath)) {
      return fullPathToNodeId.get(targetPath);
    }
    // Then try suffix match (for paths within containers like modifiers)
    const targetParts = targetPath.split(".");
    for (const entry of nodeEntries) {
      if (entry.path.length >= targetParts.length) {
        const suffix = entry.path.slice(-targetParts.length);
        if (suffix.join(".") === targetPath) {
          return entry.nodeId;
        }
      }
    }
    return undefined;
  };

  return jsonPointerRefs.map((ref) => ({
    componentKey: ref.componentKey,
    displayRef: ref.targetRef,
    targetNodeId: findNodeByTargetPath(ref.targetTokenPath),
  }));
};

type ResolveContext = {
  nodes: Map<string, TreeNode<TreeNodeMeta>>;
  resolvingStack: Set<string>;
};

/**
 * Helper function to resolve a single token reference
 */
const getToken = (
  ctx: ResolveContext,
  nodeRef: NodeRef,
): TreeNode<TreeNodeMeta> => {
  const nodeId = nodeRef.ref;
  // check for circular references
  if (ctx.resolvingStack.has(nodeId)) {
    throw new Error(
      `Circular reference detected: ${Array.from(ctx.resolvingStack).join(
        " -> ",
      )} -> ${nodeId}`,
    );
  }
  // look up token by nodeId
  const tokenNode = ctx.nodes.get(nodeId);
  if (tokenNode?.meta.nodeType !== "token") {
    const stackPath = Array.from(ctx.resolvingStack)
      .map((id) => {
        const node = ctx.nodes.get(id);
        return node?.meta.nodeType === "token" ? node.meta.name : id;
      })
      .join(" -> ");
    throw new Error(
      `Token node not found while resolving nodeId "${nodeId}"` +
        (stackPath ? ` (resolving: ${stackPath})` : ""),
    );
  }
  return tokenNode;
};

/**
 * Resolves token references but does NOT resolve composite component values.
 * This is useful when you want the raw value of a composite token without
 * resolving its internal component references.
 *
 * For example, a border token with component references will return the raw
 * border value with unresolved references, rather than resolving each component.
 *
 * Returns a RawValue which may contain unresolved NodeRef objects in composite types.
 */
export const resolveRawValue = (
  node: TreeNode<TreeNodeMeta>,
  nodes: Map<string, TreeNode<TreeNodeMeta>>,
  resolvingStack: Set<string> = new Set(),
): RawValue => {
  const ctx = { nodes, resolvingStack };
  if (node.meta.nodeType !== "token") {
    throw new Error("resolveRawValue requires a token node");
  }
  // Check if value is a token reference string
  if (isNodeRef(node.meta.value)) {
    const tokenNode = getToken(ctx, node.meta.value);
    // resolve token reference but stop at first non-reference
    const newStack = new Set(resolvingStack);
    const nodeId = node.meta.value.ref;
    if (nodeId) {
      newStack.add(nodeId);
    }
    const resolvedValue = resolveRawValue(tokenNode, nodes, newStack);
    const parsed = RawValueSchema.safeParse(resolvedValue);
    if (!parsed.success) {
      throw Error(formatError(parsed.error)._errors.join("\n"));
    }
    return resolvedValue;
  }
  switch (node.meta.type) {
    // composite tokens
    case "transition":
      return { type: "transition", value: node.meta.value };
    case "border":
      return { type: "border", value: node.meta.value };
    case "shadow":
      return { type: "shadow", value: node.meta.value };
    case "typography":
      return { type: "typography", value: node.meta.value };
    case "gradient":
      return { type: "gradient", value: node.meta.value };
    // primitive tokens
    case "number":
      return { type: node.meta.type, value: node.meta.value };
    case "color":
      return { type: node.meta.type, value: node.meta.value };
    case "dimension":
      return { type: node.meta.type, value: node.meta.value };
    case "duration":
      return { type: node.meta.type, value: node.meta.value };
    case "cubicBezier":
      return { type: node.meta.type, value: node.meta.value };
    case "fontFamily":
      return { type: node.meta.type, value: node.meta.value };
    case "fontWeight":
      return { type: node.meta.type, value: node.meta.value };
    case "strokeStyle":
      return { type: node.meta.type, value: node.meta.value };
    default:
      node.meta satisfies never;
      throw Error("Unexpected case");
  }
};

const resolveRef = <
  Input extends RawValue,
  Output extends Extract<Value, { type: Input["type"] }>["value"],
>(
  ctx: ResolveContext,
  type: Input["type"],
  value: NodeRef | Output,
): Output => {
  if (!isNodeRef(value)) {
    return value;
  }
  const tokenNode = getToken(ctx, value);
  const nodeId = value.ref;
  const newStack = new Set(ctx.resolvingStack);
  if (nodeId) {
    newStack.add(nodeId);
  }
  const tokenValue = resolveTokenValue(tokenNode, ctx.nodes, newStack);
  if (tokenValue.type !== type) {
    throw Error(
      `${nodeId} is expected to have ${type} type, received ${tokenValue.type}`,
    );
  }
  return tokenValue.value as Output;
};

/**
 * "extends" resolution algorithm for aliases
 *
 * Parse reference: Extract token path from {group.token}
 * Split path: Convert to segments ["group", "token"]
 * Navigate to token: Find the target token object
 * Validate token: Ensure target has $value property
 * Return token value: Extract and return the $value content
 * Check for cycles: Maintain stack of resolving references
 */
export const resolveTokenValue = (
  node: TreeNode<TreeNodeMeta>,
  nodes: Map<string, TreeNode<TreeNodeMeta>>,
  resolvingStack: Set<string> = new Set(),
): Value => {
  const ctx = { nodes, resolvingStack };
  const rawValue = resolveRawValue(node, nodes, resolvingStack);
  // Resolve any component-level references in composite values
  switch (rawValue.type) {
    case "transition": {
      const { value } = rawValue;
      return {
        type: "transition",
        value: {
          duration: resolveRef(ctx, "duration", value.duration),
          delay: resolveRef(ctx, "duration", value.delay),
          timingFunction: resolveRef(ctx, "cubicBezier", value.timingFunction),
        },
      };
    }
    case "border": {
      const { value } = rawValue;
      return {
        type: "border",
        value: {
          color: resolveRef(ctx, "color", value.color),
          width: resolveRef(ctx, "dimension", value.width),
          style: resolveRef(ctx, "strokeStyle", value.style),
        },
      };
    }
    case "shadow":
      return {
        type: "shadow",
        value: rawValue.value.map((shadow) => ({
          color: resolveRef(ctx, "color", shadow.color),
          offsetX: resolveRef(ctx, "dimension", shadow.offsetX),
          offsetY: resolveRef(ctx, "dimension", shadow.offsetY),
          blur: resolveRef(ctx, "dimension", shadow.blur),
          spread: resolveRef(ctx, "dimension", shadow.spread),
          inset: shadow.inset,
        })),
      };
    case "typography": {
      const { value } = rawValue;
      const tokenName =
        node.meta.nodeType === "token" ? node.meta.name : "unknown";
      try {
        return {
          type: "typography",
          value: {
            fontFamily: resolveRef(ctx, "fontFamily", value.fontFamily),
            fontSize: resolveRef(ctx, "dimension", value.fontSize),
            fontWeight: resolveRef(ctx, "fontWeight", value.fontWeight),
            letterSpacing: resolveRef(ctx, "dimension", value.letterSpacing),
            lineHeight: resolveRef(ctx, "number", value.lineHeight),
          },
        };
      } catch (err) {
        console.error(`Failed resolving typography token "${tokenName}":`, {
          fontFamily: value.fontFamily,
          fontSize: value.fontSize,
          fontWeight: value.fontWeight,
          letterSpacing: value.letterSpacing,
          lineHeight: value.lineHeight,
        });
        throw err;
      }
    }
    case "gradient":
      return {
        type: "gradient",
        value: rawValue.value.map((gradient) => ({
          color: resolveRef(ctx, "color", gradient.color),
          position: gradient.position,
        })),
      };
    // primitive tokens
    case "number":
    case "color":
    case "dimension":
    case "duration":
    case "cubicBezier":
    case "fontFamily":
    case "fontWeight":
    case "strokeStyle":
      return rawValue;
    default:
      rawValue satisfies never;
      throw Error("Unexpected case");
  }
};

/**
 * Check if setting an alias would create a circular dependency
 * Returns true if the alias would be safe (no circular dependency)
 * Returns false if the alias would create a circular dependency
 */
export const isAliasCircular = (
  currentTokenId: string,
  targetTokenId: string,
  nodes: Map<string, TreeNode<TreeNodeMeta>>,
): boolean => {
  const targetNode = nodes.get(targetTokenId);
  if (!targetNode || targetNode.meta.nodeType !== "token") {
    return false;
  }

  const targetTokenMeta = targetNode.meta;

  // If target doesn't have a reference value, it's safe
  if (!isNodeRef(targetTokenMeta.value)) {
    return false;
  }

  // Build the path of tokens that the target references through
  const visited = new Set<string>();
  let currentRef: string | undefined = targetTokenMeta.value.ref;

  while (currentRef) {
    // Prevent infinite loops in our detection logic
    if (visited.has(currentRef)) {
      return false;
    }
    visited.add(currentRef);

    // Get the next reference node
    const refNode = nodes.get(currentRef);
    if (!refNode || refNode.meta.nodeType !== "token") {
      return false;
    }
    // Check if we found the current token we're trying to set as alias
    if (currentRef === currentTokenId) {
      return true; // Circular dependency detected
    }
    // Move to the next reference in the chain
    currentRef = isNodeRef(refNode.meta.value)
      ? refNode.meta.value.ref
      : undefined;
  }

  return false; // No circular dependency
};

export type TreeNodeMeta =
  | ResolverMeta
  | GroupMeta
  | TokenMeta
  | SetMeta
  | ModifierMeta
  | ModifierContextMeta;

export class TreeState<Meta> {
  #store = new TreeStore<Meta>();
  #subscribe = createSubscriber((update) => this.#store.subscribe(update));
  #syncToUrl: boolean = false;

  transact(callback: (tx: Transaction<Meta>) => void): void {
    this.#store.transact(callback);
    // Sync to URL after transaction completes
    if (this.#syncToUrl) {
      this.#updateUrl();
    }
  }

  enableUrlSync(): void {
    this.#syncToUrl = true;
  }

  #updateUrl(): void {
    const allNodes = this.#store.nodes() as Map<string, TreeNode<TreeNodeMeta>>;
    const serialized = serializeTokenResolver(allNodes);
    setDataInUrl(serialized).catch((error) => {
      console.error("Failed to sync design tokens to URL:", error);
    });
  }

  values(): TreeNode<Meta>[] {
    this.#subscribe();
    return this.#store.values();
  }

  nodes(): Map<string, TreeNode<Meta>> {
    this.#subscribe();
    return this.#store.nodes();
  }

  getNode(nodeId: string): undefined | TreeNode<Meta> {
    this.#subscribe();
    return this.#store.nodes().get(nodeId);
  }

  getChildren(nodeId: string | undefined): TreeNode<Meta>[] {
    this.#subscribe();
    return this.#store.getChildren(nodeId);
  }

  getParent(nodeId: string): TreeNode<Meta> | undefined {
    this.#subscribe();
    return this.#store.getParent(nodeId);
  }

  getPrevSibling(nodeId: string): TreeNode<Meta> | undefined {
    this.#subscribe();
    return this.#store.getPrevSibling(nodeId);
  }

  getNextSibling(nodeId: string): TreeNode<Meta> | undefined {
    this.#subscribe();
    return this.#store.getNextSibling(nodeId);
  }
}

export const treeState = new TreeState<TreeNodeMeta>();
