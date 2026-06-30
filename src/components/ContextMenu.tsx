import React, { useEffect, useRef } from "react";

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
    <div className="context-menu" style={{ left: x, top: y }} ref={ref}>
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
