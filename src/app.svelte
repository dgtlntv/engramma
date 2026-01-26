<script module lang="ts">
  import "@oddbird/popover-polyfill";
  import "invokers-polyfill";
  import "dialog-closedby-polyfill";
  import "hdr-color-input";
  import "interestfor";
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { generateKeyBetween } from "fractional-indexing";
  import {
    autoPlacement,
    autoUpdate,
    computePosition,
    offset,
    shift,
  } from "@floating-ui/dom";
  import {
    focusGroupKeyUX,
    hotkeyKeyUX,
    hotkeyMacCompat,
    startKeyUX,
  } from "keyux";
  import {
    Settings,
    Trash2,
    Folder,
    Square,
    Ruler,
    Clock,
    Type,
    Hash,
    Bold,
    Tangent,
    CaseUpper,
    ArrowRightLeft,
    LineSquiggle,
    Paintbrush,
    Tags,
    ListPlus,
    ToggleLeft,
    Layers,
    FileJson,
  } from "@lucide/svelte";
  import TreeView, { type TreeItem } from "./tree-view.svelte";
  import Editor from "./editor.svelte";
  import AddToken from "./add-token.svelte";
  import AppMenu from "./app-menu.svelte";
  import Styleguide from "./styleguide.svelte";
  import type { TreeNode } from "./store";
  import {
    findTokenType,
    resolveTokenValue,
    treeState,
    type TreeNodeMeta,
  } from "./state.svelte";
  import { serializeColor } from "./color";
  import type { Value } from "./schema";

  const zeroIndex = generateKeyBetween(null, null);

  onMount(() => {
    return startKeyUX(window, [
      hotkeyKeyUX([hotkeyMacCompat()]),
      focusGroupKeyUX(),
    ]);
  });

  // Cache nodes() to avoid redundant calls
  const allNodes = $derived(treeState.nodes());

  const rootNodes = $derived(treeState.getChildren(undefined));

  // Virtual section ID prefixes for grouping sets and modifiers
  const SETS_SECTION_PREFIX = "__sets__";
  const MODIFIERS_SECTION_PREFIX = "__modifiers__";

  // Helper to create virtual section IDs (unique per parent)
  const getSetsId = (parentId?: string) =>
    parentId ? `${SETS_SECTION_PREFIX}:${parentId}` : SETS_SECTION_PREFIX;
  const getModifiersId = (parentId?: string) =>
    parentId
      ? `${MODIFIERS_SECTION_PREFIX}:${parentId}`
      : MODIFIERS_SECTION_PREFIX;

  // Check if an ID is a virtual section
  const isVirtualSection = (id: string) =>
    id.startsWith(SETS_SECTION_PREFIX) ||
    id.startsWith(MODIFIERS_SECTION_PREFIX);

  // Get initial selection from URL hash or default to first root node
  const getInitialSelection = (): string[] => {
    const hash = window.location.hash.slice(1); // Remove the # prefix
    if (hash && treeState.getNode(hash)) {
      return [hash];
    }
    return rootNodes.length ? [rootNodes[0].nodeId] : [];
  };

  // svelte-ignore state_referenced_locally
  let selectedItems = new SvelteSet<string>(getInitialSelection());

  // Search state for filtering tokens in styleguide
  let searchQuery = $state("");

  // Track if we're handling a popstate to avoid update loops
  let isHandlingPopState = false;

  // Handle browser back/forward navigation
  $effect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const hash = window.location.hash.slice(1);
      if (hash && treeState.getNode(hash)) {
        isHandlingPopState = true;
        selectedItems.clear();
        selectedItems.add(hash);
        isHandlingPopState = false;
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  });

  // Sync selection to URL hash (replaceState so tree clicks don't add history entries)
  // Reference link clicks use pushState separately in styleguide.svelte
  $effect(() => {
    if (isHandlingPopState) return;
    const firstSelected = Array.from(selectedItems)[0];
    const currentHash = window.location.hash.slice(1);
    if (firstSelected && firstSelected !== currentHash) {
      const newUrl = `${window.location.pathname}${window.location.search}#${firstSelected}`;
      window.history.replaceState(
        { selectedNodeId: firstSelected },
        "",
        newUrl,
      );
    }
  });

  const buildTreeItem = (node: TreeNode<TreeNodeMeta>): TreeItem => {
    const children = treeState.getChildren(node.nodeId);
    return {
      id: node.nodeId,
      parentId: node.parentId,
      name: node.meta.name,
      children: children.map(buildTreeItem),
    };
  };

  // Build tree item for a resolver with virtual Sets/Modifiers sections
  const buildResolverTreeItem = (node: TreeNode<TreeNodeMeta>): TreeItem => {
    const children = treeState.getChildren(node.nodeId);
    const sets = children.filter((n) => n.meta.nodeType === "token-set");
    const modifiers = children.filter((n) => n.meta.nodeType === "modifier");

    const sections: TreeItem[] = [];

    if (sets.length > 0) {
      sections.push({
        id: getSetsId(node.nodeId),
        parentId: node.nodeId,
        name: "Sets",
        children: sets.map(buildTreeItem),
      });
    }

    if (modifiers.length > 0) {
      sections.push({
        id: getModifiersId(node.nodeId),
        parentId: node.nodeId,
        name: "Modifiers",
        children: modifiers.map(buildTreeItem),
      });
    }

    return {
      id: node.nodeId,
      parentId: node.parentId,
      name: node.meta.name,
      children: sections,
    };
  };

  // Build tree data, handling both resolver-based and legacy modes
  const treeData = $derived.by(() => {
    // Check if there are resolver nodes at root level
    const resolvers = rootNodes.filter((n) => n.meta.nodeType === "resolver");

    if (resolvers.length > 0) {
      // Resolver-based mode: show resolvers with Sets/Modifiers sections inside
      return resolvers.map(buildResolverTreeItem);
    }

    // Legacy mode: group root-level sets and modifiers into virtual sections
    const sets = rootNodes.filter((n) => n.meta.nodeType === "token-set");
    const modifiers = rootNodes.filter((n) => n.meta.nodeType === "modifier");

    const sections: TreeItem[] = [];

    if (sets.length > 0) {
      sections.push({
        id: getSetsId(),
        parentId: undefined,
        name: "Sets",
        children: sets.map(buildTreeItem),
      });
    }

    if (modifiers.length > 0) {
      sections.push({
        id: getModifiersId(),
        parentId: undefined,
        name: "Modifiers",
        children: modifiers.map(buildTreeItem),
      });
    }

    return sections;
  });

  // Check if we're in resolver-based mode
  const hasResolvers = $derived(
    rootNodes.some((n) => n.meta.nodeType === "resolver"),
  );

  const defaultExpandedItems = $derived.by(() => {
    if (hasResolvers) {
      // In resolver mode, expand all resolver nodes and their sections
      const resolverIds = rootNodes
        .filter((n) => n.meta.nodeType === "resolver")
        .map((n) => n.nodeId);
      const sectionIds = resolverIds.flatMap((id) => [
        getSetsId(id),
        getModifiersId(id),
      ]);
      return [...resolverIds, ...sectionIds];
    }
    // Legacy mode: expand virtual sections
    return [getSetsId(), getModifiersId()].filter((id) =>
      treeData.some((section) => section.id === id),
    );
  });

  const handleDelete = () => {
    if (selectedItems.size === 0) {
      return;
    }
    // find the next focus target before deletion
    const currentNodeId = Array.from(selectedItems).at(0);
    let nextFocusId: string | undefined;
    if (currentNodeId) {
      const nextSelectedNode =
        treeState.getNextSibling(currentNodeId) ??
        treeState.getPrevSibling(currentNodeId) ??
        treeState.getParent(currentNodeId);
      if (nextSelectedNode) {
        nextFocusId = nextSelectedNode.nodeId;
      }
    }
    // delete selected nodes
    treeState.transact((tx) => {
      for (const nodeId of selectedItems) {
        tx.delete(nodeId);
      }
    });
    // move selection to the next focus target
    selectedItems.clear();
    if (nextFocusId) {
      selectedItems.add(nextFocusId);
    }
  };

  // Find the resolver node to add children to (based on selection or first resolver)
  const getTargetResolverId = (): string | undefined => {
    if (!hasResolvers) return undefined;

    // Check if selection is inside a resolver
    const firstSelectedId = Array.from(selectedItems)[0];
    if (firstSelectedId) {
      // Check if a virtual section is selected (e.g., "__sets__:resolverId")
      if (isVirtualSection(firstSelectedId)) {
        const parts = firstSelectedId.split(":");
        if (parts.length > 1) {
          return parts[1];
        }
      }

      // Walk up the tree to find resolver
      let current = treeState.getNode(firstSelectedId);
      while (current) {
        if (current.meta.nodeType === "resolver") {
          return current.nodeId;
        }
        current = current.parentId
          ? treeState.getNode(current.parentId)
          : undefined;
      }
    }

    // Fall back to first resolver
    const firstResolver = rootNodes.find((n) => n.meta.nodeType === "resolver");
    return firstResolver?.nodeId;
  };

  const handleAddSet = () => {
    // In resolver mode, sets go under the target resolver; in legacy mode, at root
    const parentId = getTargetResolverId();
    const parentChildren = treeState.getChildren(parentId);
    const lastChildIndex = parentChildren.at(-1)?.index ?? zeroIndex;
    const insertAfterIndex = generateKeyBetween(lastChildIndex, null);
    const newSet: TreeNode<TreeNodeMeta> = {
      nodeId: crypto.randomUUID(),
      parentId,
      index: insertAfterIndex,
      meta: {
        nodeType: "token-set",
        name: "New Set",
      },
    };
    treeState.transact((tx) => {
      tx.set(newSet);
    });
    selectedItems.clear();
    selectedItems.add(newSet.nodeId);
  };

  const handleAddModifier = () => {
    // In resolver mode, modifiers go under the target resolver; in legacy mode, at root
    const parentId = getTargetResolverId();
    const parentChildren = treeState.getChildren(parentId);
    const lastChildIndex = parentChildren.at(-1)?.index ?? zeroIndex;
    const insertAfterIndex = generateKeyBetween(lastChildIndex, null);
    const modifierNodeId = crypto.randomUUID();
    const newModifier: TreeNode<TreeNodeMeta> = {
      nodeId: modifierNodeId,
      parentId,
      index: insertAfterIndex,
      meta: {
        nodeType: "modifier",
        name: "New Modifier",
      },
    };
    // Create a default context as child
    const defaultContextId = crypto.randomUUID();
    const defaultContext: TreeNode<TreeNodeMeta> = {
      nodeId: defaultContextId,
      parentId: modifierNodeId,
      index: zeroIndex,
      meta: {
        nodeType: "modifier-context",
        name: "default",
      },
    };
    treeState.transact((tx) => {
      tx.set(newModifier);
      tx.set(defaultContext);
    });
    selectedItems.clear();
    selectedItems.add(modifierNodeId);
  };

  const handleAddContext = () => {
    const firstSelectedId = Array.from(selectedItems)[0];
    const firstSelectedNode = treeState.getNode(firstSelectedId);
    if (!firstSelectedNode) {
      return;
    }
    // Determine the modifier node to add context to
    let modifierNodeId: string | undefined;
    if (firstSelectedNode.meta.nodeType === "modifier") {
      modifierNodeId = firstSelectedId;
    } else if (firstSelectedNode.meta.nodeType === "modifier-context") {
      modifierNodeId = firstSelectedNode.parentId;
    }
    if (!modifierNodeId) {
      return;
    }
    // Add context at the end of the modifier's children
    const children = treeState.getChildren(modifierNodeId);
    const lastChildIndex = children.at(-1)?.index ?? zeroIndex;
    const insertAfterIndex = generateKeyBetween(lastChildIndex, null);
    const newContext: TreeNode<TreeNodeMeta> = {
      nodeId: crypto.randomUUID(),
      parentId: modifierNodeId,
      index: insertAfterIndex,
      meta: {
        nodeType: "modifier-context",
        name: "New Context",
      },
    };
    treeState.transact((tx) => {
      tx.set(newContext);
    });
    selectedItems.clear();
    selectedItems.add(newContext.nodeId);
  };

  const handleAddGroup = () => {
    const firstSelectedId = Array.from(selectedItems)[0];
    const firstSelectedNode = treeState.getNode(firstSelectedId);
    if (!firstSelectedNode) {
      return;
    }
    // determine parent and index for new group
    let parentId: string | undefined;
    let insertAfterIndex: string;
    if (
      firstSelectedNode.meta.nodeType === "token-set" ||
      firstSelectedNode.meta.nodeType === "token-group" ||
      firstSelectedNode.meta.nodeType === "modifier-context"
    ) {
      parentId = firstSelectedId;
      // add at the end of the group
      const children = treeState.getChildren(firstSelectedId);
      const lastChildIndex = children.at(-1)?.index ?? zeroIndex;
      insertAfterIndex = generateKeyBetween(lastChildIndex, null);
    } else if (
      firstSelectedNode.meta.nodeType === "modifier" ||
      firstSelectedNode.meta.nodeType === "resolver"
    ) {
      // Cannot add group directly to modifier or resolver
      return;
    } else {
      // add after the token
      parentId = firstSelectedNode.parentId;
      insertAfterIndex = generateKeyBetween(firstSelectedNode.index, null);
    }
    const newGroup: TreeNode<TreeNodeMeta> = {
      nodeId: crypto.randomUUID(),
      parentId,
      index: insertAfterIndex,
      meta: {
        nodeType: "token-group",
        name: "New Group",
      },
    };
    treeState.transact((tx) => {
      tx.set(newGroup);
    });
    selectedItems.clear();
    selectedItems.add(newGroup.nodeId);
  };

  const handleTokenAdded = (tokenNodeId: string) => {
    // select and open editor for the new token
    selectedItems.clear();
    selectedItems.add(tokenNodeId);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    if (
      event.target.closest("input, textarea, [contenteditable], color-input")
    ) {
      return;
    }
    const closestTree = event.target.closest("[role=tree]");
    if (event.key === "Enter" && closestTree) {
      document.getElementById("app-node-editor")?.showPopover();
    }
    if (event.key === "Backspace" && closestTree) {
      handleDelete();
    }
  };

  const handleMove = (
    itemIds: string[],
    newParentId: undefined | string,
    position: number,
  ) => {
    // Virtual sections map to their parent resolver (or undefined in legacy mode)
    // Format: "__sets__" (legacy) or "__sets__:resolverId" (resolver mode)
    let actualParentId: string | undefined;
    const isSetsSection = newParentId?.startsWith(SETS_SECTION_PREFIX);
    const isModifiersSection = newParentId?.startsWith(
      MODIFIERS_SECTION_PREFIX,
    );

    if (isSetsSection || isModifiersSection) {
      // Extract resolver ID from section ID if present (e.g., "__sets__:abc123" -> "abc123")
      const parts = newParentId?.split(":") ?? [];
      actualParentId = parts.length > 1 ? parts[1] : undefined;
    } else {
      actualParentId = newParentId;
    }

    const newParentNode = actualParentId
      ? treeState.getNode(actualParentId)
      : undefined;

    // Validate move constraints
    for (const itemId of itemIds) {
      const node = treeState.getNode(itemId);
      if (!node) continue;

      // Token-sets can be dropped into Sets section or resolver nodes
      if (node.meta.nodeType === "token-set") {
        if (!isSetsSection && newParentNode?.meta.nodeType !== "resolver") {
          return;
        }
      }

      // Modifiers can be dropped into Modifiers section or resolver nodes
      if (node.meta.nodeType === "modifier") {
        if (
          !isModifiersSection &&
          newParentNode?.meta.nodeType !== "resolver"
        ) {
          return;
        }
      }

      // Modifier-contexts can only be inside modifiers
      if (node.meta.nodeType === "modifier-context") {
        if (newParentNode?.meta.nodeType !== "modifier") {
          return;
        }
      }

      // Groups and tokens cannot be moved directly into modifiers or resolvers
      if (
        (node.meta.nodeType === "token-group" ||
          node.meta.nodeType === "token") &&
        (newParentNode?.meta.nodeType === "modifier" ||
          newParentNode?.meta.nodeType === "resolver")
      ) {
        return;
      }
    }

    // get the children of the actual parent to calculate the new index
    const newParentChildren = treeState.getChildren(actualParentId);
    const prevIndex = newParentChildren[position - 1]?.index ?? zeroIndex;
    const nextIndex = newParentChildren[position]?.index ?? null;
    treeState.transact((tx) => {
      // move each item to the actual parent (undefined for legacy virtual sections)
      for (const itemId of itemIds) {
        const node = treeState.getNode(itemId);
        if (node) {
          tx.set({
            ...node,
            parentId: actualParentId,
            index: generateKeyBetween(prevIndex, nextIndex),
          });
        }
      }
    });
  };

  /**
   * polyfill for anchor positioning in popovers
   * detects toggle source (which is also poorly supported) with click handler
   * and uses floating-ui to position elements
   */
  let cleanupPositioningAutoUpdate: undefined | (() => void);
  const handleDocumentClick = (event: MouseEvent) => {
    // ignore if anchor-positioning is already supported
    if ("anchorName" in document.documentElement.style) {
      return;
    }
    const button = (event.target as HTMLElement).closest(
      "button[commandfor]",
    ) as null | HTMLButtonElement;
    if (button?.commandForElement) {
      const target = button.commandForElement;
      // ignore dialogs
      if (target instanceof HTMLDialogElement) {
        return;
      }
      // closed state is not always triggers beforetoggle
      cleanupPositioningAutoUpdate?.();
      const updatePosition = () => {
        computePosition(button, target, {
          middleware: [
            offset(8),
            shift({ padding: 12 }),
            autoPlacement({ allowedPlacements: ["top", "bottom"] }),
          ],
        }).then(({ x, y }) => {
          target.style.setProperty("margin", "0px");
          target.style.setProperty("left", `${x}px`);
          target.style.setProperty("top", `${y}px`);
        });
      };
      cleanupPositioningAutoUpdate = autoUpdate(button, target, updatePosition);
    }
  };

  const handleDocumentMouseOver = (event: MouseEvent) => {
    // ignore if anchor-positioning is already supported
    if ("anchorName" in document.documentElement.style) {
      return;
    }
    const button = (event.target as HTMLElement).closest(
      "button[interestfor]",
    ) as null | HTMLButtonElement;
    const interestFor = button?.getAttribute("interestfor");
    const target = interestFor
      ? document.getElementById(interestFor)
      : undefined;
    if (button && target) {
      // closed state is not always triggers beforetoggle
      cleanupPositioningAutoUpdate?.();
      const updatePosition = () => {
        computePosition(button, target, {
          middleware: [
            offset(8),
            shift({ padding: 12 }),
            autoPlacement({ allowedPlacements: ["top", "bottom"] }),
          ],
        }).then(({ x, y }) => {
          target.style.setProperty("margin", "0px");
          target.style.setProperty("left", `${x}px`);
          target.style.setProperty("top", `${y}px`);
        });
      };
      cleanupPositioningAutoUpdate = autoUpdate(button, target, updatePosition);
    }
  };
