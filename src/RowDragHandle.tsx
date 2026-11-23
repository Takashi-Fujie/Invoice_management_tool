import React, { useEffect, useRef, useState } from "react";
import { RowDragPreview, positionRowDragImage } from "./RowDragPreview";
import type { RowDragImage } from "./RowDragPreview";

type Gesture = RowDragImage & {
  pointerId: number;
  handle: HTMLButtonElement;
  row: HTMLTableRowElement;
  body: HTMLTableSectionElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  target: number | null;
  frame: number;
};

export function RowDragHandle({
  companyName,
  index,
  count,
  disabled,
  onMove,
  onDragChange,
}: {
  companyName: string;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (target: number) => void;
  onDragChange: (target: number | null | undefined) => void;
}) {
  const gesture = useRef<Gesture | null>(null);
  const [image, setImage] = useState<Gesture | null>(null);
  const changed = useRef(onDragChange);
  changed.current = onDragChange;
  const locked = disabled || count < 2;
  function finish(commit: boolean) {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    setImage(null);
    cancelAnimationFrame(g.frame);
    if (g.handle.hasPointerCapture(g.pointerId))
      g.handle.releasePointerCapture(g.pointerId);
    changed.current(undefined);
    if (commit && g.active && g.target !== null && g.target !== index)
      onMove(g.target);
  }
  useEffect(() => {
    if (locked) finish(false);
  }, [locked]);
  useEffect(() => () => finish(false), []);
  function target(g: Gesture) {
    if (!g.active) return;
    const viewport = g.viewport.getBoundingClientRect();
    const workspace = g.handle.closest(".workspace")!.getBoundingClientRect();
    const sourceCompany = g.row.closest(".company-card");
    const hoveredCompany = document
      .elementFromPoint(g.x, g.y)
      ?.closest(".company-card");
    const next =
      g.x < viewport.left ||
      g.x > viewport.right ||
      g.y < workspace.top ||
      g.y > workspace.bottom ||
      (hoveredCompany && hoveredCompany !== sourceCompany)
        ? null
        : Array.from(g.body.rows)
            .filter((row) => row !== g.row)
            .reduce((position, row) => {
              const rect = row.getBoundingClientRect();
              return position + (g.y >= rect.top + rect.height / 2 ? 1 : 0);
            }, 0);
    if (next !== g.target) {
      g.target = next;
      changed.current(next);
    }
  }
  function scroll() {
    const g = gesture.current;
    if (!g) return;
    const workspace = g.handle.closest<HTMLElement>(".workspace");
    if (g.active && workspace) {
      const bounds = workspace.getBoundingClientRect();
      if (g.x >= bounds.left && g.x <= bounds.right) {
        const delta =
          g.y < bounds.top + 32 ? -10 : g.y > bounds.bottom - 32 ? 10 : 0;
        if (delta) {
          workspace.scrollTop += delta;
          target(g);
        }
      }
    }
    positionRowDragImage(g);
    g.frame = requestAnimationFrame(scroll);
  }
  return (
    <>
      <span className="row-order">
        <span>{index + 1}</span>
        <button
          type="button"
          className="drag-row icon-button"
          disabled={locked}
          title="ドラッグして並び替え（上下キーでも移動できます）"
          aria-label={`${companyName}の${index + 1}行目をドラッグして並び替え`}
          aria-describedby="detail-reorder-help"
          onPointerDown={(e) => {
            if (locked || e.button !== 0 || gesture.current) return;
            const row = e.currentTarget.closest("tr")!;
            const body = row.parentElement as HTMLTableSectionElement;
            const viewport = row.closest<HTMLElement>(".detail-scroll")!;
            e.currentTarget.setPointerCapture(e.pointerId);
            gesture.current = {
              pointerId: e.pointerId,
              handle: e.currentTarget,
              row,
              body,
              viewport,
              grabX: e.clientX - viewport.getBoundingClientRect().left,
              grabY: e.clientY - row.getBoundingClientRect().top,
              preview: null,
              startX: e.clientX,
              startY: e.clientY,
              x: e.clientX,
              y: e.clientY,
              active: false,
              target: index,
              frame: 0,
            };
            changed.current(index);
            scroll();
          }}
          onPointerMove={(e) => {
            const g = gesture.current;
            if (!g || g.pointerId !== e.pointerId) return;
            g.x = e.clientX;
            g.y = e.clientY;
            if (!g.active && Math.hypot(g.x - g.startX, g.y - g.startY) >= 4) {
              g.active = true;
              setImage(g);
            }
            positionRowDragImage(g);
            target(g);
          }}
          onPointerUp={(e) => {
            const g = gesture.current;
            if (g?.pointerId === e.pointerId) {
              g.x = e.clientX;
              g.y = e.clientY;
              target(g);
              finish(!locked);
            }
          }}
          onPointerCancel={() => finish(false)}
          onLostPointerCapture={() => finish(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              finish(false);
            }
            if (
              !locked &&
              !gesture.current &&
              ["ArrowUp", "ArrowDown"].includes(e.key)
            ) {
              e.preventDefault();
              const next = index + (e.key === "ArrowUp" ? -1 : 1);
              if (next >= 0 && next < count) onMove(next);
            }
          }}
        >
          <svg
            width="14"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            {[6, 12, 18].flatMap((y) =>
              [8, 16].map((x) => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" />
              )),
            )}
          </svg>
        </button>
      </span>
      {image && <RowDragPreview image={image} />}
    </>
  );
}
