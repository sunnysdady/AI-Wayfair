function containsAll(selected, selectable) {
  const selectedSet = new Set(selected);
  return selectable.every((value) => selectedSet.has(value));
}

export function isBulkActionSelectionComplete({
  selectableRecommendationKeys,
  selectableQueueIds,
  selectedRecommendationKeys,
  selectedQueueIds,
}) {
  const selectableCount = selectableRecommendationKeys.length + selectableQueueIds.length;
  return selectableCount > 0
    && containsAll(selectedRecommendationKeys, selectableRecommendationKeys)
    && containsAll(selectedQueueIds, selectableQueueIds);
}

export function nextBulkActionSelection(selection) {
  const allSelected = isBulkActionSelectionComplete(selection);

  return {
    allSelected: !allSelected,
    recommendationKeys: allSelected ? [] : [...new Set(selection.selectableRecommendationKeys)],
    queueIds: allSelected ? [] : [...new Set(selection.selectableQueueIds)],
  };
}
