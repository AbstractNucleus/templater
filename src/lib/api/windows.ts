import { invoke } from "@tauri-apps/api/core";

export async function setHotkey(accelerator: string): Promise<void> {
  await invoke<void>("set_hotkey", { accelerator });
}

export async function openDataDir(): Promise<void> {
  await invoke<void>("open_data_dir");
}

export async function openPath(path: string): Promise<void> {
  await invoke<void>("open_path", { path });
}

export async function resetWindowPosition(): Promise<void> {
  await invoke<void>("reset_window_position");
}

export type SatelliteKind = "preview" | "translator";

export async function setSatellite(kind: SatelliteKind, open: boolean): Promise<void> {
  await invoke<void>("set_satellite", { kind, open });
}

export async function isSatellite(kind: SatelliteKind): Promise<boolean> {
  return await invoke<boolean>("is_satellite", { kind });
}
