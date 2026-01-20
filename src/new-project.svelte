<script lang="ts">
  import { generateKeyBetween } from "fractional-indexing";
  import { treeState, type SetMeta, type TreeNodeMeta } from "./state.svelte";
  import {
    extractIntermediaryNodes,
    resolveIntermediaryNodes,
    type IntermediaryNode,
  } from "./tokens";
  import {
    parseTokenResolver,
    isResolverFormat,
    resolveResolverRefs,
  } from "./resolver";
  import { parseCssVariables } from "./css-variables";
  import type { TreeNode } from "./store";
  import type { ResolverDocument } from "./dtcg.schema";

  type ImportSource = { name: string; content: string };

  type ImportType = "unknown" | "json" | "css" | "resolver";

  type ImportResult = {
    importType: ImportType;
    name: string;
    nodes: TreeNode<TreeNodeMeta>[];
    errors: { path: string; message: string }[];
  };

  let dialogElement: undefined | HTMLDialogElement;
  let fileInputElement: undefined | HTMLInputElement = $state();
  let dropzoneElement: undefined | HTMLElement = $state();
  let inputMode: "upload" | "text" = $state("upload");
  let isDragOver = $state(false);
  let isInputTouched = $state(false);
  let importResults: ImportResult[] = $state([]);
  let content = $state("");

  const convertImportSources = async (sources: ImportSource[]) => {
    const results: ImportResult[] = [];
    const resolvers: { name: string; content: ResolverDocument }[] = [];
    const tokenSets: {
      name: string;
      nodes: Map<string, IntermediaryNode>;
      errors: { path: string; message: string }[];
    }[] = [];
    const availableIntermediaryNodes = new Map<string, IntermediaryNode>();

    // Build a map of all uploaded files for resolving $refs
    const uploadedFiles = new Map<string, Record<string, unknown>>();
    for (const { name, content } of sources) {
      try {
        const parsed = JSON.parse(content);
        uploadedFiles.set(name, parsed);
      } catch {
        // Not JSON, skip for file lookup
      }
    }

    // File loader that looks up files from uploaded files
    const fileLoader = (path: string): Record<string, unknown> => {
      // Try exact match first
      let content = uploadedFiles.get(path);
      if (content) return content;

      // Try matching by filename (for when $ref is relative path but upload is just filename)
      const filename = path.split("/").pop();
      for (const [name, fileContent] of uploadedFiles) {
        if (
          name === filename ||
          name.endsWith(`/${path}`) ||
          path.endsWith(`/${name}`)
        ) {
          return fileContent;
        }
      }

      throw new Error(`Referenced file not found: ${path}`);
    };

    // Collect resolvers and separate sets of tokens
    for (const { name, content } of sources) {
      try {
        const parsed = JSON.parse(content);
        // start with resolver format
        if (isResolverFormat(parsed)) {
          resolvers.push({ name, content: parsed as ResolverDocument });
        } else {
          // fallback to tokens format
          const result = extractIntermediaryNodes(parsed);
          tokenSets.push({ name, ...result });
          for (const [key, node] of result.nodes) {
            availableIntermediaryNodes.set(key, node);
          }
        }
      } catch {
        // when input is not json fallback to css
        const result = extractIntermediaryNodes(parseCssVariables(content));
        tokenSets.push({ name, ...result });
        for (const [key, node] of result.nodes) {
          availableIntermediaryNodes.set(key, node);
        }
      }
    }

    let lastIndex: null | string = null;

    // Process resolvers - resolve $refs and parse
    for (const { name, content: resolverDoc } of resolvers) {
      try {
        const resolved = await resolveResolverRefs(resolverDoc, { fileLoader });
        const result = await parseTokenResolver(resolved);

        for (const node of result.nodes) {
          if (node.meta.nodeType === "token-set") {
            const currentIndex = generateKeyBetween(lastIndex, null);
            lastIndex = currentIndex;
            node.index = currentIndex;
          }
        }
        results.push({
          importType: "resolver",
          name,
          nodes: result.nodes,
          errors: result.errors,
        });
      } catch (err) {
        results.push({
          importType: "resolver",
          name,
          nodes: [],
          errors: [
            {
              path: name,
              message: err instanceof Error ? err.message : String(err),
            },
          ],
        });
      }
    }

    // merge token sets
    for (const { name, nodes: intermediaryNodes, errors } of tokenSets) {
      const nodes: TreeNode<TreeNodeMeta>[] = [];
      const result = resolveIntermediaryNodes(
        intermediaryNodes,
        availableIntermediaryNodes,
      );
      errors.push(...result.errors);
      const currentIndex = generateKeyBetween(lastIndex, null);
      lastIndex = currentIndex;
      const tokenSetNode: TreeNode<SetMeta> = {
        nodeId: crypto.randomUUID(),
        parentId: undefined,
        index: currentIndex,
        meta: { nodeType: "token-set", name },
      };
      nodes.push(tokenSetNode);
      for (const node of result.nodes) {
        if (node.parentId === undefined) {
          node.parentId = tokenSetNode.nodeId;
        }
        nodes.push(node);
      }
      results.push({
        importType: "json",
        name,
        nodes,
        errors,
      });
    }
    return results;
  };

  const handleTextareaInput = async (newValue: string) => {
    content = newValue;
    importResults = await convertImportSources([
      { name: "Base", content: newValue },
    ]);
    isInputTouched = false;
  };

  const handleMultipleFiles = async (files: FileList) => {
    const sources: ImportSource[] = [];
    // FileList is not iterated over for some reason
    for (const file of Array.from(files)) {
      let name = file.name
        // strip extensions
        .replace(/\.tokens\.json$/, "")
        .replace(/\.resolver\.json$/, "")
        .replace(/\.json$/, "")
        .replace(/\.css$/, "")
        .replace(/[^a-zA-Z0-9-_]/g, "-");
      const content = await file.text();
      sources.push({ name, content });
    }
    importResults = await convertImportSources(sources);
    isInputTouched = true;
  };

  const handleImport = async () => {
    isInputTouched = true;
    // Check if any source has errors
    if (importResults.some((s) => s.errors.length > 0)) {
      return;
    }
    treeState.transact((tx) => {
      tx.clear();
      for (const { nodes } of importResults) {
        for (const node of nodes) {
          tx.set(node);
        }
      }
    });
    dialogElement?.close();
  };

  const resetForm = () => {
    content = "";
    importResults = [];
    isDragOver = false;
    inputMode = "upload";
  };

  const errorGroups = $derived(
    importResults
      .map((source) => ({
        name: source.name,
        errors: source.errors,
      }))
      .filter((item) => item.errors.length > 0),
  );

  const getFormatDisplay = () => {
    if (importResults.length === 0) return "Unknown";

    if (importResults.length === 1) {
      const type = importResults[0].importType;
      if (type === "json") return "JSON (DTCG)";
      if (type === "css") return "CSS Variables";
      if (type === "resolver") return "JSON (Resolver 2025.10)";
      return "Unknown";
    }

    return `${importResults.length} file(s) selected`;
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    isDragOver = false;

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      handleMultipleFiles(files);
    }
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDragEnter = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    isDragOver = true;
  };

  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    // Only set to false if we're leaving the dropzone element entirely
    if (event.target === dropzoneElement) {
      isDragOver = false;
    }
  };

  const handleFileInputChange = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (files && files.length > 0) {
      handleMultipleFiles(files);
      // Reset input so same file can be selected again
      input.value = "";
    }
  };
