import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

interface Item {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: Item[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Start at the click point, then shift up/left after measuring so the whole
  // menu stays on screen (a right-click near the bottom edge was clipping the
  // last items -- e.g. "Delete list" -- off the window). Runs before paint to
  // avoid a visible jump.
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    const nx = x + width > window.innerWidth - margin
      ? Math.max(margin, window.innerWidth - width - margin) : x;
    const ny = y + height > window.innerHeight - margin
      ? Math.max(margin, window.innerHeight - height - margin) : y;
    setPos({ x: nx, y: ny });
  }, [x, y, items.length]);

  useEffect(() => {
    // Only close on a subsequent click outside the menu. We deliberately do NOT
    // listen for "contextmenu" here: that's the same event type that just opened
    // this menu, and React can flush this effect while that very event is still
    // bubbling up to document — which would close the menu instantly on open.
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  return (
    <div className="context-menu" style={{ left: pos.x, top: pos.y }} ref={ref}>
      {items.map((item) => (
        <div
          key={item.label}
          className={`item ${item.danger ? "danger" : ""}`}
          onClick={() => { item.onClick(); onClose(); }}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}
