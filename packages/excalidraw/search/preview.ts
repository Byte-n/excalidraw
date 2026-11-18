/** 命中片段的上下文预览：命中词前后保留若干词，超长时截断。 */
export interface MatchPreview {
  indexInSearchQuery: number;
  previewText: string;
  moreBefore: boolean;
  moreAfter: boolean;
}

/** 面板高亮与公开预览共用的上下文窗口规则。 */
export const getMatchPreview = (
  text: string,
  index: number,
  term: string,
): MatchPreview => {
  const WORDS_BEFORE = 2;
  const WORDS_AFTER = 5;

  const substrBeforeQuery = text.slice(0, index);
  const wordsBeforeQuery = substrBeforeQuery.split(/\s+/);
  // text = "small", query = "mall", not complete before
  // text = "small", query = "smal", complete before
  const isQueryCompleteBefore = substrBeforeQuery.endsWith(" ");
  const startWordIndex =
    wordsBeforeQuery.length -
    WORDS_BEFORE -
    1 -
    (isQueryCompleteBefore ? 0 : 1);
  let wordsBeforeAsString =
    wordsBeforeQuery.slice(startWordIndex <= 0 ? 0 : startWordIndex).join(" ") +
    (isQueryCompleteBefore ? " " : "");

  const MAX_ALLOWED_CHARS = 20;

  wordsBeforeAsString =
    wordsBeforeAsString.length > MAX_ALLOWED_CHARS
      ? wordsBeforeAsString.slice(-MAX_ALLOWED_CHARS)
      : wordsBeforeAsString;

  const substrAfterQuery = text.slice(index + term.length);
  const wordsAfter = substrAfterQuery.split(/\s+/);
  // text = "small", query = "mall", complete after
  // text = "small", query = "smal", not complete after
  const isQueryCompleteAfter = !substrAfterQuery.startsWith(" ");
  const numberOfWordsToTake = isQueryCompleteAfter
    ? WORDS_AFTER + 1
    : WORDS_AFTER;
  const wordsAfterAsString =
    (isQueryCompleteAfter ? "" : " ") +
    wordsAfter.slice(0, numberOfWordsToTake).join(" ");

  return {
    indexInSearchQuery: wordsBeforeAsString.length,
    previewText: wordsBeforeAsString + term + wordsAfterAsString,
    moreBefore: startWordIndex > 0,
    moreAfter: wordsAfter.length > numberOfWordsToTake,
  };
};

/** 把上下文预览拼成单行文本；长度窗口与面板渲染一致。 */
export const formatMatchPreview = (
  preview: MatchPreview,
  termLength: number,
): string => {
  const highlightStart = preview.indexInSearchQuery;
  return [
    preview.moreBefore ? "..." : "",
    preview.previewText.slice(0, highlightStart),
    preview.previewText.slice(highlightStart, highlightStart + termLength),
    preview.previewText.slice(highlightStart + termLength),
    preview.moreAfter ? "..." : "",
  ].join("");
};
