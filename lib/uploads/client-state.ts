export type UploadPhase =
  "empty" | "checking" | "uploading" | "ready" | "error";
export type SelectedAsset = {
  file: File | null;
  name: string;
  size: number;
  id?: string;
  phase: UploadPhase;
  progress: number;
  error?: string;
  generation: number;
};
export type UploadState = {
  owner: string | null;
  video: SelectedAsset;
  image: SelectedAsset;
  title: string;
  description: string;
  publishing: boolean;
  error: string;
};
export const emptyAsset = (generation = 0): SelectedAsset => ({
  file: null,
  name: "",
  size: 0,
  phase: "empty",
  progress: 0,
  generation,
});
export const initialUploadState = (
  owner: string | null = null,
): UploadState => ({
  owner,
  video: emptyAsset(),
  image: emptyAsset(),
  title: "",
  description: "",
  publishing: false,
  error: "",
});
export type UploadAction =
  | { type: "reset"; owner: string | null }
  | { type: "restore"; state: UploadState }
  | { type: "draft"; title?: string; description?: string }
  | { type: "asset"; kind: "video" | "image"; value: SelectedAsset }
  | {
      type: "progress";
      kind: "video" | "image";
      generation: number;
      value: Partial<SelectedAsset>;
    }
  | { type: "publishing"; value: boolean }
  | { type: "error"; message: string };
export function uploadReducer(
  state: UploadState,
  action: UploadAction,
): UploadState {
  switch (action.type) {
    case "reset":
      return initialUploadState(action.owner);
    case "restore":
      return action.state;
    case "draft":
      return {
        ...state,
        title: action.title ?? state.title,
        description: action.description ?? state.description,
      };
    case "asset":
      return { ...state, [action.kind]: action.value, error: "" };
    case "progress":
      return state[action.kind].generation === action.generation
        ? {
            ...state,
            [action.kind]: { ...state[action.kind], ...action.value },
          }
        : state;
    case "publishing":
      return { ...state, publishing: action.value, error: "" };
    case "error":
      return { ...state, error: action.message };
  }
}
/** Persist only completed staging IDs and form text, never files, credentials or signed URLs. */
export function savedDraft(state: UploadState) {
  const ready = (asset: SelectedAsset) =>
    asset.phase === "ready" && asset.id
      ? { name: asset.name, size: asset.size, id: asset.id }
      : null;
  return JSON.stringify({
    version: 1,
    expiresAt: Date.now() + 24 * 3600000,
    owner: state.owner,
    title: state.title,
    description: state.description,
    video: ready(state.video),
    image: ready(state.image),
  });
}
export function restoreDraft(raw: string | null, owner: string): UploadState {
  const state = initialUploadState(owner);
  try {
    const data = JSON.parse(raw ?? "null");
    if (
      data?.version !== 1 ||
      data.owner !== owner ||
      typeof data.expiresAt !== "number" ||
      data.expiresAt <= Date.now()
    )
      return state;
    state.title =
      typeof data.title === "string" ? data.title.slice(0, 120) : "";
    state.description =
      typeof data.description === "string"
        ? data.description.slice(0, 2000)
        : "";
    for (const kind of ["video", "image"] as const) {
      const asset = data[kind];
      if (
        asset &&
        typeof asset.id === "string" &&
        /^[a-f0-9]{24}$/.test(asset.id) &&
        typeof asset.name === "string" &&
        Number.isSafeInteger(asset.size) &&
        asset.size > 0
      )
        state[kind] = {
          ...emptyAsset(),
          id: asset.id,
          name: asset.name.slice(0, 255),
          size: asset.size,
          phase: "ready",
          progress: 100,
        };
    }
  } catch {
    /* Ignore invalid or obsolete storage. */
  }
  return state;
}
