import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';

const hostCss = [
  './src/style.css', './src/feed.css', './src/preview.css', './src/practice.css',
  './src/practice-player.css', './src/practice-timeline.css',
  './src/music/workspace/workspace.css', './src/practice/practice-runtime.css',
  './src/practice/experience-mode.css', './src/practice/practice-checkbox-menu.css',
].map(file => readFileSync(file, 'utf8'));
const tokenSource = readFileSync('./src/ui/tokens.css', 'utf8');
const tokenValues = new Map([...tokenSource.matchAll(/--([\w-]+):\s*([^;]+);/g)]
  .map(match => [match[1], match[2].trim()]));
// JSDOM does not resolve CSS custom properties in computed style. Resolve the
// bounded UI token set for this fixture only; production keeps the variables.
const resolveUiVariables = (css: string) => css.replace(/var\(--([\w-]+)\)/g,
  (match, name: string) => tokenValues.get(name) ?? match);
const uiCss = ['./src/ui/tokens.css', './src/ui/controls.css']
  .map(file => resolveUiVariables(readFileSync(file, 'utf8')));

function makeDom(order: 'ui-first' | 'host-first') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/', pretendToBeVisual: true});
  const w = dom.window;
  Object.assign(globalThis, {
    window: w as unknown as Window & typeof globalThis,
    document: w.document,
    HTMLElement: w.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (cb: FrameRequestCallback) => { cb(Date.now()); return 0; },
    cancelAnimationFrame: () => {},
  });
  for (const css of (order === 'ui-first' ? [...uiCss, ...hostCss] : [...hostCss, ...uiCss])) {
    const style = w.document.createElement('style');
    style.textContent = css;
    w.document.head.append(style);
  }
  return dom;
}

const React = await import('react');
const {createRoot} = await import('react-dom/client');
const {Button, Select} = await import('../src/ui/controls.tsx');
const {PracticePrimaryActions} = await import('../src/practice/PracticePrimaryActions.tsx');
const {PracticeCheckboxMenu} = await import('../src/practice/PracticeCheckboxMenu.tsx');
const {SettingsChoices} = await import('../src/PracticeSettings.tsx');
const {FeedCard} = await import('../src/FeedCard.tsx');
const {PracticePanel} = await import('../src/PracticePanel.tsx');

const primary = {id: 'start' as const, label: 'Start practice'};
const secondary = [{id: 'repeat-section' as const, label: 'Repeat section'}];
const options = [{value: 'notes' as const, label: 'Notes'}, {value: 'keyboard' as const, label: 'Piano keys'}];

function renderSurface(hostClass: string, surface: string, onToggle: (value: string) => void = () => {}) {
  return React.createElement('div', {className: hostClass, 'data-ui-surface': surface},
    React.createElement('div', {className: 'practice-player-dock'},
      React.createElement('div', {className: 'practice-player-actions'},
        React.createElement(PracticePrimaryActions, {primary, secondary, onCommand: () => {}})),
      React.createElement('div', {className: 'practice-player-tools'},
        React.createElement(Button, {variant: 'dock-tool', className: 'player-tool'}, 'Tool'),
        React.createElement(Button, {variant: 'dock-tool', className: 'dock-disabled', disabled: true}, 'Disabled tool'),
        React.createElement(Select, {variant: 'dock-source', className: 'ws-practice-source-select', defaultValue: 'original'},
          React.createElement('option', {value: 'original'}, 'Original')),
        React.createElement(PracticeCheckboxMenu, {label: 'View', options, selected: [], onToggle})),
      React.createElement(SettingsChoices, {label: 'Rate', value: 1,
        options: [{value: 0.5, label: '0.5×'}, {value: 1, label: '1×'}], onChange: () => {}})),
    React.createElement('div', {className: 'lesson-watch'},
      React.createElement(Button, {variant: 'watch-cta', className: 'watch-practice'}, 'Practice')),
    React.createElement('div', {className: 'feed-app'},
      React.createElement(Button, {variant: 'app-primary'}, 'Primary'),
      React.createElement(Button, {variant: 'app-primary', className: 'app-disabled', disabled: true}, 'Disabled primary'),
      React.createElement(Button, {variant: 'feed-chip', 'aria-pressed': true}, 'All')));
}

