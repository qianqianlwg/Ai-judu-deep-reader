import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile(new URL('./reading-answer-presentation-compare.html', import.meta.url), 'utf8');
function page(options = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', virtualConsole,
    beforeParse(window) { options.setup?.(window); },
  });
  assert.deepEqual(errors, [], 'no script or document parsing errors');
  const root = dom.window.document.getElementById('judu-answer-lab');
  assert.ok(root);
  const control = name => root.querySelector(`[data-control="${name}"]`);
  const select = choice => root.querySelector(`[data-choice="${choice}"]`).click();
  const input = (name, value) => {
    const node = control(name);
    if (node.type === 'checkbox') node.checked = value;
    else node.value = String(value);
    node.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  return { dom, root, control, select, input, errors };
}

test('self-contained HTML is offline and has one bounded comparison script', () => {
  const { dom, root } = page();
  assert.equal(dom.window.document.querySelectorAll('script').length, 1);
  assert.equal(dom.window.document.querySelectorAll('[src], link[href], iframe, form').length, 0);
  assert.match(html, /connect-src 'none'/);
  assert.equal(root.querySelectorAll('.jl-panel').length, 4);
  assert.match(html, /@media\(max-width: 660px\)/);
  assert.match(html, /light-dark\(/);
  assert.doesNotMatch(html, /\\"|\\n/);
  dom.window.close();
});

test('initial view is the requested colored-text alternative, not marker-only', () => {
  const { dom, root } = page();
  const visible = [...root.querySelectorAll('.jl-panel')].filter(p => !p.hidden);
  assert.deepEqual(visible.map(p => p.dataset.scheme), ['color']);
  assert.equal(root.querySelector('[data-choice="color"]').getAttribute('aria-pressed'), 'true');
  assert.equal(visible[0].querySelectorAll('.jl-term').length, 3);
  assert.equal(visible[0].querySelectorAll('.jl-lead').length, 1);
  assert.match(html, /\[data-scheme="color"\] \.jl-term/);
  assert.match(html, /color: var\(--jl-keyword\)/);
  assert.match(html, /\[data-scheme="marker"\] \.jl-term.*background: var\(--jl-marker\)/);
  dom.window.close();
});

test('every scheme button selects exactly one visible pane and updates description', () => {
  const { dom, root, select } = page();
  for (const name of ['plain', 'color', 'marker', 'hybrid']) {
    select(name);
    assert.equal(root.querySelectorAll('[aria-pressed="true"]').length, 1);
    assert.equal(root.querySelector(`[data-scheme="${name}"]`).hidden, false);
    assert.equal([...root.querySelectorAll('.jl-panel')].filter(p => !p.hidden).length, 1);
    assert.ok(root.querySelector('[role="status"]').textContent.length > 10);
  }
  dom.window.close();
});

test('four-way comparison preserves identical primary content in both examples', () => {
  const { dom, root, input } = page();
  input('compare', true);
  assert.equal([...root.querySelectorAll('.jl-panel')].filter(p => !p.hidden).length, 4);
  assert.equal(root.querySelector('.jl-grid').dataset.compare, 'true');
  for (const sample of ['argument', 'literary']) {
    input('sample', sample);
    const texts = [...root.querySelectorAll('.jl-answer')].map(el => el.textContent);
    assert.equal(texts.length, 4);
    assert.equal(new Set(texts).size, 1, 'comparison must not secretly shorten one answer');
    assert.ok(texts[0].length > 100);
    assert.equal(root.querySelectorAll('.jl-term').length, 12);
    assert.equal(root.querySelectorAll('.jl-lead').length, 4);
  }
  dom.window.close();
});

test('keyword and sentence controls, intensity and font size update actual preview state', () => {
  const { dom, root, input } = page();
  input('keywords', false); input('keylines', false);
  assert.equal(root.dataset.keywords, 'false'); assert.equal(root.dataset.keylines, 'false');
  input('keywords', true); input('keylines', true); input('intensity', 'strong'); input('fontSize', 18);
  assert.equal(root.dataset.keywords, 'true'); assert.equal(root.dataset.keylines, 'true');
  assert.equal(root.dataset.intensity, 'strong');
  assert.equal(root.style.getPropertyValue('--jl-font'), '18px');
  assert.equal(root.querySelector('[data-font-output]').textContent, '18 px');
  dom.window.close();
});

test('hybrid supplement uses native disclosure, does not invent real book navigation', () => {
  const { dom, root, select } = page();
  select('hybrid');
  const disclosure = root.querySelector('.jl-details');
  assert.equal(disclosure.open, false);
  disclosure.querySelector('summary').click();
  assert.equal(disclosure.open, true);
  assert.match(disclosure.textContent, /不是实际书籍引用/);
  assert.equal(disclosure.querySelectorAll('a, button').length, 0);
  disclosure.querySelector('summary').click();
  assert.equal(disclosure.open, false);
  dom.window.close();
});

test('state restores, saves meaningful selection, and accepts host updates', async () => {
  const snapshots = [];
  const { dom, root, select } = page({ setup(window) {
    window.openai = {
      widgetState: { privateContent: { scheme: 'marker', sample: 'literary', fontSize: 17 } },
      setWidgetState: async state => { snapshots.push(state); },
    };
  } });
  assert.equal(root.querySelector('[data-scheme="marker"]').hidden, false);
  assert.match(root.querySelector('.jl-question').textContent, /敲门/);
  assert.equal(snapshots.length, 0, 'do not write state on initial load');
  select('hybrid'); await Promise.resolve();
  assert.equal(snapshots.at(-1).modelContent.selectedScheme, 'hybrid');
  dom.window.dispatchEvent(new dom.window.CustomEvent('openai:set_globals', { detail: { globals: { widgetState: { privateContent: { scheme: 'plain', compare: true } } } } }));
  assert.equal(root.querySelector('.jl-grid').dataset.compare, 'true');
  assert.equal(root.querySelector('[data-choice="plain"]').getAttribute('aria-pressed'), 'true');
  dom.window.close();
});

test('invalid persisted values cannot select missing data or unbounded font sizes', () => {
  const { dom, root } = page({ setup(window) { window.openai = { widgetState: { privateContent: { scheme: 'unknown', sample: '__proto__', fontSize: 999, compare: 'yes' } } }; } });
  assert.equal(root.style.getPropertyValue('--jl-font'), '15px');
  assert.equal(root.querySelector('[data-scheme="color"]').hidden, false);
  assert.equal(root.querySelector('.jl-grid').dataset.compare, 'false');
  dom.window.close();
});

test('host design controls are optional and do not duplicate standalone controls', () => {
  const controls = [];
  const { dom, root } = page({ setup(window) {
    window.Tweak = class {
      addToggle(_state, key) { controls.push(key); }
      addSelect(_state, key) { controls.push(key); }
      addSlider(_state, key) { controls.push(key); }
    };
  } });
  assert.deepEqual(controls, ['keywords', 'keylines', 'intensity', 'fontSize']);
  assert.equal(root.querySelector('[data-fallback-options]').hidden, true);
  dom.window.close();
});

test('unsupported host design controls retain local working controls', () => {
  const { dom, root, input } = page({ setup(window) {
    window.Tweak = class {
      supported = false;
      addToggle() {} addSelect() {} addSlider() {}
    };
  } });
  assert.equal(root.querySelector('[data-fallback-options]').hidden, false);
  input('keywords', false);
  assert.equal(root.dataset.keywords, 'false');
  dom.window.close();
});
