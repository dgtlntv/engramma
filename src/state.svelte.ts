import { createSubscriber } from "svelte/reactivity";
import { TreeStore, type Transaction, type TreeNode } from "./store";

export type GroupMeta = {
  nodeType: "token-group";
  name: string;
  path: string;
  type?: string;
  description?: string;
  deprecated?: boolean | string;
  extensions?: Record<string, unknown>;
  extends?: string; // e.g. "{button}"
};

export type TokenMeta = {
  nodeType: "token";
  name: string;
  path: string;
  type?: string;
  description?: string;
  deprecated?: boolean | string;
  extensions?: Record<string, unknown>;
  value?: unknown; // original $value, untouched
  alias?: string | null; // "{group.token}"
  ref?: string | null; // "#/pointer"
};

export class TreeState<Meta> {
  #store = new TreeStore<Meta>();
  #subscribe = createSubscriber((update) => this.#store.subscribe(update));

  transact(callback: (tx: Transaction<Meta>) => void): void {
    this.#store.transact(callback);
  }

  values(): TreeNode<Meta>[] {
    this.#subscribe();
    return this.#store.values();
  }

  getChildren(nodeId: string | undefined): TreeNode<Meta>[] {
    this.#subscribe();
    return this.#store.getChildren(nodeId);
  }
}

export const treeState = new TreeState<GroupMeta | TokenMeta>();
