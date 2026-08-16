import { describe, expect, it } from "vitest";
import {
  IMAGE_ZOOM_MAX,
  IMAGE_ZOOM_MIN,
  nextImageZoom,
} from "../../../../../../../client/renderer/src/components/workflow-chat/activity/image-lightbox-model";

describe("image lightbox zoom", () => {
  it("moves in fixed 25 percent steps", () => {
    expect(nextImageZoom(100, "in")).toBe(125);
    expect(nextImageZoom(100, "out")).toBe(75);
  });

  it("clamps zoom to the supported range", () => {
    expect(nextImageZoom(IMAGE_ZOOM_MAX, "in")).toBe(IMAGE_ZOOM_MAX);
    expect(nextImageZoom(IMAGE_ZOOM_MIN, "out")).toBe(IMAGE_ZOOM_MIN);
  });
});
