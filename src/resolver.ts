import { prettifyError } from "zod";
import { generateKeyBetween } from "fractional-indexing";
import $RefParser from "@apidevtools/json-schema-ref-parser";
import {
  resolvedResolverDocumentSchema,
  type ResolverDocument,
  type ResolverSource,
  type SourceItem,
  type RefObject,
  type ResolvedResolverDocument,
  type ResolvedResolverSet,
  type ResolvedResolverModifier,
} from "./dtcg.schema";
import {
  serializeDesignTokens,
  extractIntermediaryNodes,
  resolveIntermediaryNodes,
  type IntermediaryNode,
} from "./tokens";
import { compareTreeNodes } from "./store";
import type {
  GroupMeta,
  SetMeta,
  TokenMeta,
  TreeNodeMeta,
} from "./state.svelte";
import type { TreeNode } from "./store";

type ParseResult = {
  nodes: TreeNode<TreeNodeMeta>[];
  errors: Array<{ path: string; message: string }>;
};

// Type for file loader function - takes a path relative to resolver, returns file content
export type FileLoader = (
  path: string,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

// Options for resolving $ref references
export type ResolveOptions =
  | { baseUrl: string } // Fetch files relative to this URL
  | { fileLoader: FileLoader }; // Use custom loader (e.g., for uploaded files)

// Check if an object is a $ref object
export const isRefObject = (obj: unknown): obj is RefObject => {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "$ref" in obj &&
    typeof (obj as RefObject).$ref === "string"
  );
};

// Helper function to deep merge sources respecting path-based order
// Later sources override earlier ones at the same path
const mergeSources = (
  sources: Record<string, unknown>[],
): Record<string, unknown> => {
  const merged: Record<string, unknown> = {};

  const deepMerge = (
    target: Record<string, unknown>,
    source: Record<string, unknown>,
  ): void => {
    for (const [key, value] of Object.entries(source)) {
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !(value instanceof Date) &&
        !("$value" in value) && // Token - don't merge, replace
        target[key] !== null &&
        typeof target[key] === "object" &&
        !Array.isArray(target[key]) &&
        target[key] instanceof Object
      ) {
        // Both are plain objects and not tokens - recurse
        deepMerge(
          target[key] as Record<string, unknown>,
          value as Record<string, unknown>,
        );
      } else {
        // Override: later source wins
        target[key] = value;
      }
    }
  };

  for (const source of sources) {
    deepMerge(merged, source);
  }

  return merged;
};

// Detect if JSON is resolver format by checking for resolver-specific fields
export const isResolverFormat = (obj: unknown): boolean => {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }
  const o = obj as Record<string, unknown>;
  // Resolver must have version "2025.10" and resolutionOrder array
  return o.version === "2025.10" && Array.isArray(o.resolutionOrder);
};

/**
 * Resolves all $ref references in a resolver document.
 * - External file references (e.g., "global/primitive/color.tokens.json") are loaded via fetch or fileLoader
 * - Internal document references (e.g., "#/sets/primitive") are resolved within the document
 *
 * @param resolverDoc - The resolver document with unresolved $ref objects
 * @param options - Either { baseUrl } to fetch files, or { fileLoader } for custom loading
 * @returns Fully resolved resolver document ready for parseTokenResolver
 */
