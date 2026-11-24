// Docking layout (dockview-core, the framework-free sibling of the flexlayout grid in
// multicam-planner): drag panels by their tab to split, stack or rearrange, drag the
// sashes to resize. The presets 1 … 3×3 only build a starting layout.
//
// One head per panel (#261): the dock tab stays the drag handle (dockview drags, splits and
// stacks by the tab), and the panel's own head (scope, source, chips, ?, ⚙, ⤢) sits in the
// same row, in the group's left header slot. The slot shows the head of the group's active
// panel. A tab alone in its group shows only grip and number; stacked tabs keep their names.
// Compact mode (phones) keeps the plain tabs and puts the head back into the panel.

import { createCloseButton, createDockview, type DockviewApi, type IContentRenderer, type IHeaderActionsRenderer, type ITabRenderer } from 'dockview-core';

export interface DockHost {
  /** Build (or return) the element for panel idx. */
  element: (idx: number) => HTMLElement;
  /** The head row of panel idx (built with the element); the dock places it. */
  head: (idx: number) => HTMLElement;
  title: (idx: number) => string;
  /** tooltip of the tab (drag handle) */
  tabTitle?: string;
  onLayout: () => void;
}

/** Split a panel title "3 · Waveform" into number and name for the tab. */
export function splitTitle(title: string): [num: string, name: string] {
  const i = title.indexOf(' · ');
  return i < 0 ? ['', title] : [title.slice(0, i), title.slice(i + 3)];
}

/** Dock tab: grip, number and name (the name is hidden by CSS while the tab is alone), close. */
function scopeTab(tip: string): ITabRenderer {
  const num = document.createElement('span'); num.className = 'tnum';
  const name = document.createElement('span'); name.className = 'tname';
  const grip = document.createElement('span'); grip.className = 'tgrip'; grip.setAttribute('aria-hidden', 'true'); grip.textContent = '⠿';
  const content = document.createElement('div'); content.className = 'dv-default-tab-content';
  content.append(grip, num, name);
  const action = document.createElement('div'); action.className = 'dv-default-tab-action'; action.setAttribute('role', 'button'); action.tabIndex = -1;
  const x = createCloseButton(); x.setAttribute('aria-hidden', 'true'); action.append(x);
  const element = document.createElement('div'); element.className = 'dv-default-tab lzs-tab';
  if (tip) element.title = tip;
  element.append(content, action);
  const subs: { dispose(): void }[] = [];
  let closeLabel = (title: string) => title;
  const render = (title: string) => {
    const [n, rest] = splitTitle(title);
    num.textContent = n; name.textContent = n ? ` · ${rest}` : rest;
    action.setAttribute('aria-label', closeLabel(title));
  };
  return {
    element,
    init: (p) => {
      const m = p.containerApi.messages;
      if (m) closeLabel = (title) => m.closeTab(title);
      render(p.title ?? '');
      subs.push(p.api.onDidTitleChange((e) => render(e.title)));
      action.addEventListener('pointerdown', (e) => e.preventDefault());
      action.addEventListener('click', (e) => { e.preventDefault(); p.api.close(); });
    },
    dispose: () => subs.splice(0).forEach((d) => d.dispose()),
  };
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

/** Header icon of each preset (#262): the panel rectangles as [x, y, w, h] in 0 … 1. */
export const PRESET_ICONS: Record<string, [number, number, number, number][]> = {
  l1: [[0, 0, 1, 1]],
  l2: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
  l4: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
  lc: [[0, 0, 0.62, 0.62], [0.62, 0, 0.38, 0.31], [0.62, 0.31, 0.38, 0.31], [0, 0.62, 0.42, 0.38], [0.42, 0.62, 0.38, 0.38], [0.8, 0.62, 0.2, 0.38]],
  l6: [0, 1, 2].flatMap((c) => [0, 1].map((r) => [c / 3, r / 2, 1 / 3, 1 / 2] as [number, number, number, number])),
  l9: [0, 1, 2].flatMap((c) => [0, 1, 2].map((r) => [c / 3, r / 3, 1 / 3, 1 / 3] as [number, number, number, number])),
  l2v: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]],
};

/** Small outline icon of a preset (18 × 12 px, currentColor). */
export function presetIcon(key: string): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg', W = 18, H = 12;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', String(W)); svg.setAttribute('height', String(H));
  svg.setAttribute('aria-hidden', 'true'); svg.classList.add('layicon');
  for (const [x, y, w, h] of PRESET_ICONS[key] ?? PRESET_ICONS.l1) {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', String(x * (W - 1) + 0.5)); r.setAttribute('y', String(y * (H - 1) + 0.5));
    r.setAttribute('width', String(Math.max(1, w * (W - 1)))); r.setAttribute('height', String(Math.max(1, h * (H - 1))));
    r.setAttribute('rx', '1');
    svg.append(r);
  }
  return svg;
}

export const panelId = (idx: number) => `p${idx}`;
export const panelIdx = (id: string) => Number(id.slice(1));

export function createDock(el: HTMLElement, host: DockHost) {
  /** compact mode (see setCompact); read by the renderers below */
  let compact = false, saved: unknown = null;
  /** the head goes back on top of its panel (compact mode) */
  const headIntoPanel = (idx: number) => {
    const panel = host.element(idx), head = host.head(idx);
    if (head.parentElement !== panel) panel.prepend(head);
  };
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
          if (compact) headIntoPanel(idx);
        },
      };
    },
    defaultTabComponent: 'scope',
    createTabComponent: (o) => (o.name === 'scope' ? scopeTab(host.tabTitle ?? '') : undefined),
    // the head of the group's active panel, in the same row as the tabs (#261)
    createLeftHeaderActionComponent: (): IHeaderActionsRenderer => {
      const element = document.createElement('div');
      element.className = 'dock-head';
      const subs: { dispose(): void }[] = [];
      return {
        element,
        init: ({ api: groupApi, group }) => {
          const show = () => {
            const p = group.activePanel;
            if (compact || !p) { element.replaceChildren(); return; }
            element.replaceChildren(host.head(panelIdx(p.id)));
          };
          subs.push(groupApi.onDidActivePanelChange(show));
          show();
        },
        dispose: () => subs.splice(0).forEach((d) => d.dispose()),
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
    /** The tab element of a panel (source identity colour at its edge, #256), null when not docked. */
    tabEl(idx: number): HTMLElement | null { return api.getPanel(panelId(idx))?.view.tab.element ?? null; },
    toggleMaximize(idx: number) {
      const p = api.getPanel(panelId(idx));
      if (!p) return;
      if (p.api.isMaximized()) p.api.exitMaximized(); else p.api.maximize();
    },
    exitMaximized() { if (api.hasMaximizedGroup()) api.exitMaximizedGroup(); },
  };
}
