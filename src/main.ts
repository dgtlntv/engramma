import { generateKeyBetween } from "fractional-indexing";
import { mount } from "svelte";
import App from "./app.svelte";
import "./app.css";
import { parseDesignTokens } from "./tokens";
import { treeState, type SetMeta } from "./state.svelte";
import { getDataFromUrl } from "./url-data";
import type { TreeNode } from "./store";
import {
  isResolverFormat,
  parseTokenResolver,
  resolveResolverRefs,
} from "./resolver";
import type { ResolverDocument } from "./dtcg.schema";

// Load default tokens from resolver in public folder
const loadDefaultTokens = async () => {
  const baseUrl = "/tokens/canonical/";
  const response = await fetch(`${baseUrl}apps.resolver.json`);
  if (!response.ok) {
    throw new Error(`Failed to load resolver: ${response.statusText}`);
  }
  const resolverDoc: ResolverDocument = await response.json();
  return resolveResolverRefs(resolverDoc, { baseUrl });
};

// Get design tokens from URL or load defaults
const urlData = await getDataFromUrl();
const tokensData = urlData ?? (await loadDefaultTokens());

// Parse design tokens and populate state
let parsedResult: undefined | Awaited<ReturnType<typeof parseTokenResolver>>;

const zeroIndex = generateKeyBetween(null, null);

if (isResolverFormat(tokensData)) {
  const result = await parseTokenResolver(tokensData);
  parsedResult = result;
  if (result.nodes.length > 0 || result.errors.length > 0) {
    treeState.transact((tx) => {
      for (const node of result.nodes) {
        tx.set(node);
      }
    });
  }
} else {
  // Try as tokens format
  const result = parseDesignTokens(tokensData);
  parsedResult = result;
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

// Log any parsing errors
if (parsedResult.errors.length > 0) {
  console.error("Design token parsing errors:", parsedResult.errors);
}

console.info(`Loaded design tokens: ${parsedResult.nodes.length} nodes`);

// Enable URL sync after initial load
treeState.enableUrlSync();

mount(App, { target: document.body });
