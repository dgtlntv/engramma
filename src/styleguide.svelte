<script lang="ts">
  import { onMount } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { noCase, snakeCase } from "change-case";
  import { titleCase } from "title-case";
  import type { TokenMeta, TreeNodeMeta } from "./state.svelte";
  import {
    treeState,
    resolveTokenValue,
    getTokenReference,
    getComponentReferences,
    getJsonPointerReferences,
    type TokenReference,
    type ComponentReference,
    type JsonPointerReference,
  } from "./state.svelte";
  import type { TreeNode } from "./store";
  import { serializeColor } from "./color";
  import type {
    CubicBezierValue,
    DurationValue,
    StrokeStyleValue,
  } from "./schema";
  import {
    referenceToVariable,
    toCubicBezierValue,
    toDimensionValue,
    toDurationValue,
    toFontFamilyValue,
    toGradientValue,
    toShadowValue,
    toStrokeStyleValue,
  } from "./css-variables";
  import CopyButton from "./copy-button.svelte";

  const { selectedItems }: { selectedItems: Set<string> } = $props();

  // Cache nodes() to avoid redundant calls
  const allNodes = $derived(treeState.nodes());

  // Track which token cards are visible (for lazy rendering)
  const visibleTokenCards = new SvelteSet<string>();
  let intersectionObserver: IntersectionObserver | null = null;
  let scrollContainer: HTMLElement | null = null;

  const setupObserver = () => {
    if (!scrollContainer) return;
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const nodeId = entry.target.getAttribute("data-node-id");
          if (nodeId && entry.isIntersecting) {
            visibleTokenCards.add(nodeId);
            // Stop observing once visible (card stays loaded)
            intersectionObserver?.unobserve(entry.target);
          }
        }
      },
      { root: scrollContainer, rootMargin: "200px" },
    );
  };

  onMount(() => {
    setupObserver();
    return () => intersectionObserver?.disconnect();
  });

  const observeTokenCard = (element: HTMLElement) => {
    // Defer observation until observer is ready
    if (intersectionObserver) {
      intersectionObserver.observe(element);
    } else {
      // Observer not ready yet, try again after setup
      requestAnimationFrame(() => intersectionObserver?.observe(element));
    }
  };

  const navigateToToken = (nodeId: string) => {
    // Push to browser history so back/forward works
    const newUrl = `${window.location.pathname}${window.location.search}#${nodeId}`;
    window.history.pushState({ selectedNodeId: nodeId }, "", newUrl);
    selectedItems.clear();
    selectedItems.add(nodeId);
  };

  const visibleNodes = $derived.by(() => {
    const visibleNodes = new Set<string>();
    const addDescendants = (nodeId: string) => {
      const children = treeState.getChildren(nodeId);
      for (const child of children) {
        visibleNodes.add(child.nodeId);
        addDescendants(child.nodeId);
      }
    };
    for (const nodeId of selectedItems) {
      let currentNodeId: undefined | string = nodeId;
      while (currentNodeId) {
        visibleNodes.add(currentNodeId);
        const node = treeState.getNode(currentNodeId);
        currentNodeId = node?.parentId;
      }
      addDescendants(nodeId);
    }
    return visibleNodes;
  });

  const typographyPlaceholder =
    "The quick brown fox jumps over 12 lazy dogs. Sphinx of black quartz, judge my vow.";
</script>

