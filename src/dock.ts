// Docking layout (dockview-core, the framework-free sibling of the flexlayout grid in
// multicam-planner): drag panels by their tab to split, stack or rearrange, drag the
// sashes to resize. The presets 1 … 3×3 only build a starting layout.

import { createDockview, type DockviewApi, type IContentRenderer } from 'dockview-core';

export interface DockHost {
  /** Build (or return) the element for panel idx. */
  element: (idx: number) => HTMLElement;
  title: (idx: number) => string;
  onLayout: () => void;
}

/** Build order plus target size per panel as fraction of the dock [width, height]. */
export const PRESETS: Record<string, { label: string; build: (add: Adder) => void; size?: Record<number, [number, number]> }> = {
  l1: { label: '1', build: (add) => add(0) },
  l2: { label: '1+1', build: (add) => { add(0); add(1, 0, 'right'); }, size: { 0: [0.5, 1] } },
  l4: { label: '2×2', build: (add) => { add(0); add(1, 0, 'right'); add(2, 0, 'below'); add(3, 1, 'below'); }, size: { 0: [0.5, 0.5], 1: [0.5, 0.5] } },
  lc: {
    label: 'Colorist',
    build: (add) => { add(0); add(3, 0, 'below'); add(1, 0, 'right'); add(2, 1, 'below'); add(4, 3, 'right'); add(5, 4, 'right'); },
    size: { 1: [0.38, 0], 3: [0, 0.38], 2: [0, 0.31], 4: [2 / 3, 0], 5: [1 / 3, 0] },
  },
  l6: {
    label: '3×2', build: (add) => { add(0); add(1, 0, 'right'); add(2, 1, 'right'); add(3, 0, 'below'); add(4, 1, 'below'); add(5, 2, 'below'); },
    size: { 0: [1 / 3, 0.5], 1: [1 / 3, 0.5], 2: [1 / 3, 0.5] },
  },
  l9: {
    label: '3×3',
    build: (add) => {
      add(0); add(1, 0, 'right'); add(2, 1, 'right');
      add(3, 0, 'below'); add(4, 1, 'below'); add(5, 2, 'below');
      add(6, 3, 'below'); add(7, 4, 'below'); add(8, 5, 'below');
    },
    size: { 0: [1 / 3, 1 / 3], 1: [1 / 3, 1 / 3], 2: [1 / 3, 1 / 3], 3: [1 / 3, 1 / 3], 4: [1 / 3, 1 / 3], 5: [1 / 3, 1 / 3] },
  },
  // stacked (iPhone portrait, narrow windows): picture above waveform
  l2v: { label: '1/1', build: (add) => { add(0); add(1, 0, 'below'); }, size: { 0: [1, 0.5] } },
};
type Adder = (idx: number, ref?: number, direction?: 'right' | 'below') => void;

export const panelId = (idx: number) => `p${idx}`;
export const panelIdx = (id: string) => Number(id.slice(1));

