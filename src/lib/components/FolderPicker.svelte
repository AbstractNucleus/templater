<script lang="ts">
  import ComboBox from "./ComboBox.svelte";

  let {
    value,
    available,
    onChange,
    placeholder = "Add to folder…",
  }: {
    value: string | null;
    available: string[];
    onChange: (next: string | null) => void;
    placeholder?: string;
  } = $props();
</script>

<ComboBox
  selected={value === null ? [] : [value]}
  {available}
  {placeholder}
  noun="folder"
  onAdd={(folder) => onChange(folder)}
  onRemove={() => onChange(null)}
/>