{#snippet cubicBezierPreview({
  id,
  duration,
  delay,
  cubicBezier,
}: {
  id: string;
  duration?: DurationValue;
  delay?: DurationValue;
  cubicBezier: CubicBezierValue;
})}
  {@const durationValue = duration ? toDurationValue(duration) : undefined}
  {@const delayValue = toDurationValue(delay ?? { value: 1000, unit: "ms" })}
  {@const size = 120}
  {@const padding = 11}
  {@const scale = size - padding * 2}
  {@const x1 = padding + cubicBezier[0] * scale}
  {@const y1 = padding + (1 - cubicBezier[1]) * scale}
  {@const x2 = padding + cubicBezier[2] * scale}
  {@const y2 = padding + (1 - cubicBezier[3]) * scale}
  {@const path = `M ${padding} ${padding + scale} C ${x1} ${y1} ${x2} ${y2} ${padding + scale} ${padding}`}
  <!-- firefox breaks when id is kebab case -->
  {@const motionId = snakeCase(noCase(`${id}-motion`))}
  <svg
    viewBox="0 0 {size} {size}"
    class="cubic-bezier-preview"
    xmlns="http://www.w3.org/2000/svg"
  >
    <!-- Curve -->
    <path
      d={path}
      fill="none"
      stroke="#4f46e5"
      stroke-width="1.5"
      stroke-linecap="round"
    />
    <!-- Control points connection lines -->
    <line
      x1={padding}
      y1={padding + scale}
      x2={x1}
      y2={y1}
      stroke="#ccc"
      stroke-width="0.5"
      stroke-dasharray="2"
    />
    <line
      x1={x2}
      y1={y2}
      x2={padding + scale}
      y2={padding}
      stroke="#ccc"
      stroke-width="0.5"
      stroke-dasharray="2"
    />
    {#if durationValue}
      <path id="{id}-motion-path" d={path} fill="none" stroke="none" />
      <circle r="5" fill="#4f46e5" class="curve-impulse">
        <animateMotion
          id={motionId}
          dur={durationValue}
          calcMode="spline"
          keyTimes="0; 1"
          keySplines={cubicBezier.join(" ")}
          begin="0s; {motionId}.end + {delayValue}"
          fill="freeze"
        >
          <mpath href="#{id}-motion-path" />
        </animateMotion>
      </circle>
    {/if}
    <!-- Control points -->
    <circle cx={x1} cy={y1} r="2" fill="#4f46e5" opacity="0.6" />
    <circle cx={x2} cy={y2} r="2" fill="#4f46e5" opacity="0.6" />
    <!-- Start and end points -->
    <circle cx={padding} cy={padding + scale} r="4" fill="#333" />
    <circle cx={padding + scale} cy={padding} r="4" fill="#333" />
  </svg>
{/snippet}

{#snippet strokeStylePreview(value: StrokeStyleValue)}
  <svg
    viewBox="0 0 200 80"
    class="stroke-style-preview"
    xmlns="http://www.w3.org/2000/svg"
  >
    {#if value === "solid"}
      <line x1="10" y1="40" x2="190" y2="40" stroke="#333" stroke-width="2" />
    {:else if value === "dashed"}
      <line
        x1="10"
        y1="40"
        x2="190"
        y2="40"
        stroke="#333"
        stroke-width="2"
        stroke-dasharray="8,4"
      />
    {:else if value === "dotted"}
      <line
        x1="10"
        y1="40"
        x2="190"
        y2="40"
        stroke="#333"
        stroke-width="2"
        stroke-dasharray="2,4"
        stroke-linecap="round"
      />
    {:else if value === "double"}
      <line x1="10" y1="37" x2="190" y2="37" stroke="#333" stroke-width="2" />
      <line x1="10" y1="43" x2="190" y2="43" stroke="#333" stroke-width="2" />
    {:else if value === "groove"}
      <line x1="10" y1="40" x2="190" y2="40" stroke="#999" stroke-width="2" />
      <line x1="10" y1="41" x2="190" y2="41" stroke="#eee" stroke-width="1" />
    {:else if value === "ridge"}
      <line x1="10" y1="40" x2="190" y2="40" stroke="#eee" stroke-width="2" />
      <line x1="10" y1="41" x2="190" y2="41" stroke="#999" stroke-width="1" />
    {:else if value === "outset"}
      <line x1="10" y1="39" x2="190" y2="39" stroke="#bbb" stroke-width="1" />
      <line x1="10" y1="41" x2="190" y2="41" stroke="#666" stroke-width="2" />
    {:else if value === "inset"}
      <line x1="10" y1="39" x2="190" y2="39" stroke="#666" stroke-width="2" />
      <line x1="10" y1="41" x2="190" y2="41" stroke="#bbb" stroke-width="1" />
    {:else}
      <line
        x1="10"
        y1="40"
        x2="190"
        y2="40"
        stroke="#333"
        stroke-width="2"
        stroke-dasharray={value.dashArray.map((dim) => dim.value).join(",")}
        stroke-linecap={value.lineCap}
      />
    {/if}
  </svg>
{/snippet}

{#snippet strokeStyleMetadata(value: StrokeStyleValue)}
  {#if typeof value === "string"}
    <div>Style: {value}</div>
  {:else}
    <div>
      Dash Array: {value.dashArray.map(toDimensionValue).join(", ")}
    </div>
    <div>Line Cap: {value.lineCap}</div>
  {/if}
{/snippet}

{#snippet numberPreview({
  tokens,
  value,
}: {
  tokens: Array<number>;
  value: number;
})}
  {#if tokens.length > 0}
    {@const min = Math.min(0, ...tokens)}
    {@const max = Math.max(0, ...tokens)}
    {@const zeroPoint = (0 - min) / (max - min)}
    {@const size = Math.abs((value - min) / (max - min) - zeroPoint)}
    <div class="number-zero-point" style:--position={zeroPoint}></div>
    {#if value < 0}
      <div
        class="number-bar-negative"
        style:--position={zeroPoint}
        style:--size={size}
      ></div>
    {/if}
    {#if value > 0}
      <div
        class="number-bar-positive"
        style:--position={zeroPoint}
        style:--size={size}
      ></div>
    {/if}
  {/if}
{/snippet}

{#snippet metadata(tokenMeta: TokenMeta)}
  <div class="token-name">{titleCase(noCase(tokenMeta.name))}</div>
  {#if tokenMeta.description}
    <div class="token-description">{tokenMeta.description}</div>
  {/if}
  {#if tokenMeta.deprecated}
    {@const reason =
      typeof tokenMeta.deprecated === "string"
        ? `: ${tokenMeta.deprecated}`
        : ""}
    <div class="token-deprecated">Deprecated{reason}</div>
  {/if}
{/snippet}

{#snippet extensionsDisplay(tokenMeta: TokenMeta)}
  {#if tokenMeta.extensions && Object.keys(tokenMeta.extensions).length > 0}
    <div class="token-extensions-section">
      <span class="extensions-label">Extensions</span>
      <pre class="token-extensions">{JSON.stringify(
          tokenMeta.extensions,
          null,
          2,
        )}</pre>
    </div>
  {/if}
{/snippet}

{#snippet referenceLink(ref: TokenReference)}
  <button
    type="button"
    class="reference-link"
    onclick={() => navigateToToken(ref.nodeId)}
    title="Go to {ref.path.join(' > ')}"
  >
    {"{" + ref.path.join(".") + "}"}
  </button>
{/snippet}

{#snippet tokenReference(node: TreeNode<TreeNodeMeta>)}
  {@const ref = getTokenReference(node, allNodes)}
  {#if ref}
    <div class="token-reference">
      <span class="reference-label">Alias of</span>
      {@render referenceLink(ref)}
    </div>
  {/if}
{/snippet}

{#snippet jsonPointerRefLink(ref: JsonPointerReference)}
  {#if ref.targetNodeId}
    <button
      type="button"
      class="reference-link json-pointer-ref"
      onclick={() => navigateToToken(ref.targetNodeId!)}
      title="Go to referenced token"
    >
      {ref.displayRef}
    </button>
  {:else}
    <span class="reference-link json-pointer-ref disabled"
      >{ref.displayRef}</span
    >
  {/if}
{/snippet}

{#snippet componentReferences(node: TreeNode<TreeNodeMeta>)}
  {@const curlyBraceRefs = getComponentReferences(node, allNodes)}
  {@const jsonPtrRefs = getJsonPointerReferences(node, allNodes)}
  {@const jsonPtrKeys = new Set(jsonPtrRefs.map((r) => r.componentKey))}
  {@const filteredCurlyRefs = curlyBraceRefs.filter(
    (r) => !jsonPtrKeys.has(r.key),
  )}
  {@const hasAnyRefs = filteredCurlyRefs.length > 0 || jsonPtrRefs.length > 0}
  {#if hasAnyRefs}
    <div class="component-references">
      <span class="reference-label">References</span>
      <div class="component-reference-list">
        {#each filteredCurlyRefs as compRef (compRef.key)}
          <div class="component-reference-item">
            <span class="component-key">{compRef.key}:</span>
            {@render referenceLink(compRef.reference)}
          </div>
        {/each}
        {#each jsonPtrRefs as ref (ref.componentKey)}
          <div class="component-reference-item">
            <span class="component-key">{ref.componentKey}:</span>
            {@render jsonPointerRefLink(ref)}
          </div>
        {/each}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet copyButton(node: TreeNode<TreeNodeMeta>)}
  {@const cssVariable = referenceToVariable({ ref: node.nodeId }, allNodes)}
  <div class="copy-css-button">
    <CopyButton label="Copy CSS Variable" data={cssVariable} />
  </div>
{/snippet}

{#snippet tokenCard(
  node: TreeNode<TreeNodeMeta>,
  tokenMeta: TokenMeta,
  index: number,
  parentId?: string,
)}
  {@const isVisible = visibleTokenCards.has(node.nodeId)}
  <div
    class="token-card"
    data-deprecated={Boolean(tokenMeta.deprecated)}
    data-node-id={node.nodeId}
    use:observeTokenCard
  >
    {#if isVisible}
      {@const tokenValue = resolveTokenValue(node, allNodes)}
      {@const tokenRef = getTokenReference(node, allNodes)}
      {@const compRefs = getComponentReferences(node, allNodes)}
      {@const jsonPtrRefs = getJsonPointerReferences(node, allNodes)}
      {@const hasRefs =
        tokenRef !== undefined || compRefs.length > 0 || jsonPtrRefs.length > 0}
      {#if tokenValue.type === "color"}
        {@const color = serializeColor(tokenValue.value)}
        <div class="token-preview">
          <div class="color-preview" style="background: {color};"></div>
          {@render copyButton(node)}
        </div>
        <div class="token-content">
          {@render metadata(tokenMeta)}
          {@render tokenReference(node)}
          {@render componentReferences(node)}
          {@render extensionsDisplay(tokenMeta)}
          {#if hasRefs}
            <details class="resolved-value-accordion">
              <summary>Resolved value</summary>
              <div class="token-value">Color: {color}</div>
            </details>
          {:else}
            <div class="token-value">Color: {color}</div>
          {/if}
        </div>
      {/if}

      {#if tokenValue.type === "dimension"}
        {@const value = toDimensionValue(tokenValue.value)}
        <div class="token-preview">
          <div class="dimension-preview" style:--value={value}>
            <div class="dimension-bar"></div>
          </div>
          {@render copyButton(node)}
        </div>
        <div class="token-content">
          {@render metadata(tokenMeta)}
          {@render tokenReference(node)}
          {@render extensionsDisplay(tokenMeta)}
          {#if hasRefs}
            <details class="resolved-value-accordion">
              <summary>Resolved value</summary>
              <div class="token-value">Dimension: {value}</div>
            </details>
          {:else}
            <div class="token-value">Dimension: {value}</div>
          {/if}
        </div>
      {/if}

      {#if tokenValue.type === "duration"}
        <div class="token-preview">
          {@render cubicBezierPreview({
            id: `styleguide-duration-${index}`,
            cubicBezier: [0, 0, 1, 1],
            duration: tokenValue.value,
          })}
          {@render copyButton(node)}
        </div>
        <div class="token-content">
          {@render metadata(tokenMeta)}
          {@render tokenReference(node)}
          {@render extensionsDisplay(tokenMeta)}
          {#if hasRefs}
            <details class="resolved-value-accordion">
              <summary>Resolved value</summary>
              <div class="token-value">
                Duration: {toDurationValue(tokenValue.value)}
              </div>
            </details>
          {:else}
            <div class="token-value">
              Duration: {toDurationValue(tokenValue.value)}
            </div>
          {/if}
        </div>
      {/if}

      {#if tokenValue.type === "cubicBezier"}
        <div class="token-preview">
          {@render cubicBezierPreview({
            id: `styleguide-cubic-bezier-${index}`,
            cubicBezier: tokenValue.value,
          })}
          {@render copyButton(node)}
        </div>
        <div class="token-content">
          {@render metadata(tokenMeta)}
          {@render tokenReference(node)}
          {@render extensionsDisplay(tokenMeta)}
          {#if hasRefs}
            <details class="resolved-value-accordion">
              <summary>Resolved value</summary>
              <div class="token-value">
                Cubic Bezier: {tokenValue.value.join(", ")}
              </div>
            </details>
          {:else}
            <div class="token-value">
              Cubic Bezier: {tokenValue.value.join(", ")}
            </div>
          {/if}
        </div>
      {/if}

      {#if tokenValue.type === "number"}
        {@const groupTokens = treeState
          .getChildren(parentId)
          .filter((n) => n.meta.nodeType === "token")
          .map((n) => {
            const val = resolveTokenValue(n, allNodes);
            return val.type === "number" ? val.value : null;
          })
          .filter((v) => v !== null)}
        <div class="token-preview">
          {@render numberPreview({
            tokens: groupTokens,
            value: tokenValue.value,
          })}
          {@render copyButton(node)}
        </div>
        <div class="token-content">
          {@render metadata(tokenMeta)}
          {@render tokenReference(node)}
          {@render extensionsDisplay(tokenMeta)}
          {#if hasRefs}
            <details class="resolved-value-accordion">
              <summary>Resolved value</summary>
              <div class="token-value">Number: {tokenValue.value}</div>
            </details>
          {:else}
            <div class="token-value">Number: {tokenValue.value}</div>
          {/if}
        </div>
      {/if}

      {#if tokenValue.type === "fontFamily"}
        {@const fontFamily = toFontFamilyValue(tokenValue.value)}
        <div class="token-preview">
          <div class="typography-preview" style="font-family: {fontFamily};">
            {typographyPlaceholder}
          </div>
          {@render copyButton(node)}
        </div>
        <div class="token-content">
          {@render metadata(tokenMeta)}
          {@render tokenReference(node)}
          {@render extensionsDisplay(tokenMeta)}
          {#if hasRefs}
            <details class="resolved-value-accordion">
              <summary>Resolved value</summary>
              <div class="token-value">Font: {fontFamily}</div>
            </details>
          {:else}
            <div class="token-value">Font: {fontFamily}</div>
          {/if}
        </div>
      {/if}

      {#if tokenValue.type === "fontWeight"}
        {@const weight = tokenValue.value}
        <div class="token-preview">
          <div class="typography-preview" style="font-weight: {weight};">
            {typographyPlaceholder}
          </div>
          {@render copyButton(node)}
        </div>
        <div class="token-content">
          {@render metadata(tokenMeta)}
          {@render tokenReference(node)}
          {@render extensionsDisplay(tokenMeta)}
          {#if hasRefs}
            <details class="resolved-value-accordion">
              <summary>Resolved value</summary>
              <div class="token-value">Weight: {weight}</div>
            </details>
          {:else}
            <div class="token-value">Weight: {weight}</div>
          {/if}
        </div>
      {/if}

      {#if tokenValue.type === "transition"}
        {@const transition = tokenValue.value}
        <div class="token-preview">
          {@render cubicBezierPreview({
            id: `styleguide-transition-${index}`,
            duration: transition.duration,
            delay: transition.delay,
            cubicBezier: transition.timingFunction,
          })}
          {@render copyButton(node)}
        </div>
        <div class="token-content">
          {@render metadata(tokenMeta)}
          {@render tokenReference(node)}
          {@render componentReferences(node)}
          {@render extensionsDisplay(tokenMeta)}
          {#if hasRefs}
            <details class="resolved-value-accordion">
              <summary>Resolved value</summary>
              <div class="token-value">
                Duration: {toDurationValue(transition.duration)}<br />
                Delay: {toDurationValue(transition.delay)}<br />
                Timing: {toCubicBezierValue(transition.timingFunction)}
              </div>
            </details>
          {:else}
            <div class="token-value">
              Duration: {toDurationValue(transition.duration)}<br />
              Delay: {toDurationValue(transition.delay)}<br />
              Timing: {toCubicBezierValue(transition.timingFunction)}
            </div>
          {/if}
        </div>
      {/if}

      {#if tokenValue.type === "typography"}
        {@const typo = tokenValue.value}
        <div class="token-preview">
          <div
            class="typography-preview"
            style="
          font-family: {toFontFamilyValue(typo.fontFamily)};
          font-weight: {typo.fontWeight};
          font-size: {toDimensionValue(typo.fontSize)};
          line-height: {typo.lineHeight};
          letter-spacing: {toDimensionValue(typo.letterSpacing)};"
          >
            {typographyPlaceholder}
          </div>
          {@render copyButton(node)}
        </div>
        <div class="token-content">
          {@render metadata(tokenMeta)}
          {@render tokenReference(node)}
          {@render componentReferences(node)}
          {@render extensionsDisplay(tokenMeta)}
          {#if hasRefs}
            <details class="resolved-value-accordion">
              <summary>Resolved value</summary>
              <div class="token-value">
                Font: {toFontFamilyValue(typo.fontFamily)}<br />
                Weight: {typo.fontWeight}<br />
                Size: {toDimensionValue(typo.fontSize)}<br />
                Line Height: {typo.lineHeight}<br />
                Letter Spacing: {toDimensionValue(typo.letterSpacing)}
              </div>
            </details>
          {:else}
            <div class="token-value">
              Font: {toFontFamilyValue(typo.fontFamily)}<br />
              Weight: {typo.fontWeight}<br />
              Size: {toDimensionValue(typo.fontSize)}<br />
              Line Height: {typo.lineHeight}<br />
              Letter Spacing: {toDimensionValue(typo.letterSpacing)}
            </div>
          {/if}
        </div>
      {/if}

      {#if tokenValue.type === "gradient"}
        {@const gradient = toGradientValue(tokenValue.value, new Map())}
        <div class="token-preview">
          <div
            class="gradient-preview"
            style="background-image: {gradient};"
          ></div>
          {@render copyButton(node)}
        </div>
        <div class="token-content">
          {@render metadata(tokenMeta)}
          {@render tokenReference(node)}
          {@render componentReferences(node)}
          {@render extensionsDisplay(tokenMeta)}
          {#if hasRefs}
            <details class="resolved-value-accordion">
              <summary>Resolved value</summary>
              <div class="token-value">
                {#each tokenValue.value as stop}
                  <div>
                    {stop.position * 100}%: {serializeColor(stop.color)}
                  </div>
                {/each}
              </div>
            </details>
          {:else}
            <div class="token-value">
              {#each tokenValue.value as stop}
                <div>
                  {stop.position * 100}%: {serializeColor(stop.color)}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if tokenValue.type === "shadow"}
        {@const shadows = tokenValue.value}
        <div class="token-preview">
          <div
            class="shadow-preview"
            style="box-shadow: {toShadowValue(tokenValue.value, new Map())};"
          ></div>
          {@render copyButton(node)}
        </div>
        <div class="token-content">
          {@render metadata(tokenMeta)}
          {@render tokenReference(node)}
          {@render componentReferences(node)}
          {@render extensionsDisplay(tokenMeta)}
          {#if hasRefs}
            <details class="resolved-value-accordion">
              <summary>Resolved value</summary>
              <div class="token-value">
                {#each shadows as shadow}
                  <div>
                    {toShadowValue([shadow], new Map())}
                  </div>
                {/each}
              </div>
            </details>
          {:else}
            <div class="token-value">
              {#each shadows as shadow}
                <div>
                  {toShadowValue([shadow], new Map())}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if tokenValue.type === "border"}
        {@const border = tokenValue.value}
        {@const width = toDimensionValue(border.width)}
        {@const style = toStrokeStyleValue(border.style)}
        {@const color = serializeColor(border.color)}
        <div class="token-preview">
          <div
            class="border-preview"
            style="border: {width} {style} {color};"
          ></div>
          {@render copyButton(node)}
        </div>
        <div class="token-content">
          {@render metadata(tokenMeta)}
          {@render tokenReference(node)}
          {@render componentReferences(node)}
          {@render extensionsDisplay(tokenMeta)}
          {#if hasRefs}
            <details class="resolved-value-accordion">
              <summary>Resolved value</summary>
              <div class="token-value">
                <div>Color: {color}</div>
                <div>Width: {width}</div>
                {@render strokeStyleMetadata(border.style)}
              </div>
            </details>
          {:else}
            <div class="token-value">
              <div>Color: {color}</div>
              <div>Width: {width}</div>
              {@render strokeStyleMetadata(border.style)}
            </div>
          {/if}
        </div>
      {/if}

      {#if tokenValue.type === "strokeStyle"}
        <div class="token-preview">
          {@render strokeStylePreview(tokenValue.value)}
          {@render copyButton(node)}
        </div>
        <div class="token-content">
          {@render metadata(tokenMeta)}
          {@render tokenReference(node)}
          {@render extensionsDisplay(tokenMeta)}
          {#if hasRefs}
            <details class="resolved-value-accordion">
              <summary>Resolved value</summary>
              <div class="token-value">
                {@render strokeStyleMetadata(tokenValue.value)}
              </div>
            </details>
          {:else}
            <div class="token-value">
              {@render strokeStyleMetadata(tokenValue.value)}
            </div>
          {/if}
        </div>
      {/if}
    {:else}
      <!-- Placeholder while loading -->
      <div class="token-preview token-placeholder"></div>
      <div class="token-content">
        <div class="token-name">{titleCase(noCase(tokenMeta.name))}</div>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet renderNodes(parentId: string | undefined, depth: number)}
  {@const children = treeState
    .getChildren(parentId)
    .filter((node) => visibleNodes.size === 0 || visibleNodes.has(node.nodeId))}
  {@const tokens = children.filter((node) => node.meta.nodeType === "token")}
  {@const groups = children.filter(
    (node) =>
      node.meta.nodeType === "resolver" ||
      node.meta.nodeType === "token-set" ||
      node.meta.nodeType === "token-group" ||
      node.meta.nodeType === "modifier" ||
      node.meta.nodeType === "modifier-context",
  )}
  <!-- render tokens first and then groups to strictly co-locate
  headings with content which can have nested headings -->
  {#if tokens.length > 0}
    <div class="token-grid">
      {#each tokens as node, index (node.nodeId)}
        {#if node.meta.nodeType === "token"}
          {@render tokenCard(node, node.meta, index, parentId)}
        {/if}
      {/each}
    </div>
  {/if}
  {#each groups as group (group.nodeId)}
    <svelte:element this={`h${depth}`}>
      {titleCase(noCase(group.meta.name))}
    </svelte:element>
    {#if group.meta.description}
      <p>
        {group.meta.description}
      </p>
    {/if}
    {#if group.meta.extensions && Object.keys(group.meta.extensions).length > 0}
      <div class="group-extensions-section">
        <span class="extensions-label">Extensions</span>
        <pre class="token-extensions">{JSON.stringify(
            group.meta.extensions,
            null,
            2,
          )}</pre>
      </div>
    {/if}
    {@render renderNodes(group.nodeId, depth + 1)}
  {/each}
{/snippet}

<div class="styleguide" bind:this={scrollContainer}>
  <div class="container">
    <h1>Design Tokens Styleguide</h1>
    {@render renderNodes(undefined, 2)}
  </div>
</div>

<style>
  .styleguide {
    background: #f0f0f0;
    color: #333;
    line-height: 1.6;
    overflow: auto;
    height: 100%;
    flex: 1;
    scrollbar-width: thin;
    scrollbar-color: rgb(0 0 0 / 0.2) #f0f0f0;
  }

  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 40px 20px;
  }

  h1 {
    font-size: 32px;
    font-weight: 700;
    color: #000;
  }

  h2 {
    font-size: 24px;
    font-weight: 600;
    color: #222;
  }

  h3 {
    font-size: 16px;
    font-weight: 600;
    color: #444;
  }

  h4 {
    font-size: 14px;
    font-weight: 600;
    margin-top: 16px;
    color: #555;
  }

  p {
    color: #666;
    margin-bottom: 20px;
  }

  .token-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 20px;
    margin-bottom: 30px;
  }

  .copy-css-button {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 10;
    visibility: hidden;
    opacity: 0;
    transition: all 0.3s;
  }

  .token-card {
    background: white;
    overflow: clip;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    transition: all 0.3s;

    &[data-deprecated="true"] {
      opacity: 0.5;
    }

    &:hover {
      opacity: 1;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);

      .copy-css-button {
        visibility: visible;
        opacity: 1;
      }
    }
  }

  .token-preview {
    --grid-step: 8px;
    --grid-line: 1px;
    /* Colors */
    --grid-color-minor: rgba(0, 0, 0, 0.06);
    --grid-color-major: rgba(0, 0, 0, 0.06);
    /* Every N steps draw a stronger line (e.g. 4 * 16 = 64px) */
    --grid-major-every: 4;
    height: 140px;
    border-bottom: 1px solid var(--grid-color-major);
    position: relative;
    /* to keep z-index: -1 inside of preview */
    isolation: isolate;
    /* Add this class to any container you want the grid on */
    &::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: -1;
      /* Grid backgrounds:
         - minor vertical lines every 16px
         - minor horizontal lines every 16px
         - major vertical lines every (16px * 4 = 64px)
         - major horizontal lines every (16px * 4 = 64px)
      */
      background-image:
        linear-gradient(
          to right,
          var(--grid-color-minor) var(--grid-line),
          transparent var(--grid-line)
        ),
        linear-gradient(
          to bottom,
          var(--grid-color-minor) var(--grid-line),
          transparent var(--grid-line)
        ),
        linear-gradient(
          to right,
          var(--grid-color-major) var(--grid-line),
          transparent var(--grid-line)
        ),
        linear-gradient(
          to bottom,
          var(--grid-color-major) var(--grid-line),
          transparent var(--grid-line)
        );
      background-size:
        var(--grid-step) var(--grid-step),
        var(--grid-step) var(--grid-step),
        calc(var(--grid-step) * var(--grid-major-every))
          calc(var(--grid-step) * var(--grid-major-every)),
        calc(var(--grid-step) * var(--grid-major-every))
          calc(var(--grid-step) * var(--grid-major-every));
      /* hide left and top lines */
      background-position: -1px -1px;
    }
  }

  .token-content {
    padding: 12px;
    display: grid;
    gap: 4px;
  }

  .token-name {
    font-weight: 600;
    font-size: 13px;
    color: #333;
    font-family: var(--typography-monospace-code);
    /* too long camel cased names should be fully visible */
    overflow-wrap: anywhere;
  }

  .token-description {
    font-size: 12px;
    color: #666;
  }

  .token-value {
    font-family: var(--typography-monospace-code);
    font-size: 11px;
    color: #999;
  }

  .token-deprecated {
    background: #fff3cd;
    color: #856404;
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 500;
    justify-self: start;
  }

  .token-reference,
  .component-references {
    font-size: 11px;
  }

  .reference-label {
    color: #888;
    margin-right: 4px;
  }

  .reference-link {
    display: inline;
    background: none;
    border: none;
    padding: 0;
    font-family: var(--typography-monospace-code);
    font-size: 11px;
    color: #4f46e5;
    cursor: pointer;
    text-decoration: none;
    transition: color 0.15s;

    &:hover {
      color: #3730a3;
      text-decoration: underline;
    }
  }

  .component-reference-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 2px;
  }

  .component-reference-item {
    display: flex;
    align-items: baseline;
    gap: 4px;
  }

  .component-key {
    color: #666;
    font-family: var(--typography-monospace-code);
    font-size: 10px;
  }

  .json-pointer-ref {
    word-break: break-all;

    &.disabled {
      color: #999;
      cursor: default;
    }
  }

  .resolved-value-accordion {
    margin-top: 4px;

    & > summary {
      font-size: 11px;
      color: #888;
      cursor: pointer;
      user-select: none;
      list-style: none;

      &::-webkit-details-marker {
        display: none;
      }

      &::before {
        content: "▶";
        display: inline-block;
        margin-right: 4px;
        font-size: 8px;
        transition: transform 0.15s;
      }

      &:hover {
        color: #666;
      }
    }

    &[open] > summary::before {
      transform: rotate(90deg);
    }

    & > .token-value {
      margin-top: 4px;
      padding-left: 12px;
    }
  }

  .color-preview {
    position: absolute;
    inset: 0;
  }

  .dimension-preview {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: center;
  }

  .dimension-bar {
    width: var(--value);
    background-color: var(--bg-primary);
    height: 100%;
  }

  .cubic-bezier-preview {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .typography-preview {
    position: absolute;
    inset: 0;
    padding: 12px;
    font-size: 24px;
    line-height: 1.5;
    overflow: clip;
  }

  .gradient-preview {
    position: absolute;
    inset: 0;
  }

  .stroke-style-preview {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .number-zero-point {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--position) * 100%);
    border-right: 1px solid black;
  }

  .number-bar-positive {
    position: absolute;
    top: 45%;
    left: calc(var(--position) * 100%);
    width: calc(var(--size) * 100%);
    height: 10%;
    background-color: green;
  }

  .number-bar-negative {
    position: absolute;
    top: 45%;
    right: calc((1 - var(--position)) * 100%);
    width: calc(var(--size) * 100%);
    height: 10%;
    background-color: red;
  }

  .shadow-preview {
    position: absolute;
    inset: 20% 10%;
    background-color: white;
  }

  .border-preview {
    position: absolute;
    inset: 20% 10%;
    background-color: white;
  }

  .curve-impulse {
    opacity: 0.8;
    filter: drop-shadow(0 0 3px rgba(79, 70, 229, 0.3));
  }

  .token-placeholder {
    background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
    background-size: 200% 100%;
    animation: placeholder-shimmer 1.5s infinite;
  }

  @keyframes placeholder-shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  .token-extensions-section {
    margin-top: 4px;
  }

  .group-extensions-section {
    margin-bottom: 20px;
  }

  .extensions-label {
    font-size: 11px;
    color: #888;
  }

  .token-extensions {
    margin: 4px 0 0 0;
    padding: 8px;
    background: #f8f8f8;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    font-family: var(--typography-monospace-code);
    font-size: 10px;
    line-height: 1.4;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 150px;
    overflow-y: auto;
    color: #555;
  }
</style>
