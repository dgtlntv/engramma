import { createSubscriber } from "svelte/reactivity";
import { TreeStore, type Transaction, type TreeNode } from "./store";
import { type Value, ValueSchema } from "./schema";
import { isTokenReference, serializeDesignTokens } from "./tokens";
import { setDataInUrl } from "./url-data";

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
  type?: Value["type"];
  value: string | Value["value"];
  description?: string;
  deprecated?: boolean | string;
  extensions?: Record<string, unknown>;
};

/**
 * Helper function to find the type of a token
 * Searches through reference chain or parent group hierarchy
 */
export const findTokenType = (
  node: TreeNode<TreeNodeMeta>,
  nodes: Map<string, TreeNode<TreeNodeMeta>>,
): Value["type"] | undefined => {
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
  return undefined;
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
  if (node.meta.nodeType !== "token") {
    throw new Error("resolveTokenValue requires a token node");
  }
  const token = node.meta;
  // Check if value is a token reference string
  const isReference = isTokenReference(token.value);
  // If not a reference, resolve composite components if needed
  if (!isReference) {
    const resolvedType = token.type ?? findTokenType(node, nodes);
    if (!resolvedType) {
      throw new Error(`Token "${token.name}" has no determinable type`);
    }
    // Validate resolved value
    const parsed = ValueSchema.parse({
      type: resolvedType,
      value: token.value,
    });
    return parsed;
  }
  // Handle token reference
  const reference = token.value as string;
  // check for circular references
  if (resolvingStack.has(reference)) {
    throw new Error(
      `Circular reference detected: ${Array.from(resolvingStack).join(
        " -> ",
      )} -> ${reference}`,
    );
  }
  // extract token path from "group.token" or "group.nested.token"
  const segments = reference.replace(/[{}]/g, "").split(".").filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`Invalid reference format: "${reference}"`);
  }
  const nodesList = Array.from(nodes.values());
  let currentNodeId: string | undefined;
  // navigate through remaining segments
  for (const segment of segments) {
    // find child with matching name
    const nextNode = nodesList.find(
      (n) => n.parentId === currentNodeId && n.meta.name === segment,
    );
    currentNodeId = nextNode?.nodeId;
  }
  // final token node
  const tokenNode = currentNodeId ? nodes.get(currentNodeId) : undefined;
  if (tokenNode?.meta.nodeType !== "token") {
    throw new Error(
      `Final token node not found while resolving "${reference}"`,
    );
  }
  // resolve token further if it's also a reference
  const newStack = new Set(resolvingStack);
  newStack.add(reference);
  const resolved = resolveTokenValue(tokenNode, nodes, newStack);
  return resolved;
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
  const isTargetReference =
    typeof targetTokenMeta.value === "string" &&
    isTokenReference(targetTokenMeta.value);
  if (!isTargetReference) {
    return false;
  }

  // Build the path of tokens that the target references through
  const visited = new Set<string>();
  let currentRef: string | undefined = targetTokenMeta.value as string;

  while (currentRef) {
    // Prevent infinite loops in our detection logic
    if (visited.has(currentRef)) {
      return false;
    }
    visited.add(currentRef);

    // Extract token path from "group.token" format
    const segments = currentRef.replace(/[{}]/g, "").split(".").filter(Boolean);
    const nodesList = Array.from(nodes.values());
    let currentNodeId: string | undefined;

    // Navigate through segments to find the token
    for (const segment of segments) {
      const nextNode = nodesList.find(
        (n) => n.parentId === currentNodeId && n.meta.name === segment,
      );
      currentNodeId = nextNode?.nodeId;
    }

    // Check if we found the current token we're trying to set as alias
    if (currentNodeId === currentTokenId) {
      return true; // Circular dependency detected
    }

    // Get the next reference if it exists
    const nextNode = currentNodeId ? nodes.get(currentNodeId) : undefined;
    if (
      nextNode?.meta.nodeType === "token" &&
      typeof nextNode.meta.value === "string" &&
      isTokenReference(nextNode.meta.value)
    ) {
      currentRef = nextNode.meta.value;
    } else {
      // Reached end of reference chain
      currentRef = undefined;
    }
  }

  return false; // No circular dependency
};

export type TreeNodeMeta = GroupMeta | TokenMeta;

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
    const serialized = serializeDesignTokens(allNodes);
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