export const resolveResolverRefs = async (
  resolverDoc: ResolverDocument,
  options: ResolveOptions,
): Promise<ResolvedResolverDocument> => {
  // Create the file loader based on options
  const loadFile = async (path: string): Promise<Record<string, unknown>> => {
    if ("baseUrl" in options) {
      // Construct URL - handle both absolute and relative base URLs
      const base = options.baseUrl.startsWith("http")
        ? options.baseUrl
        : new URL(options.baseUrl, window.location.origin).href;
      const url = new URL(path, base).href;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load ${url}: ${response.statusText}`);
      }
      return response.json();
    } else {
      return options.fileLoader(path);
    }
  };

  // Resolve a sources array - replace $ref objects with loaded file contents
  const resolveSources = async (
    sources: SourceItem[],
  ): Promise<ResolverSource[]> => {
    const resolved: ResolverSource[] = [];

    for (const source of sources) {
      if (isRefObject(source)) {
        const ref = source.$ref;
        // External file reference (doesn't start with #)
        if (!ref.startsWith("#")) {
          const content = await loadFile(ref);
          resolved.push(content as ResolverSource);
        }
      } else {
        // Inline tokens - pass through
        resolved.push(source);
      }
    }

    return resolved;
  };

  // Build the resolved resolutionOrder array
  const resolvedResolutionOrder: (
    | ResolvedResolverSet
    | ResolvedResolverModifier
  )[] = [];

  for (const item of resolverDoc.resolutionOrder) {
    if (isRefObject(item)) {
      const ref = item.$ref;

      // Internal reference to root-level sets
      if (ref.startsWith("#/sets/")) {
        const setName = ref.replace("#/sets/", "");
        const set = resolverDoc.sets?.[setName];
        if (set) {
          const resolvedSources = await resolveSources(set.sources);
          resolvedResolutionOrder.push({
            type: "set",
            name: setName,
            description: set.description,
            $extensions: set.$extensions,
            sources: resolvedSources,
          });
        }
      }

      // Internal reference to root-level modifiers
      if (ref.startsWith("#/modifiers/")) {
        const modifierName = ref.replace("#/modifiers/", "");
        const modifier = resolverDoc.modifiers?.[modifierName];
        if (modifier) {
          const resolvedContexts: Record<string, ResolverSource[]> = {};
          for (const [contextName, sources] of Object.entries(
            modifier.contexts,
          )) {
            resolvedContexts[contextName] = await resolveSources(sources);
          }
          resolvedResolutionOrder.push({
            type: "modifier",
            name: modifierName,
            description: modifier.description,
            default: modifier.default,
            $extensions: modifier.$extensions,
            contexts: resolvedContexts,
          });
        }
      }
    } else if (item.type === "set") {
      // Inline set - resolve its sources
      const resolvedSources = await resolveSources(item.sources);
      resolvedResolutionOrder.push({
        type: "set",
        name: item.name,
        description: item.description,
        $extensions: item.$extensions,
        sources: resolvedSources,
      });
    } else if (item.type === "modifier") {
      // Inline modifier - resolve its context sources
      const resolvedContexts: Record<string, ResolverSource[]> = {};
      for (const [contextName, sources] of Object.entries(item.contexts)) {
        resolvedContexts[contextName] = await resolveSources(sources);
      }
      resolvedResolutionOrder.push({
        type: "modifier",
        name: item.name,
        description: item.description,
        default: item.default,
        $extensions: item.$extensions,
        contexts: resolvedContexts,
      });
    }
  }

  return {
    $schema: resolverDoc.$schema,
    version: resolverDoc.version,
    name: resolverDoc.name,
    description: resolverDoc.description,
    resolutionOrder: resolvedResolutionOrder,
  };
};

// Parse a resolved resolver document containing sets and modifiers in resolutionOrder
// Creates separate root token-sets for each Set item
// Only processes Set items; Modifier items are silently skipped
// Supports cross-set token aliases through two-phase resolution:
// Phase 1: Extract intermediary nodes from all sets (collect what tokens/groups exist)
// Phase 2: Resolve with all accumulated nodes available (enables cross-set references)
//
// Note: Input must be a ResolvedResolverDocument (all $refs already resolved at file level)
// Internal JSON Pointer $refs (e.g., #/path/to/value) inside token $value objects are resolved here
export const parseTokenResolver = async (
  input: unknown,
): Promise<ParseResult> => {
  // Validate resolved resolver document structure
  const validation = resolvedResolverDocumentSchema.safeParse(input);

  if (!validation.success) {
    const errorMessage = prettifyError(validation.error);
    return {
      nodes: [],
      errors: [{ path: "resolver", message: errorMessage }],
    };
  }

  const resolverDoc: ResolvedResolverDocument = validation.data;
  const allNodes: Array<any> = [];
  const collectedErrors: Array<{ path: string; message: string }> = [];
  const lastChildIndexPerParent = new Map<string | undefined, string>();
  const zeroIndex = generateKeyBetween(null, null);

  // PHASE 1: Extract intermediary nodes from all sets
  // This collects all tokens/groups with their paths, without resolving references yet
  const allIntermediaryNodes = new Map<string, any>();
  const intermediaryNodesBySet = new Map<
    string,
    Map<string, IntermediaryNode>
  >();

  for (const item of resolverDoc.resolutionOrder) {
    // Silently skip modifier items
    if (item.type === "modifier") {
      continue;
    }
    const mergedSetSources = mergeSources(item.sources);
    // Resolve internal JSON Pointer $refs (e.g., #/typography/text/primary/$root/$value/fontFamily)
    // These are used in composite token values like typography to reference other values in the same document
    let dereferencedSources;
    try {
      dereferencedSources = await $RefParser.dereference(
        structuredClone(mergedSetSources),
        { mutateInputSchema: true },
      );
    } catch (err) {
      console.error(`Failed to dereference set "${item.name}":`, err);
      dereferencedSources = mergedSetSources;
    }
    const { nodes, errors } = extractIntermediaryNodes(dereferencedSources);
    intermediaryNodesBySet.set(item.name, nodes);
    for (const [path, node] of nodes) {
      allIntermediaryNodes.set(path, node);
    }
    collectedErrors.push(...errors);
  }

  // PHASE 2: Resolve intermediary nodes with cross-set availability
  // Now that we have all tokens/groups from all sets, resolve references with full visibility
  for (const item of resolverDoc.resolutionOrder) {
    if (item.type === "modifier") {
      // Silently skip modifier items
      continue;
    }
    // Get this set's intermediary nodes
    const intermediaryNodes = intermediaryNodesBySet.get(item.name);
    if (!intermediaryNodes) {
      continue;
    }
    // Resolve this set's intermediary nodes, using all accumulated nodes for reference lookup
    const { nodes, errors } = resolveIntermediaryNodes(
      intermediaryNodes,
      allIntermediaryNodes,
    );

    // Create a new token-set node for this Set
    const setNodeId = crypto.randomUUID();
    const prevSetIndex = lastChildIndexPerParent.get(undefined);
    const newSetIndex = generateKeyBetween(prevSetIndex ?? zeroIndex, null);
    lastChildIndexPerParent.set(undefined, newSetIndex);

    const setNode: TreeNode<SetMeta> = {
      nodeId: setNodeId,
      parentId: undefined,
      index: newSetIndex,
      meta: {
        nodeType: "token-set",
        name: item.name,
        description: item.description,
        extensions: item.$extensions,
      },
    };

    // Add the token-set node
    allNodes.push(setNode);

    // Re-parent root-level tokens/groups from this Set to the token-set node
    // Only set parentId for nodes at root level (parentId is undefined)
    // This preserves the hierarchy of nested groups and tokens within the Set
    for (const node of nodes) {
      if (node.parentId === undefined) {
        node.parentId = setNodeId;
      }
      allNodes.push(node);
    }

    // Collect errors from this Set
    collectedErrors.push(...errors);
  }

  return {
    nodes: allNodes,
    errors: collectedErrors,
  };
};

/**
 * Serializes tree nodes back into a ResolvedResolverDocument following the Design Tokens Resolver Module 2025.10 specification.
 *
 * This function converts a tree structure (as produced by parseTokenResolver) back into a valid resolver document.
 * Each token-set node at the root level becomes a Set in the resolutionOrder array.
 *
 * @param nodes - Map of all tree nodes (nodeId → TreeNode)
 * @param metadata - Optional document-level metadata (name and description)
 * @returns A valid ResolvedResolverDocument with sets organized in resolutionOrder
 *
 * @example
 * ```typescript
 * const resolver = parseTokenResolver(jsonData);
 * const document = serializeTokenResolver(
 *   new Map(resolver.nodes.map(n => [n.nodeId, n])),
 *   { name: "My Design System", description: "..." }
 * );
 * ```
 */
export const serializeTokenResolver = (
  nodes: Map<string, TreeNode<TreeNodeMeta>>,
  metadata?: { name?: string; description?: string },
): ResolvedResolverDocument => {
  const setNodes: Array<TreeNode<SetMeta>> = [];
  for (const node of nodes.values()) {
    if (node.parentId === undefined && node.meta.nodeType === "token-set") {
      setNodes.push(node as TreeNode<SetMeta>);
    }
  }

  // Sort by index to maintain document order
  setNodes.sort(compareTreeNodes);
  const resolutionOrder: ResolvedResolverSet[] = [];
  for (const setNode of setNodes) {
    // Create a filtered map containing only this set's descendants (excluding the set node itself)
    // serializeDesignTokens expects token and group nodes, not token-set nodes
    const setSubtree = new Map<string, TreeNode<TreeNodeMeta>>();
    const collectDescendants = (nodeId: string | undefined) => {
      let node = nodeId ? nodes.get(nodeId) : undefined;
      if (!node) {
        return;
      }
      // Skip the token-set node itself, only collect token and group children
      if (node.meta.nodeType !== "token-set") {
        // Re-parent direct children of token-set to root (undefined)
        if (node.parentId === setNode.nodeId) {
          // avoid mutating original nodes
          node = { ...node, parentId: undefined };
        }
        setSubtree.set(node.nodeId, node);
      }
      // Recursively collect all children
      for (const child of nodes.values()) {
        if (child.parentId === nodeId) {
          collectDescendants(child.nodeId);
        }
      }
    };

    collectDescendants(setNode.nodeId);
    const source = serializeDesignTokens(
      setSubtree as Map<string, TreeNode<TokenMeta | GroupMeta>>,
      nodes as Map<string, TreeNode<TokenMeta | GroupMeta>>, // Pass all nodes for cross-set reference lookup
    );
    resolutionOrder.push({
      type: "set",
      name: setNode.meta.name,
      description: setNode.meta.description,
      $extensions: setNode.meta.extensions,
      sources: [source],
    });
  }

  return {
    version: "2025.10",
    name: metadata?.name,
    description: metadata?.description,
    resolutionOrder,
  };
};
