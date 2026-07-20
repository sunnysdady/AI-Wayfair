function json(value) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "{}")); } catch { return {}; }
}

function enrichedAction(action, reviewByAction) {
  const review = reviewByAction.get(action.id) || null;
  return {
    ...action,
    before: json(action.before_payload),
    proposed: json(action.proposed_payload),
    result: json(action.result_payload),
    review,
  };
}

export function buildAdReviewDashboard({ runs = [], actions = [], reviews = [] } = {}) {
  const normalizedReviews = reviews.map((review) => ({ ...review, ...json(review.payload) }));
  const reviewByAction = new Map(normalizedReviews.map((review) => [review.action_id, review]));
  const normalizedActions = actions.map((action) => enrichedAction(action, reviewByAction));
  const executed = normalizedActions.filter((action) => action.status === "EXECUTED");
  const reviewedExecuted = executed.filter((action) => action.review);
  const knownRunKeys = new Set(runs.map((run) => run.run_key));
  const syntheticRuns = [...new Set(normalizedActions.map((action) => action.run_key).filter((key) => key && !knownRunKeys.has(key)))].map((runKey) => {
    const [, decisionStart = "", decisionEnd = ""] = String(runKey).split(":");
    return { run_key: runKey, decision_start: decisionStart, decision_end: decisionEnd, created_at: "" };
  });
  const weeks = [...runs, ...syntheticRuns].map((run) => {
    const weekActions = normalizedActions.filter((action) => action.run_key === run.run_key);
    const weekReviews = normalizedReviews.filter((review) => review.source_run_key === run.run_key);
    return {
      ...run,
      actions: weekActions,
      reviews: weekReviews,
      summary: {
        actions: weekActions.length,
        executed: weekActions.filter((action) => action.status === "EXECUTED").length,
        failed: weekActions.filter((action) => action.status === "FAILED").length,
        effective: weekReviews.filter((review) => review.verdict === "EFFECTIVE").length,
        harmful: weekReviews.filter((review) => review.verdict === "HARMFUL").length,
      },
    };
  }).sort((a, b) => String(b.decision_end || "").localeCompare(String(a.decision_end || "")));
  const effectiveReviews = normalizedReviews.filter((review) => review.verdict === "EFFECTIVE").length;
  const harmfulReviews = normalizedReviews.filter((review) => review.verdict === "HARMFUL").length;
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalActions: normalizedActions.length,
      executedActions: executed.length,
      failedActions: normalizedActions.filter((action) => action.status === "FAILED").length,
      reviewedActions: reviewedExecuted.length,
      pendingReviews: executed.filter((action) => !action.review || ["PENDING", "INCONCLUSIVE"].includes(action.review.verdict)).length,
      effectiveReviews,
      harmfulReviews,
      reviewCoverage: executed.length ? reviewedExecuted.length / executed.length : 0,
    },
    weeks,
  };
}
