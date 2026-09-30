// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ReadingOptions } from './reading-options';
import { DEFAULT_READING_APPEARANCE } from '@/lib/reading-appearance';

it('句读选项集中分块方式、解读、显示开关与重点设置', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  const style = vi.fn();
  const prefs = vi.fn();
  const appearance = vi.fn();
  const analysisHints = vi.fn();
  const concepts = vi.fn();
  const generate = vi.fn();
  document.body.append(host);
  try {
    await act(async () => root.render(<ReadingOptions
      style="semantic" onStyleChange={style}
      preferences={{ difficulty: 'normal', detail: 'standard' }} onPreferencesChange={prefs}
      appearance={DEFAULT_READING_APPEARANCE} onAppearanceChange={appearance}
      showAnalysisHints onAnalysisHintsChange={analysisHints}
      showConcepts onConceptsChange={concepts}
      onGenerateEmphasis={generate} canEnhance
    />));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="句读选项"]')!.click());
    const difficulty = host.querySelector<HTMLSelectElement>('[aria-label="解读方式"]')!;
    expect([...difficulty.options].map(option => option.text)).toEqual(['小白', '通俗', '正常', '深入']);
    await act(async () => {
      difficulty.value = 'beginner';
      difficulty.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(prefs).toHaveBeenLastCalledWith({ difficulty: 'beginner', detail: 'standard' });
    expect(host.querySelectorAll('[aria-label="句读方式"] option')).toHaveLength(2);
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(6);
    const analysisToggle = host.querySelector<HTMLInputElement>('[aria-label="句读线"]')!;
    const conceptToggle = host.querySelector<HTMLInputElement>('[aria-label="概念"]')!;
    expect(analysisToggle.checked).toBe(true);
    expect(conceptToggle.checked).toBe(true);
    await act(async () => analysisToggle.click());
    await act(async () => conceptToggle.click());
    expect(analysisHints).toHaveBeenLastCalledWith(false);
    expect(concepts).toHaveBeenLastCalledWith(false);
    await act(async () => host.querySelector<HTMLInputElement>('[name="sourceTerms"]')!.click());
    expect(appearance).toHaveBeenCalledWith(expect.objectContaining({ sourceTerms: true }));
    expect(generate).not.toHaveBeenCalled();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('[aria-label="句读选项设置"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
