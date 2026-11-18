/** Read ordered pages in bounded batches; never return a partial financial total. */
export async function readFinancePages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<T[]>,
  pageSize = 1000,
): Promise<T[]> {
  const result: T[] = [];
  const concurrency = 4;
  for (let from = 0; ; from += pageSize * concurrency) {
    const pages = await Promise.all(
      Array.from({ length: concurrency }, (_, index) => {
        const start = from + index * pageSize;
        return fetchPage(start, start + pageSize - 1);
      }),
    );
    for (const page of pages) result.push(...page);
    if (pages.some((page) => page.length < pageSize)) return result;
  }
}