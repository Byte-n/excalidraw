export type FollowGraphEntry = { followTarget: string | null };

/** 场景坐标视口与跟随失效判定不依赖编辑器 UI。 */
export const presenceViewportBounds = (state: {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
  zoom: { value: number };
}) => ({
  minX: -state.scrollX,
  minY: -state.scrollY,
  maxX: -state.scrollX + state.width / state.zoom.value,
  maxY: -state.scrollY + state.height / state.zoom.value,
});

export const shouldUnfollow = (
  currentTarget: string | null,
  requestedTarget: string,
  source: "programmatic" | "manual",
) => source === "manual" && currentTarget === requestedTarget;

/** 宿主无关的跟随图判定，拒绝自身及任意长度环。 */
export const createFollowGraph = (sessionId: string) => ({
  validChain(
    target: string,
    entries: ReadonlyMap<string, FollowGraphEntry>,
  ): boolean {
    const seen = new Set([sessionId]);
    let next: string | null = target;
    while (next !== null) {
      if (seen.has(next)) {
        return false;
      }
      seen.add(next);
      const entry = entries.get(next);
      if (!entry) {
        return false;
      }
      next = entry.followTarget;
    }
    return true;
  },
});
