export function workflowImageSource(value: string): string {
  const source = value.trim();
  if (!source) return "";
  if (/^(?:file|https?):/i.test(source) || /^data:image\//i.test(source)) {
    return source;
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(source) && source.length > 120) {
    return `data:image/png;base64,${source.replace(/\s/g, "")}`;
  }
  return localImageSource(source);
}

function localImageSource(path: string): string {
  return `file:///${path.replace(/\\/g, "/")}`;
}
