import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { element, installMiniDom, memoryStorage } from './helpers/mini-dom.js';

installMiniDom();
const { mountTabs } = await import('../../static/js/tabs.js');

const group = (keys = ['one', 'two', 'three']) => ({
  list: element('group-tabs'),
  tabs: keys.map((key) => ({ key, label: key.toUpperCase(), panel: element(`panel-${key}`) })),
});

const selected = (tabs) => tabs.filter((tab) => !tab.panel.hidden).map((tab) => tab.key);

describe('mountTabs', () => {
  let list;
  let tabs;

  beforeEach(() => {
    ({ list, tabs } = group());
  });

  it('builds one button per tab, wired to its panel', () => {
    mountTabs({ list, tabs });
    assert.equal(list.getAttribute('role'), 'tablist');
    assert.deepEqual(list.children.map((button) => button.textContent), ['ONE', 'TWO', 'THREE']);
    list.children.forEach((button, index) => {
      assert.equal(button.getAttribute('role'), 'tab');
      assert.equal(button.getAttribute('aria-controls'), tabs[index].panel.id);
      assert.equal(tabs[index].panel.getAttribute('aria-labelledby'), button.id);
      assert.equal(tabs[index].panel.getAttribute('role'), 'tabpanel');
    });
  });

  it('opens the first tab and hides the rest', () => {
    mountTabs({ list, tabs });
    assert.deepEqual(selected(tabs), ['one']);
    assert.deepEqual(
      list.children.map((button) => button.getAttribute('aria-selected')),
      ['true', 'false', 'false'],
    );
  });

  it('shows exactly one panel whatever is clicked', () => {
    mountTabs({ list, tabs });
    list.children[2].click();
    assert.deepEqual(selected(tabs), ['three']);
    list.children[1].click();
    assert.deepEqual(selected(tabs), ['two']);
  });

  it('keeps the group to one stop in the tab order', () => {
    mountTabs({ list, tabs });
    assert.deepEqual(list.children.map((button) => button.tabIndex), [0, -1, -1]);
    list.children[1].click();
    assert.deepEqual(list.children.map((button) => button.tabIndex), [-1, 0, -1]);
  });

  it('walks the tabs with the arrow keys, wrapping at each end', () => {
    const tabsApi = mountTabs({ list, tabs });
    list.dispatch('keydown', { key: 'ArrowRight' });
    assert.equal(tabsApi.selected(), 'two');
    list.dispatch('keydown', { key: 'ArrowLeft' });
    list.dispatch('keydown', { key: 'ArrowLeft' });
    assert.equal(tabsApi.selected(), 'three', 'wraps backwards past the first');
    list.dispatch('keydown', { key: 'ArrowRight' });
    assert.equal(tabsApi.selected(), 'one', 'wraps forwards past the last');
  });

  it('jumps to the ends with Home and End', () => {
    const tabsApi = mountTabs({ list, tabs });
    list.dispatch('keydown', { key: 'End' });
    assert.equal(tabsApi.selected(), 'three');
    list.dispatch('keydown', { key: 'Home' });
    assert.equal(tabsApi.selected(), 'one');
  });

  it('moves focus with the selection, so the open tab is the focused one', () => {
    mountTabs({ list, tabs });
    list.dispatch('keydown', { key: 'ArrowRight' });
    assert.deepEqual(list.children.map((button) => button.focused), [false, true, false]);
  });

  it('claims the key it handles and leaves the others alone', () => {
    mountTabs({ list, tabs });
    assert.equal(list.dispatch('keydown', { key: 'ArrowRight' }).defaultPrevented, true);
    assert.equal(list.dispatch('keydown', { key: 'Enter' }).defaultPrevented, false);
    assert.equal(list.dispatch('keydown', { key: 'a' }).defaultPrevented, false);
  });

  it('remembers the open tab', () => {
    const storage = memoryStorage();
    mountTabs({ list, tabs, storage, storageKey: 'view' });
    list.children[1].click();
    assert.equal(storage.getItem('view'), 'two');

    const reopened = group();
    const tabsApi = mountTabs({ ...reopened, storage, storageKey: 'view' });
    assert.equal(tabsApi.selected(), 'two');
    assert.deepEqual(selected(reopened.tabs), ['two']);
  });

  it('falls back to the first tab when the stored one is gone', () => {
    const storage = memoryStorage({ view: 'removed-in-a-later-version' });
    const tabsApi = mountTabs({ list, tabs, storage, storageKey: 'view' });
    assert.equal(tabsApi.selected(), 'one');
  });

  it('reports the opening tab, then every change', () => {
    const opened = [];
    const tabsApi = mountTabs({
      list,
      tabs,
      onSelect: (key, { changed }) => opened.push([key, changed]),
    });
    tabsApi.select('three');
    tabsApi.select('three');
    assert.deepEqual(opened, [
      ['one', false],
      ['three', true],
      ['three', false],
    ]);
  });

  it('ignores a key no tab answers to', () => {
    const tabsApi = mountTabs({ list, tabs });
    tabsApi.select('nothing-like-it');
    assert.equal(tabsApi.selected(), 'one');
    assert.deepEqual(selected(tabs), ['one']);
  });
});