const styleOf = (w: Window, element: Element | null) => {
  assert.ok(element, 'control exists');
  const style = w.getComputedStyle(element);
  return {
    height: style.height, minHeight: style.minHeight, padding: style.padding,
    radius: style.borderRadius, fontSize: style.fontSize, background: style.backgroundColor,
    opacity: style.opacity, maxWidth: style.maxWidth,
  };
};

test('responsive source guards preserve final feed drawer, nav, CTA and speed rules', () => {
  const controls = readFileSync('./src/ui/controls.css', 'utf8');
  const feed = readFileSync('./src/feed.css', 'utf8');
  const preview = readFileSync('./src/preview.css', 'utf8');
  assert.match(feed, /\.feed-sidebar-toggle\{display:grid;width:36px;min-height:44px\}/,
    'final mobile drawer hamburger rule');
  assert.match(feed, /\.feed-header-actions \.feed-sign-in\{padding:0 10px;min-height:38px\}/,
    'final mobile sign-in rule');
  assert.match(feed, /\.feed-app\.navigation-overlay \.nav-item\.active\{background:#eaf0e0\}/,
    'drawer active nav rule');
  const media760 = controls.slice(controls.indexOf('@media (max-width: 760px)'), controls.indexOf('@media (max-width: 600px)'));
  assert.match(media760, /feed-sidebar-toggle \{ display: grid; width: 36px; min-height: 44px; \}/);
  assert.match(media760, /feed-sign-in \{ min-height: 38px; padding: 0 10px; \}/);
  assert.match(media760, /feed-thumbnail \{ border-radius: 12px; \}/);
  assert.match(media760, /\.feed-app\[data-ui-surface="app"\]\.navigation-overlay \.ui-btn\.ui-btn--nav\[aria-current="page"\]/);
  assert.doesNotMatch(media760, /practice-player-tools \.ui-btn\.player-speed/);
  assert.doesNotMatch(media760, /watch-cta/, 'watch CTA must not change at 700px');
  const media600 = controls.slice(controls.indexOf('@media (max-width: 600px)'), controls.indexOf('@media (max-width: 599px)'));
  assert.match(media600, /watch-cta \{ padding: 0 18px; margin-left: auto; \}/);
  const media599 = controls.slice(controls.indexOf('@media (max-width: 599px)'));
  assert.match(media599, /practice-player-tools \.ui-btn\.player-speed \{ display: none; \}/);
  assert.match(controls, /\.feed-app\[data-ui-surface\]\.sidebar-compact \.ui-btn\.ui-btn--nav/);
  assert.match(preview, /@media\(max-width:600px\)/, 'watch CTA source breakpoint remains 600px');
  assert.match(feed, /@media\(max-width:760px\)/, 'feed mobile breakpoint remains 760px');

  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const doc = dom.window.document;
  const root = doc.createElement('div');
  root.className = 'app feed-app navigation-overlay';
  root.setAttribute('data-ui-surface', 'app');
  const nav = doc.createElement('button');
  nav.className = 'ui-btn ui-btn--nav nav-item active';
  nav.setAttribute('aria-current', 'page');
  root.append(nav);
  doc.body.append(root);
  assert.ok(root.matches('.feed-app[data-ui-surface="app"].navigation-overlay'));
  assert.ok(nav.matches('.feed-app[data-ui-surface="app"].navigation-overlay .ui-btn.ui-btn--nav'));
  dom.window.close();
});
test('native control variants keep their current geometry through host cascade and nesting', async () => {
  for (const order of ['ui-first', 'host-first'] as const) {
    const dom = makeDom(order);
    const w = dom.window;
    const hostClasses = [
      'mimic-shell mimic-immersive',
      'practice-runtime-shell ws-shell ws-shell-focused piano-practice-shell mimic-shell mimic-immersive minimal-practice',
    ];
    for (const hostClass of hostClasses) {
      const host = w.document.createElement('div');
      host.className = hostClass;
      w.document.body.append(host);
      const mount = w.document.createElement('div');
      host.append(mount);
      const root = createRoot(mount);
      await React.act(async () => root.render(renderSurface('', 'practice')));
      const dock = host.querySelector('.practice-player-dock')!;
      const primaryStyle = styleOf(w, dock.querySelector('.practice-player-primary'));
      assert.equal(primaryStyle.minHeight, '40px', `${order} primary height`);
      assert.equal(primaryStyle.padding, '8px 14px', `${order} primary padding`);
      assert.equal(primaryStyle.radius, '9px');
      assert.match(primaryStyle.background, /rgb\(216, 237, 155\)/);
      const toolStyle = styleOf(w, dock.querySelector('.player-tool'));
      assert.equal(toolStyle.minHeight, '44px');
      assert.equal(toolStyle.padding, '8px 10px');
      const source = styleOf(w, dock.querySelector('.ws-practice-source-select'));
      assert.equal(source.height, '34px');
      assert.equal(source.padding, '0px 24px 0px 8px');
      assert.equal(source.maxWidth, '112px');
      const trigger = dock.querySelector('.practice-checkbox-menu-trigger')!;
      const triggerStyle = styleOf(w, trigger);
      assert.equal(triggerStyle.height, '34px');
      assert.equal(triggerStyle.padding, '0px 24px 0px 8px');
      const choice = styleOf(w, dock.querySelector('.settings-choices .ui-btn'));
      assert.equal(choice.minHeight, '44px');
      assert.equal(choice.radius, '10px');
      const cta = styleOf(w, host.querySelector('.watch-practice'));
      assert.equal(cta.minHeight, '38px');
      assert.equal(cta.radius, '22px');
      assert.equal(styleOf(w, host.querySelector('.app-disabled')).opacity, '0.4');
      assert.equal(styleOf(w, host.querySelector('.dock-disabled')).opacity, '0.5');
      await React.act(async () => root.unmount());
      host.remove();
    }
    dom.window.close();
  }
});

test('preservation variants keep thumbnail, PiP close, watch overlay and public play appearance', async () => {
  const dom = makeDom('ui-first');
  const w = dom.window;
  const app = w.document.createElement('div');
  app.className = 'app feed-app';
  app.setAttribute('data-ui-surface', 'app');
  w.document.body.append(app);
  const appRoot = createRoot(app);
  await React.act(async () => appRoot.render(React.createElement(FeedCard, {
    title: 'Lesson', thumbnail: null, seconds: 60, creator: 'Creator', badge: 'Public',
    kind: 'public', detail: 'detail', onOpen: () => {},
  })));
  const thumbnailStyle = w.getComputedStyle(app.querySelector('.feed-thumbnail')!);
  assert.equal(thumbnailStyle.backgroundColor, 'rgb(32, 59, 48)');
  assert.equal(thumbnailStyle.color, 'rgb(246, 249, 238)');
  assert.equal(thumbnailStyle.padding, '0px');
  assert.equal(thumbnailStyle.borderRadius, '14px');
  await React.act(async () => appRoot.unmount());

  const practice = w.document.createElement('div');
  practice.className = 'practice-runtime-shell mimic-shell mimic-immersive';
  practice.setAttribute('data-ui-surface', 'practice');
  w.document.body.append(practice);
  const practiceRoot = createRoot(practice);
  await React.act(async () => practiceRoot.render(React.createElement(React.Fragment, null,
    React.createElement(Button, {variant: 'pip-close', 'aria-label': 'Hide video'}, '×'),
    React.createElement(Button, {variant: 'watch-overlay', className: 'watch-video-toggle'}, 'play'),
    React.createElement(Button, {variant: 'move-play', className: 'move-play'}, 'Try'))));
  const pip = w.getComputedStyle(practice.querySelector('.ui-btn--pip-close')!);
  assert.equal(pip.padding, '10px 14px');
  assert.equal(pip.backgroundColor, 'rgba(22, 43, 34, 0.65)');
  assert.equal(pip.borderTopWidth, '1px');
  const overlay = w.getComputedStyle(practice.querySelector('.watch-video-toggle')!);
  assert.equal(overlay.padding, '0px');
  assert.equal(overlay.backgroundColor, 'rgba(0, 0, 0, 0)');
  const play = w.getComputedStyle(practice.querySelector('.move-play')!);
  assert.equal(play.padding, '10px 16px');
  assert.equal(play.borderRadius, '30px');
  assert.equal(play.backgroundColor, 'rgb(255, 254, 250)');
  await React.act(async () => practiceRoot.unmount());
  dom.window.close();
});

test('dialog restores the opener captured before an inert/blurring commit', async () => {
  const dom = makeDom('ui-first');
  const w = dom.window;
  const host = w.document.createElement('div');
  host.className = 'practice-runtime-shell mimic-shell mimic-immersive';
  host.setAttribute('data-ui-surface', 'practice');
  w.document.body.append(host);
  const opener = w.document.createElement('button');
  opener.id = 'opener';
  opener.textContent = 'Open settings';
  host.append(opener);
  opener.focus();
  assert.equal(w.document.activeElement, opener);
  // JSDOM reports no client rects, while the dialog deliberately ignores invisible
  // controls. Simulate a visible browser layout so the focus-trap path is exercised.
  Object.defineProperty(w.HTMLElement.prototype, 'getClientRects', {
    configurable: true,
    value() { return [{x: 0, y: 0, top: 0, left: 0, right: 1, bottom: 1, width: 1, height: 1}]; },
  });
  const mount = w.document.createElement('div');
  host.append(mount);
  const root = createRoot(mount);
  function BlurBeforePassiveEffects() {
    React.useLayoutEffect(() => {
      (w.document.activeElement as HTMLElement | null)?.blur();
    }, []);
    return null;
  }
  function Wrapper() {
    const [open, setOpen] = React.useState(true);
    return React.createElement(React.Fragment, null,
      React.createElement(BlurBeforePassiveEffects),
      open && React.createElement(PracticePanel, {title: 'Settings', onClose: () => setOpen(false), portalRoot: host},
        React.createElement('button', null, 'Inside')));
  }
  await React.act(async () => root.render(React.createElement(Wrapper)));
  const close = host.querySelector<HTMLButtonElement>('[aria-label="Close Settings"]')!;
  assert.ok(w.document.activeElement === close, 'dialog takes focus after passive-effect commit');
  await React.act(async () => close.dispatchEvent(new w.MouseEvent('click', {bubbles: true})));
  assert.ok(w.document.activeElement === opener, 'opener focus is restored after close');
  await React.act(async () => root.unmount());
  dom.window.close();
});
test('multi-check View menu toggles without closing and Escape restores focus', async () => {
  const dom = makeDom('ui-first');
  const w = dom.window;
  const host = w.document.createElement('div');
  host.className = 'practice-player-dock';
  host.setAttribute('data-ui-surface', 'practice');
  w.document.body.append(host);
  const mount = w.document.createElement('div');
  host.append(mount);
  const root = createRoot(mount);
  const toggles: string[] = [];
  await React.act(async () => root.render(React.createElement(PracticeCheckboxMenu, {label: 'View', options, selected: [], onToggle: value => toggles.push(value)})));
  const trigger = host.querySelector<HTMLButtonElement>('.practice-checkbox-menu-trigger')!;
  await React.act(async () => trigger.dispatchEvent(new w.MouseEvent('click', {bubbles: true})));
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  const boxes = [...host.querySelectorAll<HTMLInputElement>('.practice-checkbox-menu-popup input')];
  assert.equal(boxes.length, 2);
  assert.equal(w.document.activeElement, boxes[0]);
  await React.act(async () => boxes[1].dispatchEvent(new w.MouseEvent('click', {bubbles: true})));
  assert.deepEqual(toggles, ['keyboard']);
  assert.ok(host.querySelector('.practice-checkbox-menu-popup'), 'menu stays open while toggling');
  await React.act(async () => boxes[1].dispatchEvent(new w.KeyboardEvent('keydown', {key: 'Escape', bubbles: true})));
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(w.document.activeElement, trigger);
  await React.act(async () => root.unmount());
  dom.window.close();
});
