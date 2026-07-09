// A single offscreen canvas reused for measuring select text, so each
// dropdown's closed box can be sized to its current label instead of
// stretching to the width of its widest option (native <select> behavior).
let measureCtx: CanvasRenderingContext2D | null | undefined;

function textWidth(text: string): number {
  if (measureCtx === undefined) {
    measureCtx = document.createElement("canvas").getContext("2d");
    if (measureCtx) measureCtx.font = "12px -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  }
  return measureCtx ? measureCtx.measureText(text).width : text.length * 7;
}

/** Width (px) a closed <select> should be so it just fits `label`, with room
 *  for padding/border/the native dropdown arrow. The open dropdown itself
 *  still renders at the width of its widest option -- only the closed box is sized. */
export function selectWidth(label: string): number {
  return Math.ceil(textWidth(label)) + 34;
}
