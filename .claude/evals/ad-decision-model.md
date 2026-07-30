# Advertising Decision Model Eval

## Objective

Verify that the first advertising model improves decision quality without relabeling the existing rule engine. The model must rank shadow-mode candidate actions by expected incremental contribution profit while preserving separate definitions for:

- mature WSC ROAS;
- orders per $100 of advertising spend;
- incremental marketing ROI;
- contribution profit proxy (never net profit).

## Required behavior

1. Use Campaign × Listing identity, including site, B2B flag, targeting type, and target identifier when available.
2. Shrink small-sample attributed orders per advertising dollar toward a leave-one-listing-out portfolio prior. Click-based CVR is diagnostic only because the source includes view-through attribution.
3. Never recommend scaling from descriptive attribution alone. With C0 causal confidence, a mature apparent winner may produce only a small shadow canary.
4. Refuse contribution optimization when margin/cost evidence is incomplete.
5. Block scaling when attribution, listing quality, inventory, mapping, or cooldown evidence is unsafe.
6. Emit attributed scenario projections for orders, WSC, spend, contribution proxy, and WSC ROAS. Under causal confidence C0, true expected incremental deltas, incremental marketing ROI, and the probability that incremental contribution is positive must remain `null`.
7. Keep every recommendation in `SHADOW` mode with `eligibleForExecution=false`.
8. Report the model-derived optimal budget as unknown until intervention data can estimate a response curve.
9. Report data, predictive, and causal confidence separately; the first release must remain at causal confidence `C0`.

## Deterministic eval

Run:

```bash
node scripts/eval-ad-decision-model.mjs
```

The runner reads `.claude/evals/ad-decision-model.cases.json` and must pass every case. A failure is a release blocker for model integration.
