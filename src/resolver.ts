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
  ModifierMeta,
  ModifierContextMeta,
  ResolverMeta,
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

/**
 * Represents a JSON Pointer reference found in the source
 */
export type JsonPointerRef = {
  /** The JSON path where the $ref was found (e.g., "typography.text.bold.$value.fontFamily") */
  locationPath: string;
  /** The $ref target (e.g., "#/typography/text/primary/$root/$value/fontFamily") */
  targetRef: string;
  /** The token path extracted from targetRef (e.g., "typography.text.primary.$root") */
  targetTokenPath: string;
};

/**
 * Extract the token path from a JSON Pointer $ref
 * e.g., "#/typography/text/primary/$root/$value/fontFamily" -> "typography.text.primary.$root"
 * We extract everything up to and including the token name (before $value or $extensions)
 */
const extractTokenPathFromRef = (ref: string): string => {
  // Remove the leading "#/"
  const path = ref.replace(/^#\//, "");
  // Split by "/"
  const parts = path.split("/");
  // Find where $value or $extensions starts - the token is everything before that
  const valueIndex = parts.findIndex(
    (p) => p === "$value" || p === "$extensions",
  );
  if (valueIndex === -1) {
    // No $value found, return the whole path (might be referencing a token directly)
    return parts.join(".");
  }
  // Return everything up to (but not including) $value/$extensions
  return parts.slice(0, valueIndex).join(".");
};

/**
 * Walk a JSON object and capture all internal $ref objects (starting with #)
 * Returns a map of location paths to their $ref targets
 */
export const captureJsonPointerRefs = (
  obj: unknown,
  currentPath: string[] = [],
): Map<string, JsonPointerRef> => {
  const refs = new Map<string, JsonPointerRef>();

  if (typeof obj !== "object" || obj === null) {
    return refs;
  }

  // Check if the current object itself is a $ref object (e.g., array element that is { "$ref": "..." })
  if (isRefObject(obj) && obj.$ref.startsWith("#")) {
    const pathStr = currentPath.join(".");
    refs.set(pathStr, {
      locationPath: pathStr,
      targetRef: obj.$ref,
      targetTokenPath: extractTokenPathFromRef(obj.$ref),
    });
    return refs;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      const childRefs = captureJsonPointerRefs(item, [
        ...currentPath,
        `[${index}]`,
      ]);
      for (const [key, value] of childRefs) {
        refs.set(key, value);
      }
    });
    return refs;
  }

  for (const [key, value] of Object.entries(obj)) {
    const path = [...currentPath, key];
    const pathStr = path.join(".");

    // Check if this value is an internal $ref object (starts with #)
    if (isRefObject(value) && value.$ref.startsWith("#")) {
      refs.set(pathStr, {
        locationPath: pathStr,
        targetRef: value.$ref,
        targetTokenPath: extractTokenPathFromRef(value.$ref),
      });
    } else {
      // Recurse into nested objects
      const childRefs = captureJsonPointerRefs(value, path);
      for (const [childKey, childValue] of childRefs) {
        refs.set(childKey, childValue);
      }
    }
  }

  return refs;
};

// Deep merge two objects, with source taking precedence over target.
// Groups are merged recursively, but tokens (objects with $value) are replaced entirely.
// Returns a new merged object without mutating inputs.
const deepMerge = (
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = { ...target };

  for (const [key, value] of Object.entries(source)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      !("$value" in value) && // Token - don't merge, replace
      result[key] !== null &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key]) &&
      result[key] instanceof Object
    ) {
      // Both are plain objects and not tokens - recurse
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      // Override: source wins
      result[key] = value;
    }
  }

  return result;
};

