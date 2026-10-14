/** Only hidden titles are shortened. The creator's caption is never rewritten. */
export function summarizeEditTitle(text: string): string {
  const trimmed = text.trim();
  const segments = typeof Intl.Segmenter === 'function'
    ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed), (part) => part.segment)
    : Array.from(trimmed);
  let summary = '';
  for (const segment of segments.slice(0, 80)) {
    // Array.from's fallback yields a lone surrogate as its own code point.
    // Never carry malformed input into a generated title.
    if (Array.from(segment).some((point) => point.length === 1 && point.charCodeAt(0) >= 0xd800 && point.charCodeAt(0) <= 0xdfff)) continue;
    if (summary.length + segment.length > 160) break; // CreatorEdit title contract
    summary += segment;
  }
  return summary;
}

export function editTextForSave(form: {
  caption: string; captionAr: string; title: string; titleAr: string; placeName?: string | null;
}) {
  const summary = summarizeEditTitle(form.placeName || form.caption);
  return {
    caption: form.caption,
    captionAr: form.captionAr || form.caption,
    title: summary || form.title,
    titleAr: summary || form.titleAr || form.title,
  };
}

/** Detail views show the full caption; preview cards may use its first line. */
export function fullEditCaption(edit: {
  caption: string; captionAr: string; placeName?: string | null; title: string; titleAr?: string;
}, ar: boolean): string {
  return ar
    ? edit.captionAr || edit.caption || edit.placeName || edit.title || ''
    : edit.caption || edit.captionAr || edit.placeName || edit.title || '';
}