export function createDock(el: HTMLElement, host: DockHost) {
  const api: DockviewApi = createDockview(el, {
    className: 'dockview-theme-abyss lzs-dock',
    disableFloatingGroups: true,
    createComponent: (): IContentRenderer => {
      const element = document.createElement('div');
      element.className = 'dock-content';
      return {
        element,
        init: (p) => {
          const idx = (p.params as { idx: number }).idx;
          element.replaceChildren(host.element(idx));
        },
      };
    },
  });
  api.onDidLayoutChange(() => host.onLayout());

  let sizing: Record<number, [number, number]> = {};
  const add: Adder = (idx, ref, direction) => {
    const [fw, fh] = sizing[idx] ?? [0, 0];
    api.addPanel({
      id: panelId(idx), component: 'scope', title: host.title(idx), params: { idx },
      ...(ref !== undefined ? { position: { referencePanel: panelId(ref), direction: direction ?? 'right' } } : {}),
      // new splits take their share from the preset (width for 'right', height for 'below')
      ...(fw && direction === 'right' ? { initialWidth: Math.round(fw * el.clientWidth) } : {}),
      ...(fh && direction === 'below' ? { initialHeight: Math.round(fh * el.clientHeight) } : {}),
    });
  };

  /**
   * Compact mode (narrow windows, phones): all open panels as tabs of one group, no dragging.
   * The full layout is kept aside and comes back unchanged when the window gets wide again;
   * layoutJSON() returns it, so a narrow window never overwrites the saved layout.
   */
  let compact = false, saved: unknown = null;
  const enterCompact = () => {
    const idxs = api.panels.map((p) => panelIdx(p.id));
    // the first panel (usually the picture) is in front; dockview's active panel is just the last one built
    const active = idxs[0];
    saved = api.toJSON();
    api.clear();
    idxs.forEach((idx, i) => api.addPanel({
      id: panelId(idx), component: 'scope', title: host.title(idx), params: { idx },
      ...(i ? { position: { referencePanel: panelId(idxs[0]), direction: 'within' as const } } : {}),
    }));
    if (active !== undefined) api.getPanel(panelId(active))?.api.setActive();
  };
  const leaveCompact = () => {
    const idxs = api.panels.map((p) => panelIdx(p.id));
    try { if (saved) api.fromJSON(saved as Parameters<DockviewApi['fromJSON']>[0]); } catch { /* keep the tabs */ }
    // panels added while compact join the full layout on the right
    for (const idx of idxs) if (!api.getPanel(panelId(idx))) add(idx, api.panels.length ? panelIdx(api.panels[api.panels.length - 1].id) : undefined, 'right');
    saved = null;
  };
  /** Run a layout change on the full layout, then fold it again when compact. */
  const full = (fn: () => void) => {
    if (!compact) return fn();
    compact = false; fn(); compact = true; enterCompact();
  };

  return {
    api,
    get compact() { return compact; },
    setCompact(on: boolean) {
      if (on === compact) return;
      compact = on;
      api.updateOptions({ disableDnd: on });
      el.classList.toggle('compact', on);
      if (on) enterCompact(); else leaveCompact();
    },
    /** The layout to save: the full one, also while compact. */
    layoutJSON: () => (compact ? saved : api.toJSON()),
    applyPreset(key: string) { full(() => this.applyPresetFull(key)); },
    applyPresetFull(key: string) {
      api.clear();
      const preset = PRESETS[key] ?? PRESETS.lc;
      sizing = preset.size ?? {};
      preset.build(add);
      sizing = {};
      // splits start 50/50; bring them to the preset's proportions (two passes: sizes interact)
      requestAnimationFrame(() => {
        const W = el.clientWidth, H = el.clientHeight;
        for (let pass = 0; pass < 2; pass++) {
          for (const [idx, [w, h]] of Object.entries(preset.size ?? {})) {
            api.getPanel(panelId(Number(idx)))?.group.api.setSize({ width: Math.round(w * W), height: Math.round(h * H) });
          }
        }
      });
    },
    /** Replace the layout by the given panels in rows of `cols` (e.g. the light scopes). */
    showGrid(idxs: number[], cols: number) { full(() => this.showGridFull(idxs, cols)); },
    showGridFull(idxs: number[], cols: number) {
      api.clear();
      idxs.forEach((idx, i) => {
        if (i === 0) add(idx);
        else if (i < cols) add(idx, idxs[i - 1], 'right');
        else add(idx, idxs[i - cols], 'below');
      });
    },
    /** Add a panel next to the active one (or at the end). */
    addPanel(idx: number) {
      const active = api.activePanel;
      if (compact) { api.addPanel({ id: panelId(idx), component: 'scope', title: host.title(idx), params: { idx }, ...(active ? { position: { referencePanel: active.id, direction: 'within' as const } } : {}) }); return; }
      add(idx, active ? panelIdx(active.id) : undefined, 'right');
    },
    restore(json: unknown): boolean {
      let ok = false;
      full(() => { try { api.fromJSON(json as Parameters<DockviewApi['fromJSON']>[0]); ok = api.panels.length > 0; } catch { ok = false; } });
      return ok;
    },
    openIdx: () => api.panels.map((p) => panelIdx(p.id)),
    setTitle(idx: number) { api.getPanel(panelId(idx))?.api.setTitle(host.title(idx)); },
    toggleMaximize(idx: number) {
      const p = api.getPanel(panelId(idx));
      if (!p) return;
      if (p.api.isMaximized()) p.api.exitMaximized(); else p.api.maximize();
    },
    exitMaximized() { if (api.hasMaximizedGroup()) api.exitMaximizedGroup(); },
  };
}