</script>

<dialog
  bind:this={dialogElement}
  id="new-project-dialog"
  closedby="any"
  ontoggle={resetForm}
>
  <h2>New Project</h2>

  <p>
    <button
      class="a-link"
      role="tab"
      aria-selected={inputMode === "upload"}
      aria-controls="new-project-upload-panel"
      onclick={() => (inputMode = "upload")}
    >
      Upload file
    </button>
    or
    <button
      class="a-link"
      role="tab"
      aria-selected={inputMode === "text"}
      aria-controls="new-project-text-panel"
      onclick={() => (inputMode = "text")}
    >
      paste as text
    </button>
    with JSON (DTCG, Resolver 2025.10) or CSS custom properties
  </p>

  <p>
    Format: <span>{getFormatDisplay()}</span>
  </p>

  {#if isInputTouched && errorGroups.length > 0}
    {#each errorGroups as group}
      <p class="error-message">
        {#if group.name}
          <strong>{group.name}</strong>
        {/if}
        {#each group.errors as error, index}
          {#if index > 0 || group.name}
            <br />
          {/if}
          {error.message} at ${error.path}
        {/each}
      </p>
    {/each}
  {/if}

  <div class="control-container">
    {#if inputMode === "upload"}
      <label
        bind:this={dropzoneElement}
        for="new-project-file"
        id="new-project-upload-panel"
        class="dropzone"
        role="region"
        aria-label="File dropzone"
        data-drag-over={isDragOver}
        ondrop={handleDrop}
        ondragover={handleDragOver}
        ondragenter={handleDragEnter}
        ondragleave={handleDragLeave}
      >
        <div>
          <p class="dropzone-text">Upload your tokens file here</p>
          <p class="dropzone-subtext">Supports .json and .css files</p>
        </div>
      </label>
      <input
        bind:this={fileInputElement}
        id="new-project-file"
        class="file-input"
        aria-label="Select tokens file"
        type="file"
        accept=".json,.css"
        multiple
        onchange={handleFileInputChange}
      />
    {/if}
    {#if inputMode === "text"}
      <textarea
        id="new-project-text-panel"
        class="a-field"
        placeholder="Paste your JSON tokens or CSS variables here..."
        bind:value={() => content ?? "", handleTextareaInput}
        onblur={() => (isInputTouched = true)}
      ></textarea>
    {/if}
  </div>

  <div class="dialog-actions">
    <button class="a-button" onclick={handleImport}>Create</button>
    <button class="a-button" commandfor="new-project-dialog" command="close">
      Cancel
    </button>
  </div>
</dialog>

<style>
  dialog:modal {
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-primary);
    color: var(--text-primary);
    padding: 28px;
    width: 100%;
    max-width: 720px;
    box-shadow: 0 20px 25px rgba(0, 0, 0, 0.15);

    &::backdrop {
      background: rgba(0, 0, 0, 0.5);
    }
  }

  h2 {
    margin: 0 0 16px 0;
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .control-container {
    display: grid;
    height: 300px;
  }

  textarea {
    width: 100%;
    height: 100%;
    resize: none;
    max-height: none;
  }

  .dropzone {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid transparent;
    border-radius: 4px;
    background: var(--bg-secondary);
    transition: all 0.2s ease;
    text-align: center;

    &:hover {
      background-color: var(--bg-hover);
    }

    &[data-drag-over="true"] {
      outline: none;
      border-color: var(--accent);
      background: var(--bg-primary);
      box-shadow: 0 0 0 2px rgb(0 0 0 / 0.1);
    }
  }

  .dropzone-text {
    font-size: 16px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .dropzone-subtext {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .file-input {
    display: none;
  }

  .error-message {
    color: var(--error-color, #ff0000);
    font-size: 13px;
    padding: 8px;
    background: rgba(255, 0, 0, 0.1);
    border-radius: 4px;
    margin: 8px 0;
  }

  .dialog-actions {
    display: flex;
    gap: 8px;
    margin-top: 16px;
    justify-content: flex-end;
  }
</style>