// Helper function to merge multiple sources into a single object.
// Later sources override earlier ones at the same path.
const mergeSources = (
  sources: Record<string, unknown>[],
): Record<string, unknown> => {
  let merged: Record<string, unknown> = {};

  for (const source of sources) {
    merged = deepMerge(merged, source);
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
// Supports cross-set token aliases through two-phase resolution:
// Phase 1: Extract intermediary nodes from all sets (collect what tokens/groups exist)
// Phase 2: Resolve with all accumulated nodes available (enables cross-set references)
//
// Note: Input must be a ResolvedResolverDocument (all $refs already resolved at file level)
// Internal JSON Pointer $refs (e.g., #/path/to/value) inside token $value objects are resolved here
//
// @param input - The resolved resolver document
// @param resolverNodeId - Optional parent ID (resolver node) for sets and modifiers
export const parseTokenResolver = async (
  input: unknown,
  resolverNodeId?: string,
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

  // PHASE 1: Extract intermediary nodes from all sets and modifier contexts
  // JSON Pointer $ref resolution requires the full document context, so we:
  // 1. First collect and merge all SET sources into a base document
  // 2. For each modifier context, merge it on top of the base, dereference, then extract its tokens
  const allIntermediaryNodes = new Map<string, any>();
  const intermediaryNodesBySet = new Map<
    string,
    Map<string, IntermediaryNode>
  >();
  // For modifiers: key is "modifierName/contextName"
  const intermediaryNodesByModifierContext = new Map<
    string,
    Map<string, IntermediaryNode>
  >();

  // First pass: collect all SET sources to build the base document for $ref resolution
  // This is needed because modifier contexts may contain JSON Pointer $refs that reference set tokens
  let baseDocument: Record<string, unknown> = {};
  const setSourcesByName = new Map<string, Record<string, unknown>>();

  for (const item of resolverDoc.resolutionOrder) {
    if (item.type === "set") {
      const mergedSetSources = mergeSources(item.sources);
      setSourcesByName.set(item.name, mergedSetSources);
      // Merge into base document (later sets override earlier ones)
      baseDocument = deepMerge(baseDocument, mergedSetSources);
    }
  }

  // Second pass: process sets (dereference each set against cumulative base)
  // This allows sets to use JSON Pointer $refs that reference tokens from earlier sets
  let cumulativeSetDocument: Record<string, unknown> = {};
  for (const item of resolverDoc.resolutionOrder) {
    if (item.type !== "set") continue;

    const mergedSetSources = setSourcesByName.get(item.name)!;

    // Capture JSON Pointer $refs before dereferencing
    const capturedRefs = captureJsonPointerRefs(mergedSetSources);

    // Collect paths that belong to this set (for filtering after dereferencing)
    const setPaths = new Set<string>();
    const collectSetPaths = (obj: unknown, path: string[] = []) => {
      if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return;
      for (const [key, value] of Object.entries(obj)) {
        if (key.startsWith("$") && key !== "$root") continue;
        const currentPath = [...path, key].join(".");
        setPaths.add(currentPath);
        collectSetPaths(value, [...path, key]);
      }
    };
    collectSetPaths(mergedSetSources);

    // Merge current set on top of cumulative document for $ref resolution
    const fullDocumentForSet = deepMerge(
      structuredClone(cumulativeSetDocument),
      mergedSetSources,
    );

    // Resolve JSON Pointer $refs against the full cumulative document
    let dereferencedFullDocument;
    try {
      dereferencedFullDocument = await $RefParser.dereference(
        fullDocumentForSet,
        { mutateInputSchema: true },
      );
    } catch (err) {
      console.error(`Failed to dereference set "${item.name}":`, err);
      dereferencedFullDocument = fullDocumentForSet;
    }

    // Extract intermediary nodes from the dereferenced document
    const { nodes: allDereferencedNodes, errors } = extractIntermediaryNodes(
      dereferencedFullDocument,
      capturedRefs,
    );

    // Filter to only include nodes that belong to this set
    const setNodes = new Map<string, IntermediaryNode>();
    for (const [path, node] of allDereferencedNodes) {
      if (setPaths.has(path)) {
        setNodes.set(path, node);
      }
    }

    intermediaryNodesBySet.set(item.name, setNodes);
    for (const [path, node] of setNodes) {
      allIntermediaryNodes.set(path, node);
    }
    collectedErrors.push(...errors);

    // Add this set to the cumulative document for subsequent sets
    cumulativeSetDocument = deepMerge(cumulativeSetDocument, mergedSetSources);
  }

  // Third pass: process modifier contexts
  // Each context is merged on top of the base document so JSON Pointer $refs can resolve
  for (const item of resolverDoc.resolutionOrder) {
    if (item.type !== "modifier") continue;

    for (const [contextName, sources] of Object.entries(item.contexts)) {
      const contextKey = `${item.name}/${contextName}`;
      const mergedContextSources = mergeSources(sources);

      // Capture JSON Pointer $refs from context sources before dereferencing
      const capturedRefs = captureJsonPointerRefs(mergedContextSources);

      // Merge context sources on top of the base document for $ref resolution
      const fullDocumentForContext = deepMerge(
        structuredClone(baseDocument),
        mergedContextSources,
      );

      // Dereference the full document (context + base)
      let dereferencedFullDocument;
      try {
        dereferencedFullDocument = await $RefParser.dereference(
          fullDocumentForContext,
          { mutateInputSchema: true },
        );
      } catch (err) {
        console.error(
          `Failed to dereference modifier context "${contextKey}":`,
          err,
        );
        dereferencedFullDocument = fullDocumentForContext;
      }

      // Extract ONLY the paths that were defined in the context sources (not the base)
      // This ensures we only get the context's own tokens, not the inherited set tokens
      const contextPaths = new Set<string>();
      const collectPaths = (obj: unknown, path: string[] = []) => {
        if (typeof obj !== "object" || obj === null || Array.isArray(obj))
          return;
        for (const [key, value] of Object.entries(obj)) {
          if (key.startsWith("$") && key !== "$root") continue;
          const currentPath = [...path, key].join(".");
          contextPaths.add(currentPath);
          collectPaths(value, [...path, key]);
        }
      };
      collectPaths(mergedContextSources);

      // Extract intermediary nodes from the dereferenced document
      const { nodes: allDereferencedNodes, errors } = extractIntermediaryNodes(
        dereferencedFullDocument,
        capturedRefs,
      );

      // Filter to only include nodes that belong to this context
      const contextNodes = new Map<string, IntermediaryNode>();
      for (const [path, node] of allDereferencedNodes) {
        if (contextPaths.has(path)) {
          contextNodes.set(path, node);
        }
      }

      intermediaryNodesByModifierContext.set(contextKey, contextNodes);
      // NOTE: We intentionally do NOT add modifier context tokens to allIntermediaryNodes here.
      // Modifier contexts (like light/dark themes) define the same token paths with different values.
      // Adding them to allIntermediaryNodes would cause later contexts to overwrite earlier ones,
      // resulting in incorrect alias resolution. Instead, we build context-specific maps in PHASE 2.
      collectedErrors.push(...errors);
    }
  }

  // PHASE 2: Resolve intermediary nodes with cross-set availability
  // Now that we have all tokens/groups from all sets, resolve references with full visibility
  // The parent for sets and modifiers is either the resolver node (if provided) or root (undefined)
  const rootParentId = resolverNodeId ?? undefined;

  for (const item of resolverDoc.resolutionOrder) {
    if (item.type === "modifier") {
      // Create a modifier node under the resolver (or at root level)
      const modifierNodeId = crypto.randomUUID();
      const prevIndex = lastChildIndexPerParent.get(rootParentId);
      const newIndex = generateKeyBetween(prevIndex ?? zeroIndex, null);
      lastChildIndexPerParent.set(rootParentId, newIndex);

      const modifierNode: TreeNode<ModifierMeta> = {
        nodeId: modifierNodeId,
        parentId: rootParentId,
        index: newIndex,
        meta: {
          nodeType: "modifier",
          name: item.name,
          description: item.description,
          default: item.default,
          extensions: item.$extensions,
        },
      };
      allNodes.push(modifierNode);

      // Create context nodes as children of the modifier
      for (const [contextName] of Object.entries(item.contexts)) {
        const contextKey = `${item.name}/${contextName}`;
        const intermediaryNodes =
          intermediaryNodesByModifierContext.get(contextKey);
        if (!intermediaryNodes) {
          continue;
        }

        // Build a context-specific map for alias resolution:
        // - Start with base tokens from sets (allIntermediaryNodes)
        // - Overlay this context's tokens (so context-specific aliases resolve within the context)
        const contextAvailableNodes = new Map(allIntermediaryNodes);
        for (const [path, node] of intermediaryNodes) {
          contextAvailableNodes.set(path, node);
        }

        // Resolve context's intermediary nodes
        const { nodes, errors } = resolveIntermediaryNodes(
          intermediaryNodes,
          contextAvailableNodes,
        );

        // Create a context node as child of modifier
        const contextNodeId = crypto.randomUUID();
        const prevContextIndex = lastChildIndexPerParent.get(modifierNodeId);
        const newContextIndex = generateKeyBetween(
          prevContextIndex ?? zeroIndex,
          null,
        );
        lastChildIndexPerParent.set(modifierNodeId, newContextIndex);

        const contextNode: TreeNode<ModifierContextMeta> = {
          nodeId: contextNodeId,
          parentId: modifierNodeId,
          index: newContextIndex,
          meta: {
            nodeType: "modifier-context",
            name: contextName,
          },
        };
        allNodes.push(contextNode);

        // Re-parent root-level tokens/groups to the context node
        for (const node of nodes) {
          if (node.parentId === undefined) {
            node.parentId = contextNodeId;
          }
          allNodes.push(node);
        }

        collectedErrors.push(...errors);
      }
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

    // Create a new token-set node for this Set under the resolver (or at root level)
    const setNodeId = crypto.randomUUID();
    const prevSetIndex = lastChildIndexPerParent.get(rootParentId);
    const newSetIndex = generateKeyBetween(prevSetIndex ?? zeroIndex, null);
    lastChildIndexPerParent.set(rootParentId, newSetIndex);

    const setNode: TreeNode<SetMeta> = {
      nodeId: setNodeId,
      parentId: rootParentId,
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
  // Collect all sets and modifiers (either at root or under resolver nodes)
  const rootNodes: Array<TreeNode<SetMeta | ModifierMeta>> = [];
  for (const node of nodes.values()) {
    if (
      node.meta.nodeType === "token-set" ||
      node.meta.nodeType === "modifier"
    ) {
      // Check if parent is either undefined (root) or a resolver node
      const parentNode = node.parentId ? nodes.get(node.parentId) : undefined;
      if (
        node.parentId === undefined ||
        parentNode?.meta.nodeType === "resolver"
      ) {
        rootNodes.push(node as TreeNode<SetMeta | ModifierMeta>);
      }
    }
  }

  // Sort by index to maintain document order
  rootNodes.sort(compareTreeNodes);
  const resolutionOrder: (ResolvedResolverSet | ResolvedResolverModifier)[] =
    [];

  for (const rootNode of rootNodes) {
    if (rootNode.meta.nodeType === "modifier") {
      const modifierNode = rootNode as TreeNode<ModifierMeta>;
      // Collect context children of this modifier
      const contextNodes: Array<TreeNode<ModifierContextMeta>> = [];
      for (const node of nodes.values()) {
        if (
          node.parentId === modifierNode.nodeId &&
          node.meta.nodeType === "modifier-context"
        ) {
          contextNodes.push(node as TreeNode<ModifierContextMeta>);
        }
      }
      contextNodes.sort(compareTreeNodes);

      // Build contexts object
      const contexts: Record<string, ResolverSource[]> = {};
      for (const contextNode of contextNodes) {
        // Create a filtered map containing only this context's descendants
        const contextSubtree = new Map<string, TreeNode<TreeNodeMeta>>();
        const collectDescendants = (
          nodeId: string | undefined,
          parentNodeId: string,
        ) => {
          let node = nodeId ? nodes.get(nodeId) : undefined;
          if (!node) {
            return;
          }
          // Skip modifier and modifier-context nodes
          if (
            node.meta.nodeType !== "modifier" &&
            node.meta.nodeType !== "modifier-context"
          ) {
            // Re-parent direct children of context to root (undefined)
            if (node.parentId === parentNodeId) {
              node = { ...node, parentId: undefined };
            }
            contextSubtree.set(node.nodeId, node);
          }
          // Recursively collect all children
          for (const child of nodes.values()) {
            if (child.parentId === nodeId) {
              collectDescendants(child.nodeId, parentNodeId);
            }
          }
        };

        collectDescendants(contextNode.nodeId, contextNode.nodeId);
        const source = serializeDesignTokens(
          contextSubtree as Map<string, TreeNode<TokenMeta | GroupMeta>>,
          nodes as Map<string, TreeNode<TokenMeta | GroupMeta>>,
        );
        contexts[contextNode.meta.name] = [source];
      }

      resolutionOrder.push({
        type: "modifier",
        name: modifierNode.meta.name,
        description: modifierNode.meta.description,
        default: modifierNode.meta.default,
        $extensions: modifierNode.meta.extensions,
        contexts,
      });
    } else {
      const setNode = rootNode as TreeNode<SetMeta>;
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
  }

  return {
    version: "2025.10",
    name: metadata?.name,
    description: metadata?.description,
    resolutionOrder,
  };
};
