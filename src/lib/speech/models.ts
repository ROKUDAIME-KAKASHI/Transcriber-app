/** On-device speech models. Shared by the worker and the main thread. */
export type Engine = "moonshine" | "whisper";

/** downloadMb = real q8 download size including tokenizer files (used for UI labels). */
export const MODELS = {
  "moonshine-base": { family: "moonshine", repo: "onnx-community/moonshine-base-ONNX", sizeMb: 63, downloadMb: 67, fallback: "moonshine-tiny" },
  "moonshine-tiny": { family: "moonshine", repo: "onnx-community/moonshine-tiny-ONNX", sizeMb: 28, downloadMb: 32, fallback: null },
  "whisper-base": { family: "whisper", repo: "onnx-community/whisper-base", sizeMb: 77, downloadMb: 82, fallback: null },
} as const satisfies Record<string, { family: Engine; repo: string; sizeMb: number; downloadMb: number; fallback: string | null }>;

export type ModelName = keyof typeof MODELS;

/** Whisper languages offered on the Record screen. "auto" detects the language of each phrase. */
export const WHISPER_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "auto", label: "Auto (mixed)" },
] as const;

/** Speaker-embedding model for on-device diarization (not an ASR model, so not in MODELS). q8 = onnx/model_quantized.onnx. */
export const SPEAKER_MODEL = { repo: "onnx-community/wespeaker-voxceleb-resnet34-LM", dtype: "q8", downloadMb: 7, label: "speaker model" } as const;
