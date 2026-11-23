import React, { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type RowDragImage = {
  row: HTMLTableRowElement;
  viewport: HTMLElement;
  x: number;
  y: number;
  grabX: number;
  grabY: number;
  preview: HTMLDivElement | null;
};

export function positionRowDragImage(image: RowDragImage) {
  if (!image.preview) return;
  const width = Math.min(image.viewport.clientWidth, window.innerWidth - 16);
  const height = image.preview.offsetHeight;
  const left = Math.max(
    8,
    Math.min(image.x - image.grabX, window.innerWidth - width - 8),
  );
  const top = Math.max(
    8,
    Math.min(image.y - image.grabY - 8, window.innerHeight - height - 8),
  );
  image.preview.style.width = `${width}px`;
  image.preview.style.transform = `translate3d(${left}px, ${top}px, 0)`;
}

export function RowDragPreview({ image }: { image: RowDragImage }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    const source = image.row.closest("table")!;
    const table = document.createElement("table");
    table.className = "mm-table detail-table";
    table.style.width = `${source.getBoundingClientRect().width}px`;
    table.style.marginLeft = `${-image.viewport.scrollLeft}px`;
    const columns = source.querySelector("colgroup");
    if (columns) table.append(columns.cloneNode(true));
    const row = image.row.cloneNode(true) as HTMLTableRowElement;
    row.classList.remove("is-dragging");
    row.removeAttribute("data-row-id");
    row.removeAttribute("data-drop");
    // 属性だけの複製では選択値・編集中の値が一致しないため、現在の表示値を写す。
    const fields = image.row.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >("input,select");
    row
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select")
      .forEach((field, i) => {
        field.value = fields[i].value;
        if (
          field instanceof HTMLInputElement &&
          fields[i] instanceof HTMLInputElement
        )
          field.checked = (fields[i] as HTMLInputElement).checked;
      });
    for (const node of [row, ...row.querySelectorAll<HTMLElement>("*")]) {
      for (const attribute of [
        "id",
        "name",
        "aria-label",
        "aria-labelledby",
        "aria-describedby",
      ])
        node.removeAttribute(attribute);
      if (node.matches("input,select,button,a,[tabindex]")) node.tabIndex = -1;
    }
    table.createTBody().append(row);
    element.append(table);
    image.preview = element;
    positionRowDragImage(image);
    return () => {
      image.preview = null;
      element.replaceChildren();
    };
  }, [image]);
  return createPortal(
    <div ref={ref} className="row-drag-preview" aria-hidden="true" inert />,
    image.row.closest("#app")!,
  );
}
