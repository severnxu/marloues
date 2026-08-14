declare const __MARLOUES_UI_VERSION__: string | undefined;

export const UI_BUILD_VERSION =
  typeof __MARLOUES_UI_VERSION__ === "string" && __MARLOUES_UI_VERSION__
    ? __MARLOUES_UI_VERSION__
    : "0.0.0-dev";
