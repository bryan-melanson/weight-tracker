/* Tabs: one panel of a group visible at a time.

   Used twice — for the charts and the table below the range filter, and for
   the two settings forms — so the page is a screen rather than a scroll.

   The markup is the ARIA tabs pattern: a tablist of buttons, each owning one
   panel, with a roving tabindex so the group is one stop in the tab order and
   the arrow keys move within it. Panels are hidden with the `hidden`
   attribute, which app.css makes win over any display rule, so a hidden panel
   is really gone — nothing in it is focusable or read out.

   Buttons are built here rather than written into index.html so that the tab
   labels and the panels they control cannot drift apart. */

const KEY_STEP = { ArrowRight: 1, ArrowLeft: -1 };

export function mountTabs({ list, tabs, storage = null, storageKey = null, onSelect = null }) {
  const stored = storage && storageKey ? storage.getItem(storageKey) : null;
  let current = tabs.some((tab) => tab.key === stored) ? stored : tabs[0].key;

  const buttons = tabs.map((tab) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `tab-${tab.key}`;
    button.textContent = tab.label;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', tab.panel.id);
    tab.panel.setAttribute('role', 'tabpanel');
    tab.panel.setAttribute('aria-labelledby', button.id);
    button.addEventListener('click', () => select(tab.key));
    return button;
  });

  list.setAttribute('role', 'tablist');
  list.replaceChildren(...buttons);

  /* The arrow keys wrap, and focus follows selection: with one panel per tab
     and nothing expensive behind any of them, arriving on a tab and showing
     it are the same action. */
  list.addEventListener('keydown', (event) => {
    const step = KEY_STEP[event.key];
    const index = tabs.findIndex((tab) => tab.key === current);
    let next = null;
    if (step) next = (index + step + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    select(tabs[next].key);
    buttons[next].focus();
  });

  function paint() {
    tabs.forEach((tab, index) => {
      const selected = tab.key === current;
      buttons[index].setAttribute('aria-selected', String(selected));
      // Only the selected tab is a tab stop; the arrows reach the others.
      buttons[index].tabIndex = selected ? 0 : -1;
      tab.panel.hidden = !selected;
    });
  }

  function select(key) {
    if (!tabs.some((tab) => tab.key === key)) return;
    const changed = key !== current;
    current = key;
    paint();
    if (storage && storageKey) storage.setItem(storageKey, key);
    // After painting, so a listener that measures the panel sees it laid out.
    if (onSelect) onSelect(key, { changed });
  }

  paint();
  if (onSelect) onSelect(current, { changed: false });

  return {
    select,
    selected: () => current,
  };
}
