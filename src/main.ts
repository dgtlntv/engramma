import { generateKeyBetween } from "fractional-indexing";
import { mount } from "svelte";
import App from "./app.svelte";
import "./app.css";
import { parseDesignTokens } from "./tokens";
import { treeState, type SetMeta, type ResolverMeta } from "./state.svelte";
import { getDataFromUrl } from "./url-data";
import type { TreeNode } from "./store";
import {
  isResolverFormat,
  parseTokenResolver,
  resolveResolverRefs,
} from "./resolver";
import type { ResolverDocument, ResolvedResolverDocument } from "./dtcg.schema";

// All available resolver files
const RESOLVER_FILES = [
  "apps.resolver.json",
  "docs.resolver.json",
  "sites.resolver.json",
];

// Load all resolvers from public folder
const loadAllResolvers = async (): Promise<
  Array<{ filename: string; resolved: ResolvedResolverDocument }>
> => {
  const baseUrl = "/tokens/canonical/";
  const results: Array<{
    filename: string;
    resolved: ResolvedResolverDocument;
  }> = [];

  for (const filename of RESOLVER_FILES) {
    try {
      const response = await fetch(`${baseUrl}${filename}`);
      if (!response.ok) {
        console.warn(
          `Failed to load resolver ${filename}: ${response.statusText}`,
        );
        continue;
      }
      const resolverDoc: ResolverDocument = await response.json();
      const resolved = await resolveResolverRefs(resolverDoc, { baseUrl });
      results.push({ filename, resolved });
    } catch (err) {
      console.warn(`Error loading resolver ${filename}:`, err);
    }
  }

  return results;
};

// Load default tokens from resolver in public folder (legacy single-file mode)
const loadDefaultTokens = async () => {
  const baseUrl = "/tokens/canonical/";
  const response = await fetch(`${baseUrl}apps.resolver.json`);
  if (!response.ok) {
    throw new Error(`Failed to load resolver: ${response.statusText}`);
  }
  const resolverDoc: ResolverDocument = await response.json();
  return resolveResolverRefs(resolverDoc, { baseUrl });
};

// Get design tokens from URL or load all resolvers
const urlData = await getDataFromUrl();

const zeroIndex = generateKeyBetween(null, null);

// Track all parsed results for logging
const allParsedResults: Array<{
  nodes: TreeNode<any>[];
  errors: Array<{ path: string; message: string }>;
}> = [];

if (urlData) {
  // URL data takes precedence - load as single file (legacy behavior)
  if (isResolverFormat(urlData)) {
    const result = await parseTokenResolver(urlData);
    allParsedResults.push(result);
    if (result.nodes.length > 0 || result.errors.length > 0) {
      treeState.transact((tx) => {
        for (const node of result.nodes) {
          tx.set(node);
        }
      });
    }
  } else {
    // Try as tokens format
    const result = parseDesignTokens(urlData);
    allParsedResults.push(result);
    if (result.nodes.length > 0 || result.errors.length > 0) {
      treeState.transact((tx) => {
        const baseSetNode: TreeNode<SetMeta> = {
          nodeId: crypto.randomUUID(),
          parentId: undefined,
          index: zeroIndex,
          meta: {
            nodeType: "token-set",
            name: "Base",
          },
        };
        tx.set(baseSetNode);
        for (const node of result.nodes) {
          if (node.parentId === undefined) {
            node.parentId = baseSetNode.nodeId;
          }
          tx.set(node);
        }
      });
    }
  }
} else {
  // Load all resolver files and create resolver nodes for each
  const resolvers = await loadAllResolvers();
  let lastResolverIndex: string | null = null;

  for (const { filename, resolved } of resolvers) {
    // Extract resolver name from filename (e.g., "apps.resolver.json" -> "apps")
    const resolverName = filename.replace(".resolver.json", "");

    // Create a resolver node
    const resolverNodeId = crypto.randomUUID();
    const newIndex = generateKeyBetween(lastResolverIndex ?? zeroIndex, null);
    lastResolverIndex = newIndex;

    const resolverNode: TreeNode<ResolverMeta> = {
      nodeId: resolverNodeId,
      parentId: undefined,
      index: newIndex,
      meta: {
        nodeType: "resolver",
        name: resolverName,
        description: resolved.description,
      },
    };

    // Parse the resolver's tokens with the resolver node as parent
    const result = await parseTokenResolver(resolved, resolverNodeId);
    allParsedResults.push(result);

    treeState.transact((tx) => {
      // Add the resolver node first
      tx.set(resolverNode);
      // Then add all parsed nodes (sets, modifiers, groups, tokens)
      for (const node of result.nodes) {
        tx.set(node);
      }
    });
  }
}

// Log any parsing errors
const totalErrors = allParsedResults.flatMap((r) => r.errors);
if (totalErrors.length > 0) {
  console.error("Design token parsing errors:", totalErrors);
}

const totalNodes = allParsedResults.reduce((sum, r) => sum + r.nodes.length, 0);
console.info(`Loaded design tokens: ${totalNodes} nodes`);

// Enable URL sync after initial load
treeState.enableUrlSync();

mount(App, { target: document.body });
