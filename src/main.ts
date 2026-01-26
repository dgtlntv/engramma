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

// Load all resolvers from public folder (in parallel)
const loadAllResolvers = async (): Promise<
  Array<{ filename: string; resolved: ResolvedResolverDocument }>
> => {
  const baseUrl = "/tokens/canonical/";

  const loadResults = await Promise.all(
    RESOLVER_FILES.map(async (filename) => {
      try {
        const response = await fetch(`${baseUrl}${filename}`);
        if (!response.ok) {
          console.warn(
            `Failed to load resolver ${filename}: ${response.statusText}`,
          );
          return null;
        }
        const resolverDoc: ResolverDocument = await response.json();
        const resolved = await resolveResolverRefs(resolverDoc, { baseUrl });
        return { filename, resolved };
      } catch (err) {
        console.warn(`Error loading resolver ${filename}:`, err);
        return null;
      }
    }),
  );

  // Filter out failed loads and maintain order
  return loadResults.filter(
    (
      result,
    ): result is { filename: string; resolved: ResolvedResolverDocument } =>
      result !== null,
  );
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
console.time("total-load");
console.time("url-check");
const urlData = await getDataFromUrl();
console.timeEnd("url-check");

const zeroIndex = generateKeyBetween(null, null);

// Track all parsed results for logging
const allParsedResults: Array<{
  nodes: TreeNode<any>[];
  errors: Array<{ path: string; message: string }>;
}> = [];

if (urlData) {
  // URL data takes precedence - load as single file (legacy behavior)
  if (isResolverFormat(urlData)) {
    console.time("parse-url-resolver");
    const result = await parseTokenResolver(urlData);
    console.timeEnd("parse-url-resolver");
    allParsedResults.push(result);
    if (result.nodes.length > 0 || result.errors.length > 0) {
      console.time("transact-url");
      treeState.transact((tx) => {
        for (const node of result.nodes) {
          tx.set(node);
        }
      });
      console.timeEnd("transact-url");
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
  console.time("load-resolvers");
  const resolvers = await loadAllResolvers();
  console.timeEnd("load-resolvers");

  // Parse all resolvers in parallel
  console.time("parse-resolvers");
  const parsedResolvers = await Promise.all(
    resolvers.map(async ({ filename, resolved }) => {
      const resolverName = filename.replace(".resolver.json", "");
      const resolverNodeId = crypto.randomUUID();
      const result = await parseTokenResolver(resolved, resolverNodeId);
      return { resolverName, resolverNodeId, resolved, result };
    }),
  );
  console.timeEnd("parse-resolvers");

  // Now add to tree state (must be sequential due to index ordering)
  console.time("transact-resolvers");
  let lastResolverIndex: string | null = null;
  for (const {
    resolverName,
    resolverNodeId,
    resolved,
    result,
  } of parsedResolvers) {
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

    allParsedResults.push(result);

    treeState.transact((tx) => {
      tx.set(resolverNode);
      for (const node of result.nodes) {
        tx.set(node);
      }
    });
  }
  console.timeEnd("transact-resolvers");
}

// Log any parsing errors
const totalErrors = allParsedResults.flatMap((r) => r.errors);
if (totalErrors.length > 0) {
  console.error("Design token parsing errors:", totalErrors);
}

const totalNodes = allParsedResults.reduce((sum, r) => sum + r.nodes.length, 0);
console.info(`Loaded design tokens: ${totalNodes} nodes`);
console.timeEnd("total-load");

// Enable URL sync after initial load
treeState.enableUrlSync();

console.time("mount");
mount(App, { target: document.body });
console.timeEnd("mount");
