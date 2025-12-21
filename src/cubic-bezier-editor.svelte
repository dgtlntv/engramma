<script lang="ts">
  import type { CubicBezierValue } from "./schema";

  interface Props {
    value: CubicBezierValue;
    onChange: (value: CubicBezierValue) => void;
  }

  const { value, onChange }: Props = $props();

  const easingPresets: Record<string, CubicBezierValue> = {
    ease: [0.25, 0.1, 0.25, 1],
    "ease-in": [0.42, 0, 1, 1],
    "ease-out": [0, 0, 0.58, 1],
    "ease-in-out": [0.42, 0, 0.58, 1],
    linear: [0, 0, 1, 1],
  };

  const areCubicBezierSame = (a: CubicBezierValue, b: CubicBezierValue) => {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
  };

  const getPresetName = (bezierValue: CubicBezierValue): string => {
    for (const [name, preset] of Object.entries(easingPresets)) {
      if (areCubicBezierSame(preset, bezierValue)) {
        return name;
      }
    }
    return "custom";
  };

  let inputValue = $state(value.join(", "));
  let isCustomSelected = $state(getPresetName(value) === "custom");

  const parseInputValue = (inputValue: string) => {
    const parts = inputValue
      .trim()
      .split(",")
      .map((p) => Number.parseFloat(p.trim()));
    if (parts.length !== 4) {
      return;
    }
    for (const part of parts) {
      if (Number.isNaN(part) || part < 0) {
        return;
      }
    }
    return parts as CubicBezierValue;
  };

  // update state when value is changed externally
  $effect(() => {
    const parsed = parseInputValue(inputValue);
    if (parsed && !areCubicBezierSame(value, parsed)) {
      inputValue = value.join(", ");
      isCustomSelected = getPresetName(parsed) === "custom";
    }
  });
</script>

<div class="cubic-bezier-editor">
  <select
    class="a-field"
    value={getPresetName(value)}
    onchange={(event) => {
      const preset = event.currentTarget.value;
      if (preset === "custom") {
        inputValue = value.join(", ");
        isCustomSelected = true;
      } else {
        onChange(easingPresets[preset]);
        isCustomSelected = false;
      }
    }}
  >
    <option value="ease">ease</option>
    <option value="ease-in">ease-in</option>
    <option value="ease-out">ease-out</option>
    <option value="ease-in-out">ease-in-out</option>
    <option value="linear">linear</option>
    <option value="custom">custom</option>
  </select>

  {#if isCustomSelected}
    <input
      class="a-field"
      type="text"
      placeholder="e.g., 0.25, 0.1, 0.25, 1"
      bind:value={
        () => inputValue,
        (newValue) => {
          inputValue = newValue;
          const parsed = parseInputValue(newValue);
          if (parsed) {
            onChange(parsed);
          }
        }
      }
    />
  {/if}
</div>

<style>
  .cubic-bezier-editor {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
