export interface Transaction<Meta> {
  set: (node: TreeNode<Meta>) => void;
  delete: (nodeId: string) => void;
  clear: () => void;
}

export interface TreeNode<Meta> {
  nodeId: string;
  parentId: string | undefined;
  index: string;
  meta: Meta;
}

export const compareTreeNodes = <Meta>(
  a: TreeNode<Meta>,
  b: TreeNode<Meta>,
) => {
  if (a.index < b.index) {
    return -1;
  }
  if (a.index > b.index) {
    return 1;
  }
  return 0;
};

export class TreeStore<Meta> {
  #nodes = new Map<string, TreeNode<Meta>>();
  #childrenByParent = new Map<string | undefined, Set<string>>();
  #childrenCache = new Map<string | undefined, TreeNode<Meta>[]>();
  #subscribers = new Set<() => void>();

  transact(callback: (tx: Transaction<Meta>) => void): void {
    callback({
      set: (node) => {
        const existing = this.#nodes.get(node.nodeId);
        // Update children index if parent changed or node is new
        if (existing && existing.parentId !== node.parentId) {
          // Remove from old parent's children
          this.#childrenByParent.get(existing.parentId)?.delete(node.nodeId);
          this.#childrenCache.delete(existing.parentId);
        }
        // Add to new parent's children
        let parentChildren = this.#childrenByParent.get(node.parentId);
        if (!parentChildren) {
          parentChildren = new Set();
          this.#childrenByParent.set(node.parentId, parentChildren);
        }
        parentChildren.add(node.nodeId);
        // Invalidate cache for affected parent
        this.#childrenCache.delete(node.parentId);
        this.#nodes.set(node.nodeId, node);
      },
      delete: (nodeId): void => {
        const node = this.#nodes.get(nodeId);
        if (node) {
          // Remove from parent's children index
          this.#childrenByParent.get(node.parentId)?.delete(nodeId);
          this.#childrenCache.delete(node.parentId);
        }
        this.#nodes.delete(nodeId);
      },
      clear: (): void => {
        this.#nodes.clear();
        this.#childrenByParent.clear();
        this.#childrenCache.clear();
      },
    });
    this.#notify();
  }

  values(): TreeNode<Meta>[] {
    return Array.from(this.#nodes.values());
  }

  nodes(): Map<string, TreeNode<Meta>> {
    // Return internal map directly - callers should not mutate
    return this.#nodes;
  }

  getChildren(nodeId: string | undefined): TreeNode<Meta>[] {
    // Check cache first
    const cached = this.#childrenCache.get(nodeId);
    if (cached) {
      return cached;
    }
    // Compute and cache
    const childIds = this.#childrenByParent.get(nodeId);
    if (!childIds || childIds.size === 0) {
      const empty: TreeNode<Meta>[] = [];
      this.#childrenCache.set(nodeId, empty);
      return empty;
    }
    const children: TreeNode<Meta>[] = [];
    for (const childId of childIds) {
      const child = this.#nodes.get(childId);
      if (child) {
        children.push(child);
      }
    }
    children.sort(compareTreeNodes);
    this.#childrenCache.set(nodeId, children);
    return children;
  }

  getParent(nodeId: string): TreeNode<Meta> | undefined {
    const node = this.#nodes.get(nodeId);
    if (!node?.parentId) {
      return;
    }
    return this.#nodes.get(node.parentId);
  }

  getPrevSibling(nodeId: string): TreeNode<Meta> | undefined {
    const node = this.#nodes.get(nodeId);
    if (!node) {
      return;
    }
    const siblings = this.getChildren(node.parentId);
    const index = siblings.findIndex((n) => n.nodeId === nodeId);
    if (index > 0) {
      return siblings[index - 1];
    }
  }

  getNextSibling(nodeId: string): TreeNode<Meta> | undefined {
    const node = this.#nodes.get(nodeId);
    if (!node) {
      return;
    }
    const siblings = this.getChildren(node.parentId);
    const index = siblings.findIndex((n) => n.nodeId === nodeId);
    if (index >= 0 && index < siblings.length - 1) {
      return siblings[index + 1];
    }
  }

  subscribe(callback: () => void): () => void {
    this.#subscribers.add(callback);
    return () => {
      this.#subscribers.delete(callback);
    };
  }

  #notify(): void {
    this.#subscribers.forEach((callback) => callback());
  }
}
