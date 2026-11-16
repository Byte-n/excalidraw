import type { TextBlock, TextBlockMap, TextRegionKey } from "./types";

/** 读取区域文本块；区域不存在时返回 undefined。 */
export const getTextBlock = (
  texts: TextBlockMap | undefined,
  key: TextRegionKey,
): TextBlock | undefined => texts?.[key];

/** 空文本块不落 key。 */
export const isEmptyTextBlock = (block: TextBlock): boolean =>
  block.text === "";

/**
 * 写入区域文本块。空文本等价于删除该 key；删除后没有剩余区域时返回 undefined。
 * 非空写入总是返回新对象，不修改入参。
 */
export const withTextBlock = (
  texts: TextBlockMap | undefined,
  key: TextRegionKey,
  block: TextBlock,
): TextBlockMap | undefined => {
  if (isEmptyTextBlock(block)) {
    return withoutTextBlock(texts, key);
  }
  return { ...(texts ?? {}), [key]: block };
};

/**
 * 删除区域文本块；删除后没有剩余区域时返回 undefined。
 * 仅当 key 存在时才复制对象，其余情况原样返回入参。
 */
export const withoutTextBlock = (
  texts: TextBlockMap | undefined,
  key: TextRegionKey,
): TextBlockMap | undefined => {
  if (!texts || !(key in texts)) {
    return texts;
  }
  const next: Partial<Record<TextRegionKey, TextBlock>> = { ...texts };
  delete next[key];
  return Object.keys(next).length > 0 ? next : undefined;
};

/** 删除所有空文本块；没有剩余区域时返回 undefined。 */
export const pruneEmptyTextBlocks = (
  texts: TextBlockMap | undefined,
): TextBlockMap | undefined => {
  if (!texts) {
    return undefined;
  }
  const next: Partial<Record<TextRegionKey, TextBlock>> = {};
  for (const key of Object.keys(texts) as TextRegionKey[]) {
    const block = texts[key];
    if (block && !isEmptyTextBlock(block)) {
      next[key] = block;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
};
