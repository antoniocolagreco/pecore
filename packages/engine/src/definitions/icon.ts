const attributes: Record<string, RegExp> = {
  xmlns: /^http:\/\/www\.w3\.org\/2000\/svg$/,
  viewBox: /^-?[\d.]+(?:[ ,]+-?[\d.]+){3}$/,
  fill: /^(?:none|currentColor|black|white|#[0-9a-fA-F]{3,8})$/,
  stroke: /^(?:none|currentColor|black|white|#[0-9a-fA-F]{3,8})$/,
  "stroke-width": /^[\d.]+$/,
  "stroke-linecap": /^(?:butt|round|square)$/,
  "stroke-linejoin": /^(?:miter|round|bevel)$/,
  "fill-rule": /^(?:nonzero|evenodd)$/,
  d: /^[\d.eE+ ,MmZzLlHhVvCcSsQqTtAa-]+$/,
  points: /^[\d.eE+ ,-]+$/,
  cx: /^-?[\d.]+$/,
  cy: /^-?[\d.]+$/,
  r: /^[\d.]+$/,
  x: /^-?[\d.]+$/,
  y: /^-?[\d.]+$/,
  width: /^[\d.]+$/,
  height: /^[\d.]+$/,
  rx: /^[\d.]+$/,
  ry: /^[\d.]+$/,
  x1: /^-?[\d.]+$/,
  y1: /^-?[\d.]+$/,
  x2: /^-?[\d.]+$/,
  y2: /^-?[\d.]+$/,
};

function readAttributes(source: string): Map<string, string> | undefined {
  const values = new Map<string, string>();
  const attribute: RegExp = /\s+([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
  const input: string = source.trimEnd();
  while (attribute.lastIndex < input.length) {
    const match: RegExpExecArray | null = attribute.exec(input);
    if (!match) return;
    const name: string = match[1]!;
    const value: string = match[2] ?? match[3]!;
    if (values.has(name) || !Object.hasOwn(attributes, name) || !attributes[name]!.test(value)) return;
    values.set(name, value);
  }
  return values;
}

export function validIcon(svg: string): boolean {
  if (svg.length > 16_384) return false;
  const document: RegExpExecArray | null = /^<svg([^<>]*)>([\s\S]*)<\/svg>$/.exec(svg.trim());
  if (!document) return false;
  const root: Map<string, string> | undefined = readAttributes(document[1]!);
  if (!root?.has("xmlns") || !root.has("viewBox")) return false;
  const viewBox: number[] = root.get("viewBox")!.split(/[ ,]+/).map(Number);
  if (!viewBox.every(Number.isFinite) || viewBox[2]! <= 0 || viewBox[3]! <= 0) return false;
  const shape: RegExp = /\s*<(path|circle|rect|line|polyline|polygon|ellipse)([^<>]*)\/\s*>/y;
  const body: string = document[2]!.trim();
  if (!body) return false;
  while (shape.lastIndex < body.length) {
    const match: RegExpExecArray | null = shape.exec(body);
    if (!match || !readAttributes(match[2]!)) return false;
  }
  return true;
}
