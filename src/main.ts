import { generateKeyBetween } from "fractional-indexing";
import { mount } from "svelte";
import App from "./app.svelte";
import "./app.css";
import { parseDesignTokens } from "./tokens";
import { treeState, type SetMeta } from "./state.svelte";
import designTokens from "./design-tokens-example.tokens.json";
import { getDataFromUrl } from "./url-data";
import type { TreeNode } from "./store";

// Get design tokens from URL or use example
const urlData = await getDataFromUrl();
const tokensData = urlData ?? designTokens;

// Parse design tokens and populate state
const parseResult = parseDesignTokens(tokensData);

// Log any parsing errors
if (parseResult.errors.length > 0) {
  console.error("Design token parsing errors:", parseResult.errors);
}

const zeroIndex = generateKeyBetween(null, null);

// Populate the tree state with parsed nodes
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
  for (const node of parseResult.nodes) {
    if (node.parentId === undefined) {
      node.parentId = baseSetNode.nodeId;
    }
    tx.set(node);
  }
});

console.info("Loaded design tokens:", parseResult.nodes.length, "nodes");

// Enable URL sync after initial load
treeState.enableUrlSync();

mount(App, { target: document.body });
