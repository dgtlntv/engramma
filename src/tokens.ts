import { generateKeyBetween } from "fractional-indexing";
import type { TreeNode } from "./store";
import type { GroupMeta, TokenMeta } from "./state.svelte";
import { ValueSchema } from "./schema";

type TreeNodeMeta = GroupMeta | TokenMeta;

export type ParseResult = {
  nodes: TreeNode<TreeNodeMeta>[];
  errors: Array<{ path: string; message: string }>;
};

const zeroIndex = generateKeyBetween(null, null);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isTokenObject = (v: unknown): v is Record<string, unknown> =>
  isObject(v) && "$value" in v;

const isValidGroupName = (name: string) => {
  if (name.startsWith("$")) {
    return false;
  }
  return !/[{}.]/.test(name);
};

const isValidTokenName = (name: string) => {
  // $root is reserved
  if (name === "$root") {
    return true;
  }
  return isValidGroupName(name);
};

const getMeta = (data: Record<string, unknown>) => {
  const type = typeof data.$type === "string" ? data.$type : undefined;
  const description =
    typeof data.$description === "string" ? data.$description : undefined;
  const deprecated =
    typeof data.$deprecated === "string" ||
    typeof data.$deprecated === "boolean"
      ? data.$deprecated
      : undefined;
  const extensions = isObject(data.$extensions) ? data.$extensions : undefined;
  return { type, description, deprecated, extensions };
};

export function parseDesignTokens(input: unknown): ParseResult {
  const nodes: TreeNode<TreeNodeMeta>[] = [];
  const collectedErrors: Array<{ path: string; message: string }> = [];
  const lastChildIndexPerParent = new Map<string | undefined, string>();

  if (!isObject(input)) {
    return { nodes, errors: collectedErrors };
  }

  const addNode = (parentId: string | undefined, meta: TreeNodeMeta) => {
    const nodeId = crypto.randomUUID();
    const prevIndex = lastChildIndexPerParent.get(parentId);
    const index = generateKeyBetween(prevIndex ?? zeroIndex, null);
    lastChildIndexPerParent.set(parentId, index);
    nodes.push({ nodeId, parentId, index, meta });
    return nodeId;
  };

  const recordError = (path: string, message: string) => {
    collectedErrors.push({ path, message });
  };

  const parseGroup = (
    name: string,
    data: Record<string, unknown>,
    parentPath: string[] | undefined,
    parentNodeId: string | undefined,
  ) => {
    const path = parentPath ? [...parentPath, name] : [name];
    const serializedPath = path.join(".");
    if (!isValidGroupName(name)) {
      recordError(serializedPath, `Invalid group name "${name}"`);
      return;
    }
    const groupMeta: GroupMeta = {
      nodeType: "token-group",
      name,
      ...getMeta(data),
    };
    const nodeId = addNode(parentNodeId, groupMeta);
    for (const childName of Object.keys(data)) {
      // include $root as a token, skip other $-props (group meta)
      if (childName.startsWith("$") && childName !== "$root") {
        continue;
      }
      const child = data[childName];
      if (isTokenObject(child)) {
        parseToken(childName, child, path, nodeId, groupMeta.type);
      } else if (isObject(child)) {
        parseGroup(childName, child, path, nodeId);
      }
    }
  };

  const parseToken = (
    name: string,
    obj: Record<string, unknown>,
    parentPath: string[],
    parentNodeId: string | undefined,
    inheritedType?: string,
  ) => {
    const path = [...parentPath, name];
    const serializedPath = path.join(".");
    if (!isValidTokenName(name)) {
      recordError(serializedPath, `Invalid token name "${name}"`);
      return;
    }
    // Token meta
    const {
      description,
      type = inheritedType,
      deprecated,
      extensions,
    } = getMeta(obj);
    if (!type) {
      recordError(serializedPath, "Token type cannot be determined");
      return;
    }
    const value = (obj as any).$value;
    const parsed = ValueSchema.safeParse({
      type,
      value,
    });
    if (!parsed.success) {
      const errorMessages = parsed.error.issues
        .map((issue) => issue.message)
        .join(", ");
      recordError(serializedPath, `Invalid ${type}: ${errorMessages}`);
      return;
    }
    addNode(parentNodeId, {
      nodeType: "token",
      name,
      description,
      deprecated,
      extensions,
      ...parsed.data,
    });
  };

  for (const name of Object.keys(input)) {
    const child = input[name];
    if (isTokenObject(child)) {
      parseToken(name, child, [], undefined, undefined);
    } else if (isObject(child)) {
      parseGroup(name, child, undefined, undefined);
    }
  }

  return {
    nodes,
    errors: collectedErrors,
  };
}
