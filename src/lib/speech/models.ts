/** On-device speech models. Shared by the worker and the main thread. */
export type Engine = "moonshine" | "whisper";

export const MODELS = {
  "moonshine-base": { family: "moonshine", repo: "onnx-community/moonshine-base-ONNX", sizeMb: 63, fallback: "moonshine-tiny" },
  "moonshine-tiny": { family: "moonshine", repo: "onnx-community/moonshine-tiny-ONNX", sizeMb: 28, fallback: null },
  "whisper-base": { family: "whisper", repo: "onnx-community/whisper-base", sizeMb: 77, fallback: null },
} as const satisfies Record<string, { family: Engine; repo: string; sizeMb: number; fallback: string | null }>;

export type ModelName = keyof typeof MODELS;

/** Whisper languages offered on the Record screen. "auto" detects the language of each phrase. */
export const WHISPER_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "auto", label: "Auto (mixed)" },
] as const;
