function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

export function mergeCatalogPages(pages) {
  const firstPage = pages[0] || {};
  const items = [];
  const seenParts = new Set();

  pages.forEach((page) => {
    (page?.items || []).forEach((item) => {
      const part = item?.supplierPartNumber;
      if (part && seenParts.has(part)) return;
      if (part) seenParts.add(part);
      items.push(item);
    });
  });

  const totalPages = positiveInteger(firstPage?.paginationInfo?.totalPages, 1);
  const reportedTotal = Number(firstPage?.paginationInfo?.totalCount);
  return {
    ...firstPage,
    items,
    paginationInfo: {
      ...firstPage?.paginationInfo,
      page: 1,
      totalPages,
      totalCount: Number.isFinite(reportedTotal) ? reportedTotal : items.length,
      hasNextPage: false,
    },
    productManagement: {
      ...firstPage?.productManagement,
      matchedItemCount: items.filter((item) => item?.productManagement).length,
    },
  };
}

export async function loadAllCatalogPages(fetchPage, { concurrency = 3 } = {}) {
  const firstPage = await fetchPage(1);
  const totalPages = positiveInteger(firstPage?.paginationInfo?.totalPages, 1);
  const batchSize = positiveInteger(concurrency, 3);
  const pages = [firstPage];

  for (let firstPendingPage = 2; firstPendingPage <= totalPages; firstPendingPage += batchSize) {
    const pendingPages = Array.from(
      { length: Math.min(batchSize, totalPages - firstPendingPage + 1) },
      (_, offset) => firstPendingPage + offset,
    );
    pages.push(...await Promise.all(pendingPages.map((page) => fetchPage(page))));
  }

  return mergeCatalogPages(pages);
}
