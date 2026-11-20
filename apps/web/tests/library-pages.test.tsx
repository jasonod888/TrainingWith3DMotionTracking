import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>',
  {url: 'http://localhost/', pretendToBeVisual: true});
Object.assign(globalThis, {window: dom.window as unknown as Window & typeof globalThis,
  document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true});
const {render, fireEvent, cleanup, waitFor} = await import('@testing-library/react');
const {useState} = await import('react');
const {useLibraryPages} = await import('../src/app/useLibraryPages.ts');

type Resolver = (value: unknown) => void;
let pending: {q: string; offset: number; resolve: Resolver}[] = [];
const loadPage = (options: {q?: string; offset: number}) => new Promise<any>(resolve => {
  pending.push({q: options.q ?? '', offset: options.offset, resolve});
});

function Harness() {
  const [query, setQuery] = useState('');
  const pages = useLibraryPages({accountId: 'a', query, subject: 'all', loadPage});
  return <div>
    <span data-loading={String(pages.loadingMore)}>loading</span>
    <span data-more={String(pages.hasMore)}>more</span>
    <span data-count={String(pages.lessons.length)}>count</span>
    <button onClick={() => setQuery('new')}>search</button>
    <button onClick={() => void pages.loadMore()}>more</button>
  </div>;
}

afterEach(() => { cleanup(); pending = []; });
const page = (lessons: string[], hasMore = true) => ({lessons: lessons.map(lesson_id => ({lesson_id})),
  total: 20, has_more: hasMore, available_subjects: []});

test('a stale reload cannot unlock loadingMore or overwrite the new search', async () => {
  const take = (predicate: (item: {q: string; offset: number}) => boolean) => {
    const index = pending.findIndex(predicate);
    assert.ok(index >= 0);
    return pending.splice(index, 1)[0];
  };
  const view = render(<Harness/>);
  await waitFor(() => assert.equal(pending.length, 1));
  fireEvent.click(view.getByText('search'));
  await waitFor(() => assert.equal(pending.length, 2), {timeout: 1500});
  const searchB = take(item => item.q === 'new' && item.offset === 0);
  searchB.resolve(page(['B1'], true));
  await waitFor(() => assert.equal(view.container.querySelector('[data-count]')?.getAttribute('data-count'), '1'));

  fireEvent.click(view.getByRole('button', {name: 'more'}));
  await waitFor(() => assert.equal(view.container.querySelector('[data-loading]')?.getAttribute('data-loading'), 'true'));
  const loadB2 = take(item => item.q === 'new' && item.offset === 1);

  // Slow reload A resolves while B's loadMore is in flight. It must not touch
  // loadingMore or any current B state.
  const slowA = take(item => item.q === '' && item.offset === 0);
  slowA.resolve(page(['A1'], false));
  await waitFor(() => assert.equal(view.container.querySelector('[data-loading]')?.getAttribute('data-loading'), 'true'));
  const beforeDuplicate = pending.length;
  fireEvent.click(view.getByRole('button', {name: 'more'}));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(pending.length, beforeDuplicate, 'duplicate loadMore is ignored while loading');

  loadB2.resolve(page(['B2'], true));
  await waitFor(() => assert.equal(view.container.querySelector('[data-count]')?.getAttribute('data-count'), '2'));
  await waitFor(() => assert.equal(view.container.querySelector('[data-loading]')?.getAttribute('data-loading'), 'false'));

  fireEvent.click(view.getByRole('button', {name: 'more'}));
  await waitFor(() => assert.equal(pending.length, 1));
  const loadB3 = take(item => item.q === 'new' && item.offset === 2);
  loadB3.resolve(page(['B3'], false));
  await waitFor(() => assert.equal(view.container.querySelector('[data-count]')?.getAttribute('data-count'), '3'));
});

test('a search change cancels stale loadMore and unlocks subsequent paging', async () => {
  const view = render(<Harness/>);
  await waitFor(() => assert.equal(pending.length, 1));
  pending.shift()!.resolve(page(['first'], true));
  await waitFor(() => assert.equal(view.container.querySelector('[data-count]')?.getAttribute('data-count'), '1'));

  fireEvent.click(view.getByRole('button', {name: 'more'}));
  await waitFor(() => assert.equal(view.container.querySelector('[data-loading]')?.getAttribute('data-loading'), 'true'));
  assert.equal(pending.length, 1, 'stale loadMore request is in flight');

  fireEvent.click(view.getByText('search'));
  await waitFor(() => assert.equal(pending.length, 2), {timeout: 1500});
  const newSearch = pending.find(item => item.q === 'new')!;
  pending = pending.filter(item => item !== newSearch);
  assert.equal(newSearch.q, 'new');
  newSearch.resolve(page(['second'], true));
  await waitFor(() => assert.equal(view.container.querySelector('[data-more]')?.getAttribute('data-more'), 'true'));
  await waitFor(() => assert.equal(view.container.querySelector('[data-loading]')?.getAttribute('data-loading'), 'false'));

  // Stale loadMore resolves after the new search; it must not overwrite it.
  pending.shift()?.resolve(page(['stale'], false));
  await waitFor(() => assert.equal(view.container.querySelector('[data-loading]')?.getAttribute('data-loading'), 'false'));
  assert.equal(view.container.querySelector('[data-more]')?.getAttribute('data-more'), 'true');

  fireEvent.click(view.getByRole('button', {name: 'more'}));
  await waitFor(() => assert.equal(pending.length, 1));
  assert.equal(pending[0].q, 'new');
  pending[0].resolve(page(['third'], false));
  await waitFor(() => assert.equal(view.container.querySelector('[data-count]')?.getAttribute('data-count'), '2'));
});
