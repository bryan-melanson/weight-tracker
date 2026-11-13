/* The few DOM calls static/js/tabs.js makes, and nothing else.

   The frontend suite runs under plain node with no dependencies, so a module
   that touches the DOM is normally left to the browser. Tabs are worth the
   stub: which panel is hidden, which button is the tab stop and what the
   arrow keys do is logic, not appearance, and all of it is wrong silently. */

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.textContent = '';
    this.hidden = false;
    this.tabIndex = 0;
    this.id = '';
    this.focused = false;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  replaceChildren(...nodes) {
    this.children = nodes;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    this.listeners.set(type, [...handlers, handler]);
  }

  /* Dispatch is deliberately not a real DOM event: no bubbling, no default
     to prevent beyond recording that it was asked for. */
  dispatch(type, detail = {}) {
    const event = { type, defaultPrevented: false, ...detail };
    event.preventDefault = () => { event.defaultPrevented = true; };
    (this.listeners.get(type) || []).forEach((handler) => handler(event));
    return event;
  }

  click() {
    return this.dispatch('click');
  }

  focus() {
    this.focused = true;
  }
}

export function installMiniDom() {
  globalThis.document = { createElement: (tag) => new Element(tag) };
}

export function element(id = '') {
  const node = new Element('div');
  node.id = id;
  return node;
}

/* A storage stand-in with the two methods tabs.js uses. */
export function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
  };
}
