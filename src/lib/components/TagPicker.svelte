<script lang="ts">
  import ComboBox from "./ComboBox.svelte";
  import { normalizeTag } from "$lib/tags";

  let {
    value,
    available,
    onChange,
  }: {
    value: string[];
    available: string[];
    onChange: (next: string[]) => void;
  } = $props();
</script>

<ComboBox
  selected={value}
  {available}
  normalize={normalizeTag}
  multiple
  placeholder="Add tags…"
  noun="tag"
  onAdd={(tag) => onChange([...value, tag])}
  onRemove={(tag) => onChange(value.filter((t) => t !== tag))}
/>
