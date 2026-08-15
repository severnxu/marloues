export const IMAGE_ZOOM_MIN = 25;
export const IMAGE_ZOOM_MAX = 300;
export const IMAGE_ZOOM_STEP = 25;

export function nextImageZoom(
  current: number,
  direction: "in" | "out",
): number {
  const delta = direction === "in" ? IMAGE_ZOOM_STEP : -IMAGE_ZOOM_STEP;
  return Math.min(IMAGE_ZOOM_MAX, Math.max(IMAGE_ZOOM_MIN, current + delta));
}
