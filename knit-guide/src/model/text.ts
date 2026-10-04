/** Sentence splitting shared by the parser and the guidance translator. */
export function splitAtSentences(text: string): string[] {
  return text.replace(/([.!?])\s+(?=[A-Z*])/g, '$1\u0000').split('\u0000').map((s) => s.trim()).filter(Boolean);
}
