import { useLayoutEffect, useRef } from 'react';

/**
 * The highlight behind the chosen item (a tab, a sidebar entry) that slides to the new one instead
 * of jumping. Put it inside the list, which must be `position: relative`; it follows whichever item
 * matches `selector`, also when items move, wrap or resize.
 */
export function SlidingHighlight({ selector, className }: { selector: string; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const pill = ref.current;
    const list = pill?.parentElement;
    if (!pill || !list) return;
    let placed = false;
    const place = () => {
      const target = list.querySelector<HTMLElement>(selector);
      if (!target) {
        pill.style.opacity = '0';
        placed = false;
        return;
      }
      pill.style.opacity = '1';
      // The first time (and after nothing was chosen) it appears in place rather than sliding in.
      if (!placed) pill.style.transition = 'none';
      pill.style.width = `${target.offsetWidth}px`;
      pill.style.height = `${target.offsetHeight}px`;
      pill.style.transform = `translate(${target.offsetLeft}px, ${target.offsetTop}px)`;
      if (!placed) {
        void pill.offsetWidth;
        pill.style.transition = '';
        placed = true;
      }
    };
    place();
    const moved = new MutationObserver(place);
    moved.observe(list, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-selected', 'aria-current'],
    });
    const resized = new ResizeObserver(place);
    resized.observe(list);
    return () => {
      moved.disconnect();
      resized.disconnect();
    };
  }, [selector]);
  return <span ref={ref} className={className} aria-hidden="true" />;
}
