<script lang="ts">
  import Prism from "prismjs";
  import "prismjs/components/prism-json";
  import "prismjs/components/prism-css";
  import "prismjs/components/prism-css";
  import "prismjs/components/prism-scss";
  import "prismjs/themes/prism-tomorrow.min.css";
  import type { HTMLAttributes } from "svelte/elements";

  interface Props extends HTMLAttributes<HTMLPreElement> {
    code: string;
    language: "json" | "css" | "scss";
  }

  let { code, language }: Props = $props();

  let copyFeedback = $state(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      copyFeedback = true;
      setTimeout(() => {
        copyFeedback = false;
      }, 2000);
    } catch (error) {
      console.error("Failed to copy code", error);
    }
  };

  const highlightedCode = $derived(
    Prism.highlight(code, Prism.languages[language], language),
  );
</script>

<div class="code-container">
  <button class="a-button" onclick={handleCopy}>
    {copyFeedback ? "Copied!" : "Copy"}
  </button>
  <pre><code class="language-{language}">{@html highlightedCode}</code></pre>
</div>

<style>
  .code-container {
    position: relative;
    overflow: hidden;
    display: grid;
  }

  .a-button {
    position: absolute;
    top: 8px;
    right: 12px;
  }

  pre {
    margin: 0;
    padding: 16px;
    overflow: auto;
    font-family: var(--typography-monospace-code);
    font-size: 12px;
    line-height: 1.5;
    /* makes dense text slightly more readable */
    letter-spacing: 0.05em;
  }
</style>