</script>

<svelte:document
  onclickcapture={handleDocumentClick}
  onmouseovercapture={handleDocumentMouseOver}
  onkeydown={handleKeyDown}
/>

<div class="app">
  <div class="horizontal-container">
    <!-- Left Panel: Design Tokens -->
    <aside class="panel left-panel">
      <div class="panel-header">
        <AppMenu />
        <h1 class="a-panel-title">Engramma</h1>
        <div class="toolbar-actions">
          {#if selectedItems.size > 0}
            <button
              class="a-button"
              aria-label={`Delete ${selectedItems.size} item(s)`}
              interestfor="app-delete-tooltip"
              onclick={handleDelete}
            >
              <Trash2 size={16} />
            </button>
            <div id="app-delete-tooltip" popover="hint" class="a-tooltip">
              Delete selected items
            </div>
          {/if}
          <button
            class="a-button"
            aria-label="Add set"
            interestfor="app-add-set-tooltip"
            onclick={handleAddSet}
          >
            <ListPlus size={16} />
          </button>
          <div id="app-add-set-tooltip" popover="hint" class="a-tooltip">
            Add a new token set
          </div>
          <button
            class="a-button"
            aria-label="Add modifier"
            interestfor="app-add-modifier-tooltip"
            onclick={handleAddModifier}
          >
            <ToggleLeft size={16} />
          </button>
          <div id="app-add-modifier-tooltip" popover="hint" class="a-tooltip">
            Add a new modifier
          </div>
          {#if Array.from(selectedItems).some((id) => {
            const n = treeState.getNode(id);
            return n?.meta.nodeType === "modifier" || n?.meta.nodeType === "modifier-context";
          })}
            <button
              class="a-button"
              aria-label="Add context"
              interestfor="app-add-context-tooltip"
              onclick={handleAddContext}
            >
              <Layers size={16} />
            </button>
            <div id="app-add-context-tooltip" popover="hint" class="a-tooltip">
              Add a new context
            </div>
          {/if}
          <button
            class="a-button"
            aria-label="Add group"
            interestfor="app-add-group-tooltip"
            onclick={handleAddGroup}
          >
            <Folder size={16} />
          </button>
          <div id="app-add-group-tooltip" popover="hint" class="a-tooltip">
            Add a new group
          </div>
          <AddToken {selectedItems} onTokenAdded={handleTokenAdded} />
        </div>
      </div>

      {#snippet renderTypeIcon(type: Value["type"])}
        {#if type === "color"}
          <div
            class="token-preview"
            style="background: var(--text-secondary);"
          ></div>
        {:else if type === "dimension"}
          <Ruler size={16} />
        {:else if type === "duration"}
          <Clock size={16} />
        {:else if type === "number"}
          <Hash size={16} />
        {:else if type === "fontFamily"}
          <CaseUpper size={16} />
        {:else if type === "fontWeight"}
          <Bold size={16} />
        {:else if type === "cubicBezier"}
          <Tangent size={16} />
        {:else if type === "transition"}
          <ArrowRightLeft size={16} />
        {:else if type === "typography"}
          <Type size={16} />
        {:else if type === "strokeStyle"}
          <LineSquiggle size={16} />
        {:else if type === "shadow"}
          <Tags size={16} />
        {:else if type === "border"}
          <Square size={16} />
        {:else if type === "gradient"}
          <Paintbrush size={16} />
        {/if}
      {/snippet}

      {#snippet treeItemEditorButton(nodeId: string)}
        <button
          class="a-small-button edit-button"
          aria-label="Edit"
          onclick={() => {
            selectedItems.clear();
            selectedItems.add(nodeId);
            /* safari closes dialog whenever cursor is out of button */
            document.getElementById("app-node-editor")?.showPopover();
          }}
        >
          <Settings size={16} />
        </button>
      {/snippet}

      {#snippet renderTreeItem(item: TreeItem)}
        {@const node = treeState.getNode(item.id)}

        {#if item.id.startsWith(SETS_SECTION_PREFIX)}
          <div class="token">
            <div class="token-icon">
              <ListPlus size={16} />
            </div>
            <span class="token-section-name">{item.name}</span>
          </div>
        {:else if item.id.startsWith(MODIFIERS_SECTION_PREFIX)}
          <div class="token">
            <div class="token-icon">
              <ToggleLeft size={16} />
            </div>
            <span class="token-section-name">{item.name}</span>
          </div>
        {:else if node?.meta.nodeType === "resolver"}
          <div class="token">
            <div class="token-icon">
              <FileJson size={16} />
            </div>
            <span class="token-resolver-name">{item.name}</span>
            {@render treeItemEditorButton(item.id)}
          </div>
        {:else if node?.meta.nodeType === "token-set"}
          <div class="token">
            <div class="token-icon">
              <ListPlus size={16} />
            </div>
            <span class="token-set-name">{item.name}</span>
            {@render treeItemEditorButton(item.id)}
          </div>
        {:else if node?.meta.nodeType === "modifier"}
          <div class="token">
            <div class="token-icon">
              <ToggleLeft size={16} />
            </div>
            <span class="token-set-name">{item.name}</span>
            {@render treeItemEditorButton(item.id)}
          </div>
        {:else if node?.meta.nodeType === "modifier-context"}
          <div class="token">
            <div class="token-icon">
              <Layers size={16} />
            </div>
            <span class="token-name">{item.name}</span>
            {@render treeItemEditorButton(item.id)}
          </div>
        {:else if node?.meta.nodeType === "token-group"}
          {@const type = findTokenType(node, allNodes)}
          <div class="token">
            <div class="token-icon">
              {#if type}
                {@render renderTypeIcon(type)}
              {:else}
                <Folder size={16} />
              {/if}
            </div>
            <span class="token-name">{item.name}</span>
            {@render treeItemEditorButton(item.id)}
          </div>
        {:else if node?.meta.nodeType === "token"}
          {@const tokenValue = resolveTokenValue(node, allNodes)}
          <div class="token">
            {#if tokenValue.type === "color"}
              <div
                class="token-preview"
                style="background: {serializeColor(tokenValue.value)};"
              ></div>
            {:else}
              <div class="token-icon">
                {@render renderTypeIcon(tokenValue.type)}
              </div>
            {/if}
            <span class="token-name">{item.name}</span>
            {@render treeItemEditorButton(item.id)}
          </div>
        {/if}
      {/snippet}

      <div class="tokens-container">
        <TreeView
          id="tokens-tree"
          label="Design Tokens"
          data={treeData}
          {selectedItems}
          {defaultExpandedItems}
          renderItem={renderTreeItem}
          canAcceptChildren={(targetId, items) => {
            // Virtual sections: Sets section accepts only token-sets
            if (targetId?.startsWith(SETS_SECTION_PREFIX)) {
              return items.every(
                (itemId) =>
                  treeState.getNode(itemId)?.meta.nodeType === "token-set",
              );
            }
            // Virtual sections: Modifiers section accepts only modifiers
            if (targetId?.startsWith(MODIFIERS_SECTION_PREFIX)) {
              return items.every(
                (itemId) =>
                  treeState.getNode(itemId)?.meta.nodeType === "modifier",
              );
            }
            // Root level is not directly accessible anymore (use sections or resolvers)
            if (!targetId) {
              return false;
            }
            const target = targetId ? treeState.getNode(targetId) : undefined;
            // resolver nodes accept only token-sets and modifiers
            if (target?.meta.nodeType === "resolver") {
              return items.every((itemId) => {
                const node = treeState.getNode(itemId);
                return (
                  node?.meta.nodeType === "token-set" ||
                  node?.meta.nodeType === "modifier"
                );
              });
            }
            // modifiers accept only modifier-context nodes
            if (target?.meta.nodeType === "modifier") {
              return items.every(
                (itemId) =>
                  treeState.getNode(itemId)?.meta.nodeType ===
                  "modifier-context",
              );
            }
            // modifier-contexts accept groups and tokens (like sets)
            if (target?.meta.nodeType === "modifier-context") {
              return items.every((itemId) => {
                const node = treeState.getNode(itemId);
                return (
                  node?.meta.nodeType === "token-group" ||
                  node?.meta.nodeType === "token"
                );
              });
            }
            // groups and sets accept only other groups and tokens
            if (
              target?.meta.nodeType === "token-set" ||
              target?.meta.nodeType === "token-group"
            ) {
              return items.every((itemId) => {
                const node = treeState.getNode(itemId);
                return (
                  node?.meta.nodeType === "token-group" ||
                  node?.meta.nodeType === "token"
                );
              });
            }
            // tokens do not accept anything
            return false;
          }}
          onMove={handleMove}
        />
      </div>
    </aside>

    <Editor id="app-node-editor" {selectedItems} />

    <!-- Right Panel: CSS Variables / JSON -->
    <main class="panel right-panel">
      <div class="panel-header">
        <div class="search-container">
          <svg class="search-icon" viewBox="0 0 20 20" fill="currentColor">
            <path
              fill-rule="evenodd"
              d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
              clip-rule="evenodd"
            />
          </svg>
          <input
            type="text"
            class="search-input"
            placeholder="Search tokens..."
            bind:value={searchQuery}
          />
          {#if searchQuery}
            <button
              type="button"
              class="search-clear"
              onclick={() => (searchQuery = "")}
              aria-label="Clear search"
            >
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path
                  fill-rule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>
          {/if}
        </div>
      </div>
      <div class="styleguide-panel">
        <Styleguide {selectedItems} {searchQuery} />
      </div>
    </main>
  </div>
</div>

<style>
  .app {
    container-type: inline-size;
    width: 100%;
    height: 100%;
    display: grid;
  }

  .horizontal-container {
    display: grid;
    grid-template-columns: clamp(320px, 30%, 360px) 1fr;
    grid-template-rows: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x mandatory;

    @container (width <= 720px) {
      grid-template-columns: 100cqw 100cqw;
    }
  }

  /* Panels */
  .panel {
    display: grid;
    grid-template-rows: var(--panel-header-height) 1fr;
    background: var(--bg-primary);
    scroll-snap-align: center;
  }

  .left-panel {
    border-right: 1px solid var(--border-color);
  }

  .panel-header {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    padding: 0 8px;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
    background: var(--bg-primary);
    gap: 8px;
    overflow: hidden;
  }

  .toolbar-actions {
    display: flex;
    align-items: center;
    margin-left: auto;
  }

  .tokens-container {
    overflow: auto;
  }

  /* Tree structure */
  .token {
    display: flex;
    align-items: center;
    gap: 8px;
    transition: all 0.2s ease;
  }

  .token-preview {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    border: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .token-icon {
    flex-shrink: 0;
    opacity: 0.6;
    display: flex;
    align-items: center;
  }

  .token-name {
    font-size: 14px;
    font-weight: 400;
    color: var(--text-primary);
  }

  .token-set-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .token-resolver-name {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .token-section-name {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
  }

  .edit-button {
    pointer-events: auto;
    visibility: var(--tree-view-item-visibility);
  }

  .styleguide-panel {
    overflow: hidden;
  }

  .search-container {
    position: relative;
    flex: 1;
    max-width: 400px;
  }

  .search-icon {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    width: 14px;
    height: 14px;
    color: var(--text-secondary);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    padding: 6px 32px 6px 32px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    font-size: 13px;
    background: var(--bg-primary);
    color: var(--text-primary);
    transition:
      border-color 0.15s,
      box-shadow 0.15s;

    &::placeholder {
      color: var(--text-secondary);
    }

    &:focus {
      outline: none;
      border-color: var(--accent-color);
      box-shadow: 0 0 0 2px
        color-mix(in srgb, var(--accent-color) 20%, transparent);
    }
  }

  .search-clear {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    width: 22px;
    height: 22px;
    padding: 4px;
    border: none;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      color 0.15s,
      background-color 0.15s;

    &:hover {
      color: var(--text-primary);
      background-color: var(--bg-secondary);
    }

    & svg {
      width: 100%;
      height: 100%;
    }
  }
</style>
