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

  return {
    api,
    applyPreset(key: string) {
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
    showGrid(idxs: number[], cols: number) {
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
      add(idx, active ? panelIdx(active.id) : undefined, 'right');
    },
    restore(json: unknown): boolean {
      try { api.fromJSON(json as Parameters<DockviewApi['fromJSON']>[0]); return api.panels.length > 0; } catch { return false; }
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
