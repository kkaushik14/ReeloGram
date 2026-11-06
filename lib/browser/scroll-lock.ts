type Lock = { count: number; restore: () => void };
const locks = new WeakMap<Document, Lock>();

function preserveStyles(element: HTMLElement, properties: string[]) {
  const saved = properties.map((property) => [
    property,
    element.style.getPropertyValue(property),
    element.style.getPropertyPriority(property),
  ]);
  return () => {
    for (const [property, value, priority] of saved) {
      if (value) element.style.setProperty(property, value, priority);
      else element.style.removeProperty(property);
    }
  };
}

/** Fixed-body locking also prevents background touch scrolling on iOS.
 * Each overlay owns a release handle; nested/out-of-order closes cannot unlock
 * the page while another overlay is still open. No touch events are cancelled,
 * so the dialog's own scroll containers and video controls remain usable. */
export function lockPageScroll(document: Document) {
  let lock = locks.get(document);
  if (!lock) {
    const view = document.defaultView;
    if (!view) return () => {};
    const root = document.documentElement;
    const body = document.body;
    const x = view.scrollX;
    const y = view.scrollY;
    const gap = Math.max(0, view.innerWidth - root.clientWidth);
    const padding = parseFloat(view.getComputedStyle(body).paddingRight) || 0;
    const restoreRoot = preserveStyles(root, [
      "overflow",
      "overscroll-behavior",
    ]);
    const restoreBody = preserveStyles(body, [
      "position",
      "top",
      "left",
      "width",
      "overflow",
      "padding-right",
    ]);
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    body.style.position = "fixed";
    body.style.top = `${-y}px`;
    body.style.left = `${-x}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    if (gap) body.style.paddingRight = `${padding + gap}px`;
    lock = {
      count: 0,
      restore: () => {
        restoreBody();
        restoreRoot();
        // The site's smooth-scroll preference must not animate back from zero.
        view.scrollTo({ left: x, top: y, behavior: "instant" });
      },
    };
    locks.set(document, lock);
  }
  lock.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lock.count === 0) {
      locks.delete(document);
      lock.restore();
    }
  };
}
