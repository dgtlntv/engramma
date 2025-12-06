<script lang="ts">
  import { Menu, X } from "@lucide/svelte";
  import { treeState } from "./state.svelte";
  import { serializeDesignTokens } from "./tokens";
  import { parseDesignTokens } from "./tokens";
  import stringify from "json-stringify-pretty-compact";

  const createNewProject = async () => {
    treeState.transact((tx) => {
      tx.clear();
    });
  };

  const importFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const json = JSON.parse(text);
      const result = parseDesignTokens(json);
      if (result.errors.length > 0) {
        alert(
          `Import completed with ${result.errors.length} error(s):\n${result.errors.map((e) => `${e.path}: ${e.message}`).join("\n")}`,
        );
      }
      treeState.transact((tx) => {
        // Clear existing state first
        tx.clear();
        // Import new nodes
        for (const node of result.nodes) {
          tx.set(node);
        }
      });
      alert("Design tokens imported successfully from clipboard!");
    } catch (error) {
      if (error instanceof SyntaxError) {
        alert("Failed to parse clipboard content as JSON");
      } else {
        alert(
          `Import failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }
  };

  const exportIntoClipboard = async () => {
    try {
      const allNodes = treeState.nodes();
      const serialized = serializeDesignTokens(allNodes);
      const json = stringify(serialized);
      await navigator.clipboard.writeText(json);
      alert("Design tokens exported to clipboard!");
    } catch (error) {
      alert(
        `Export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  const shareUrl = () => {
    navigator.clipboard.writeText(window.location.href);
  };
</script>

<button
  class="a-button"
  aria-label="Menu"
  commandfor="app-menu"
  command="toggle-popover"
>
  <Menu size={16} />
</button>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
  id="app-menu"
  class="a-popover a-menu app-menu"
  popover="auto"
  role="menu"
  onclick={(event) => event.currentTarget.hidePopover()}
>
  <!-- svelte-ignore a11y_autofocus -->
  <button class="a-item" role="menuitem" autofocus onclick={createNewProject}>
    New Project
  </button>
  <button class="a-item" role="menuitem" onclick={importFromClipboard}>
    Import
  </button>
  <button class="a-item" role="menuitem" onclick={exportIntoClipboard}>
    Export
  </button>
  <button class="a-item" role="menuitem" onclick={shareUrl}> Share URL </button>
  <a
    class="a-item"
    role="menuitem"
    href="https://github.com/TrySound/engramma"
    target="_blank"
    rel="noopener noreferrer"
  >
    GitHub
  </a>
  <button
    class="a-item"
    role="menuitem"
    commandfor="app-menu-about"
    command="show-modal"
  >
    About
  </button>
</div>

<dialog id="app-menu-about" class="about-dialog" closedby="any">
  <button
    class="a-button about-dialog-close"
    aria-label="Close"
    commandfor="app-menu-about"
    command="close"
  >
    <X size={16} />
  </button>
  <h2>About</h2>
  <p>
    Engramma is an open source playground for designing, organizing, and
    exporting design tokens into CSS variables.
  </p>
  <p>
    Created and maintained by Bogdan Chadkin aka
    <a href="https://github.com/TrySound" target="_blank" rel="noopener">
      TrySound
    </a>.
  </p>
  <p>
    If this app saves you time or helps you ship better interfaces, you can
    support its ongoing development by sponsoring the project.
  </p>
  <p>
    → Sponsor / contact:
    <a href="mailto:opensource@trysound.io">opensource@trysound.io</a>
  </p>
</dialog>

<style>
  .app-menu {
    position-area: span-right bottom;
  }

  .about-dialog {
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-primary);
    color: var(--text-primary);
    padding: 28px;
    max-width: 500px;
    box-shadow: 0 20px 25px rgba(0, 0, 0, 0.15);

    &::backdrop {
      background: rgba(0, 0, 0, 0.5);
    }

    h2 {
      margin: 0 0 16px 0;
      font-size: 20px;
      font-weight: 600;
      color: var(--text-primary);
    }

    p {
      margin: 16px 0;
      font-size: 15px;
      line-height: 1.5;
      color: var(--text-primary);

      a {
        color: var(--accent);
        font-weight: 500;
      }
    }
  }

  .about-dialog-close {
    position: absolute;
    top: 16px;
    right: 16px;
  }
</style>
