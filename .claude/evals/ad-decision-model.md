# Advertising Decision Model Eval

## Objective

Verify that the first advertising model improves decision quality without relabeling the existing rule engine. The model must rank shadow-mode candidate actions by expected incremental contribution profit while preserving separate definitions for:

- mature WSC ROAS;
- orders per $100 of advertising spend;
- incremental marketing ROI;
- contribution profit proxy (never net profit).

## Required behavior

1. Use Campaign × Listing identity, including site, B2B flag, targeting type, and target identifier when available.
2. Shrink small-sample conversion rates toward a portfolio prior.
3. Never recommend scaling from a tiny sample even when observed ROAS is extreme.
4. Refuse contribution optimization when margin/cost evidence is incomplete.
5. Block scaling when attribution, listing quality, inventory, mapping, or cooldown evidence is unsafe.
6. Emit expected deltas for orders, WSC, spend, contribution profit, WSC ROAS, incremental marketing ROI, and probability that incremental contribution is positive.
7. Keep every recommendation in `SHADOW` mode with `eligibleForExecution=false`.
8. Report the model-derived optimal budget as unknown until intervention data can estimate a response curve.

## Deterministic eval

Run:

```bash
node scripts/eval-ad-decision-model.mjs
```

The runner reads `.claude/evals/ad-decision-model.cases.json` and must pass every case. A failure is a release blocker for model integration.

