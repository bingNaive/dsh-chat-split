export type SnapLayoutId = 'columns' | 'wide-left' | 'wide-right' | 'three-columns' | 'left-stack' | 'grid';

export interface SnapRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }
export interface SnapTarget { readonly layout: SnapLayoutId; readonly slot: number; }
export interface SnapPlacement { readonly layout: SnapLayoutId; readonly slots: readonly (string | null)[]; }
export interface SnapLayout { readonly id: SnapLayoutId; readonly cells: readonly SnapRect[]; }

export const SNAP_LAYOUTS: readonly SnapLayout[] = [
  { id: 'columns', cells: [{ x: 0, y: 0, width: .5, height: 1 }, { x: .5, y: 0, width: .5, height: 1 }] },
  { id: 'wide-left', cells: [{ x: 0, y: 0, width: 2 / 3, height: 1 }, { x: 2 / 3, y: 0, width: 1 / 3, height: 1 }] },
  { id: 'wide-right', cells: [{ x: 0, y: 0, width: 1 / 3, height: 1 }, { x: 1 / 3, y: 0, width: 2 / 3, height: 1 }] },
  { id: 'three-columns', cells: [{ x: 0, y: 0, width: 1 / 3, height: 1 }, { x: 1 / 3, y: 0, width: 1 / 3, height: 1 }, { x: 2 / 3, y: 0, width: 1 / 3, height: 1 }] },
  { id: 'left-stack', cells: [{ x: 0, y: 0, width: .5, height: 1 }, { x: .5, y: 0, width: .5, height: .5 }, { x: .5, y: .5, width: .5, height: .5 }] },
  { id: 'grid', cells: [{ x: 0, y: 0, width: .5, height: .5 }, { x: .5, y: 0, width: .5, height: .5 }, { x: 0, y: .5, width: .5, height: .5 }, { x: .5, y: .5, width: .5, height: .5 }] },
];

export function getSnapLayout(id: SnapLayoutId): SnapLayout {
  return SNAP_LAYOUTS.find(layout => layout.id === id)!;
}

export function isSnapTarget(value: SnapTarget): boolean {
  const layout = SNAP_LAYOUTS.find(layout => layout.id === value.layout);
  return layout !== undefined && Number.isInteger(value.slot) && value.slot >= 0 && value.slot < layout.cells.length;
}
