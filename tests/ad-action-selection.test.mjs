import assert from "node:assert/strict";
import test from "node:test";

import { nextBulkActionSelection } from "../lib/ad-action-selection.mjs";

test("select all includes both unqueued recommendations and queued actions", () => {
  const selected = nextBulkActionSelection({
    selectableRecommendationKeys: [
      "622721:DMOM1022",
      "622735:DMOM1018",
      "622727:DMOM1025",
      "622738:DMOM1019",
    ],
    selectableQueueIds: [
      "weekly:2026-07-04:2026-07-10:622741:DMOM1000:SET_LISTING_ACTIVE",
    ],
    selectedRecommendationKeys: [],
    selectedQueueIds: [],
  });

  assert.equal(selected.allSelected, true);
  assert.deepEqual(selected.recommendationKeys, [
    "622721:DMOM1022",
    "622735:DMOM1018",
    "622727:DMOM1025",
    "622738:DMOM1019",
  ]);
  assert.deepEqual(selected.queueIds, [
    "weekly:2026-07-04:2026-07-10:622741:DMOM1000:SET_LISTING_ACTIVE",
  ]);
});

test("select all clears a fully selected mixed action set", () => {
  const recommendationKeys = ["622721:DMOM1022", "622735:DMOM1018"];
  const queueIds = [
    "weekly:2026-07-04:2026-07-10:622741:DMOM1000:SET_LISTING_ACTIVE",
  ];
  const selected = nextBulkActionSelection({
    selectableRecommendationKeys: recommendationKeys,
    selectableQueueIds: queueIds,
    selectedRecommendationKeys: recommendationKeys,
    selectedQueueIds: queueIds,
  });

  assert.equal(selected.allSelected, false);
  assert.deepEqual(selected.recommendationKeys, []);
  assert.deepEqual(selected.queueIds, []);
});
