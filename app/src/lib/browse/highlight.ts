/** Literal content terms from an Anki query. Search operators and filters are not text. */
export function searchTerms(query: string): string[] {
  const ignored = /^(?:added|edited|deck|note|tag|mid|nid|cid|card|is|flag|rated|dupe|prop|seen|rid|re|nc|introduced|resched):/i;
  const tokens: string[] = [];
  let token = "", quote = "", escaped = false;
  for (const char of query.normalize("NFC")) {
    if (escaped) { token += char; escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ""; else token += char; continue; }
    if ((char === '"' || char === "'") && (!token || token.endsWith(":"))) { quote = char; continue; }
    if (/\s|[()]/u.test(char)) { if (token) tokens.push(token); token = ""; continue; }
    token += char;
  }
  if (token) tokens.push(token);
  return [...new Set(tokens.filter((part) => !/^(?:or|and|\+)$|^-/i.test(part) && !ignored.test(part))
    .map((part) => part.includes(":") ? part.slice(part.indexOf(":") + 1) : part)
    .map((part) => part.replace(/^[",*;]+|[",*;]+$/g, ""))
    .filter((part) => part.length > 0 && part !== "_"))];
}

/** Paint text ranges without inserting marks into saved note HTML or changing the caret. */
export function highlightEditor(frame: HTMLIFrameElement, getTerms: () => string[]): () => void {
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  // CSS Custom Highlight is absent on older webviews. Editing must keep working there.
  const api = win as unknown as {
    CSS?: { highlights?: Map<string, unknown> };
    Highlight?: new (...ranges: Range[]) => unknown;
    MutationObserver: typeof MutationObserver;
  };
  if (!doc || !api?.CSS?.highlights || !api.Highlight) return () => {};
  const registry = api.CSS.highlights;
  const Highlight = api.Highlight;
  const roots = new Map<Document | ShadowRoot, HTMLStyleElement>();
  let timer: ReturnType<typeof setTimeout>;
  const observer = new api.MutationObserver(() => { clearTimeout(timer); timer = setTimeout(paint, 100); });
  function paint() {
    // Note type changes can replace field roots. Retain and observe only live ones.
    observer.disconnect();
    for (const [root, style] of roots) {
      if (!root.isConnected) { style.remove(); roots.delete(root); }
    }
    const terms = getTerms().map((term) => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"));
    const ranges: Range[] = [];
    function scan(root: Document | ShadowRoot) {
      if (!roots.has(root)) {
        const style = doc!.createElement("style");
        style.textContent = "::highlight(klaus-search) { background: Highlight; color: HighlightText; }";
        (root.nodeType === 9 ? doc!.head : root).appendChild(style);
        roots.set(root, style);
      }
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) scan(element.shadowRoot);
      }
      for (const field of root.querySelectorAll('[contenteditable="true"]')) {
        const walker = doc!.createTreeWalker(field, 4);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (node.parentElement?.closest("script, style")) continue;
          const text = node.textContent ?? "";
          for (const term of terms) {
            for (const match of text.matchAll(term)) {
              const range = doc!.createRange();
              range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
              ranges.push(range);
            }
          }
        }
      }
    }
    scan(doc!);
    for (const root of roots.keys()) observer.observe(root, { childList: true, subtree: true, characterData: true });
    registry.set("klaus-search", new Highlight(...ranges));
  }
  paint();
  // Search/toggle changes replace this controller, while mutations refresh the current note.
  return () => { clearTimeout(timer); observer.disconnect(); registry.delete("klaus-search"); roots.forEach((style) => style.remove()); roots.clear(); };
}
