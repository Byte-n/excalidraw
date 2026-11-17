# 离屏预览不得消耗共享 id / 随机序列

记录日期：2026-10-14。来源：给创建工具加「跟随光标的半透明预设预览」时踩到的坑。

## 背景

创建工具的预设预览（`AppCreatePreview`）需要画出一个**不在场景里**的元素：它跟随光标、按下之前不该进入 scene / store / 历史，协作端也不该看到。最直接的做法就是用常规构造函数（`newElement` / `newStickyNoteElement` / `newTableElement` / `newFrameElement` / `newMindmapNodeElement` / `newTextElement`）把元素造出来，交给画布绘制。

功能本身没问题，但这么写会让**一批与预览毫无关系的快照测试集体失败**：`history.test.tsx`、`contextmenu.test.tsx`、`regressionTests.test.tsx`…… 报错形态是「差一位」：

```
- "hoveredElementId": "id0"
+ "hoveredElementId": "id1"

- aria-labelledby="radix-:r18:"
+ aria-labelledby="radix-:r5:"
```

## 机制

`@excalidraw/common` 里有两个**全局单例状态**，元素构造函数默认会消耗它们：

```ts
// packages/common/src/random.ts
export const randomInteger = () => Math.floor(random.next() * 2 ** 31);
export const randomId = () => (isTestEnv() ? `id${testIdBase++}` : nanoid());
```

```ts
// packages/element/src/newElement.ts（_newElementBase）
id: rest.id || randomId(),
seed: rest.seed ?? randomInteger(),
```

- 测试环境（`isTestEnv()`）下元素 id 是一个**进程级计数器** `id0`、`id1`、`id2`…，由 `reseed(n)` 归零；
- `seed` 取自种子随机序列 `random.next()`，同样由 `reseed(n)` 决定。

于是：**预览元素用完即弃，但它留下的副作用留在序列里**——同一会话里后续每一个真实元素的 id / seed 都整体后移一位。落到测试上就是各种「差一位」的快照不匹配，出现在离预览很远的地方（历史栈、右键菜单、Radix `useId`）。

更隐蔽的是触发路径。`AppCursor.refreshHover()`（`components/App.cursor.ts`）会在某些状态变化后**主动补发一次合成的 `pointermove`**，注释里写得很清楚：

> re-dispatches a synthetic pointermove — for state changes that alter what hovering means without the pointer moving (e.g. the tool reverting to selection after an element is created)

所以「选中创建工具之后**任何**走到悬停链路的地方」（包括"画完一个图形、工具回退、补发 hover"）都可能触发一次预览构建。当时的实测：

```ts
UI.clickTool("rectangle"); // 选中矩形工具
mouse.down(-10, -10);
mouse.up(10, 10); // 画一个矩形 —— 它拿到的 id 是 id1，而不是 id0
```

## 规则

**绘制离屏元素时必须传入显式身份（id + seed）。**

两个入口都已经支持：

```ts
// packages/excalidraw/components/app/createPresets.ts
/** 显式身份：**离屏预览必须传** */
export type CreationIdentity = { id?: string; seed?: number };

export const PREVIEW_ELEMENT_ID = "preview:preset";
export const PREVIEW_ELEMENT_SEED = 1;

// 按下即建（不传 identity）与预览（传 PREVIEW_ELEMENT_ID）共用同一份装配
newCreationDraft(app, elementType, at, containerRef?, identity?)
```

```ts
// packages/element/src/mindmapScene.ts
buildMindmapGraphFromTree(
  tree, position, font?,
  /** 每个节点/绑定文本的显式身份；离屏预览必须传 */
  identity?: (index: number) => { id?: string; seed?: number },
)
```

思维导图预览传的是 `(index) => ({ id: \`${PREVIEW_ELEMENT_ID}:${index}\`, seed: index + 1 })`；绑定文本随容器取 `<id>-text`。连线（`mindmap-edge`）不受影响——它的 id 由 `graphId + node.id` 推导、`seed` 取自容器，本来就是确定性的。

回归用例：`packages/excalidraw/_tests_/creationPreset.test.tsx` 的 `leaves the pointer id sequence alone`——先选中矩形工具悬停（触发预览），再切 freedraw 画一笔，断言这一笔的 id 是 `id0`。

## 同类先例

`App.toolDrag`（从工具栏把工具拖到画布上放下）的预览同样用构造函数建元素，同样会消耗 id / seed。它到今天没出事，只是因为没有测试恰好在它之后断言 id。**新写离屏预览时不要照抄它这部分。**

## 排查手法

这类问题的症状在远处、成因在近处，两个经验值得记：

1. **「单独跑通过、全量跑失败」不一定是测试污染。** 当时 `contextmenu.test.tsx` 单独跑绿、和别的文件一起跑红，第一反应是并行污染（本仓库确实有一批这种 flaky：`resize` / `renderOverrides` / `textWysiwyg` / `mindmapDrag` 只在全量并行跑时挂）。实际成因是：单个文件内没有触发预览构建的路径，只有跑得多的时候才有。判断依据要看**报错内容**——「差一位」「Radix useId 数值不同」这类是状态泄漏，不是时序。
2. **二分用 `git worktree`，不要 `git stash`。** 本仓库常有人在并行改文件（yjs 等），stash 会把别人的在飞改动一起收走。做法：

   ```bash
   git worktree add /tmp/xw-head HEAD          # 干净 HEAD
   ln -s <repo>/node_modules /tmp/xw-head/node_modules
   # 把我的改动逐个 cp 进去，跑测试二分；定位完 git worktree remove --force
   ```

   本次就是靠它把范围收敛到 `pointerCanvas.ts` 一处，再定位到预览构建。

## 附带的一个断言坑

`window.h.elements` 是 `scene.getElementsIncludingDeleted()`——**含墓碑**：

```ts
// packages/excalidraw/components/App.tsx（createTestHook）
elements: {
  get() {
    return this.app?.scene.getElementsIncludingDeleted();
  },
  ...
}
```

所以「撤销之后元素应该没了」不能写 `expect(h.elements).toHaveLength(0)`：撤销只是把元素标记为 `isDeleted`，它仍在数组里。正确写法：

```ts
const live = () => h.elements.filter((element) => !element.isDeleted);
Keyboard.undo();
expect(live()).toHaveLength(0);
```

`dragCreate.test.tsx` 里「点击不产生元素」那组之所以能写 `toEqual(0)`，是因为那条路径用 `updateScene({ elements: ...filter(...) })` 把元素**从数组里摘掉**了，与撤销的墓碑语义不同。
