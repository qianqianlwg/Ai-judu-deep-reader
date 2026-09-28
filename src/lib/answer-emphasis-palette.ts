export const ANSWER_EMPHASIS_PALETTES = [
  { id: "paper", label: "淡金", description: "纸书式淡黄标记", light: { termBackground: "#F8F3E5", sentenceLine: "#B7AA80" }, dark: { termBackground: "#353127", sentenceLine: "#AFA281" } },
  { id: "sage", label: "浅绿", description: "低饱和草木色", light: { termBackground: "#EDF4EC", sentenceLine: "#A0B9A2" }, dark: { termBackground: "#29382F", sentenceLine: "#98B49D" } },
  { id: "blue", label: "雾蓝", description: "柔和的冷色批注", light: { termBackground: "#ECF2F7", sentenceLine: "#A5B9CA" }, dark: { termBackground: "#293743", sentenceLine: "#9EB5C6" } },
  { id: "mono", label: "素灰", description: "接近黑白的轻标记", light: { termBackground: "#F1F2F3", sentenceLine: "#B6BABF" }, dark: { termBackground: "#343A3D", sentenceLine: "#ADB5B9" } },
] as const;

export type AnswerEmphasisPaletteId = typeof ANSWER_EMPHASIS_PALETTES[number]["id"];
export const DEFAULT_ANSWER_EMPHASIS_PALETTE: AnswerEmphasisPaletteId = "paper";

export function isAnswerEmphasisPaletteId(value: unknown): value is AnswerEmphasisPaletteId {
  return ANSWER_EMPHASIS_PALETTES.some((palette) => palette.id === value);
}

export function getAnswerEmphasisPaletteVariables(id: AnswerEmphasisPaletteId, scheme: "light" | "dark") {
  const palette = ANSWER_EMPHASIS_PALETTES.find((item) => item.id === id) ?? ANSWER_EMPHASIS_PALETTES[0];
  const colors = palette[scheme];
  // WHY：强调整句不更改正文颜色，仅提供温和下划线；关键词使用浅底而不注入模型指定颜色。
  return {
    "--reading-term-background": colors.termBackground,
    "--reading-key-sentence-accent": colors.sentenceLine,
  };
}
