"use client";

import { useEffect, useMemo, useState } from "react";
import { CLIENT_CACHE_RETENTION_MS, invalidateClientCache, readClientCache, writeClientCache } from "../lib/client-cache";
import { canRemoveAction, executionResultForAction, filterAdActions, isBulkApprovable, queuedActionState } from "../lib/ad-action-queue.mjs";
import { isBulkActionSelectionComplete, nextBulkActionSelection } from "../lib/ad-action-selection.mjs";
import { nextSort, sortRows } from "../lib/table-sort.mjs";
import { financialDetailsForEmail } from "../lib/email-finance.mjs";
import { manualCompletionPayload } from "../lib/manual-ad-completions.mjs";
import { navigationSearch, navigationStateFromSearch } from "../lib/app-navigation.mjs";
import { PLAN_PROGRESS_CACHE_KEY } from "../lib/plan-progress-view.mjs";
import legacyOperatingDataSource from "../data/dmom-operating-2026-06.json";

type View = "dashboard" | "tasks" | "daily" | "ads" | "planning" | "products" | "sources" | "help";
type AdsTab = "manager" | "listings" | "ai" | "manual" | "review";
type PlanningTab = "plan" | "august" | "review" | "history";
type ProductTab = "inventory" | "catalog" | "launch" | "performance";
type PlanSection = "july" | "bfij" | "august";
type SubView = AdsTab | PlanningTab | ProductTab;

const PRIMARY_NAV: { id: View; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "tasks", label: "闭环任务" },
  { id: "daily", label: "日报" },
  { id: "ads", label: "广告" },
  { id: "planning", label: "计划与复盘" },
  { id: "products", label: "商品与库存" },
];

const SYSTEM_NAV: { id: View; label: string }[] = [
  { id: "sources", label: "数据源" },
  { id: "help", label: "帮助" },
];

const SUB_NAV: Partial<Record<View, { id: SubView; label: string }[]>> = {
  ads: [{ id: "manager", label: "广告管理器" }, { id: "listings", label: "父体 SKU 广告表现" }, { id: "ai", label: "AI 优化" }, { id: "manual", label: "手动优化 To-Do" }, { id: "review", label: "优化记录与复盘" }],
  planning: [{ id: "plan", label: "运营计划" }, { id: "august", label: "8月推广计划" }, { id: "review", label: "复盘资料" }, { id: "history", label: "历史月度" }],
  products: [{ id: "inventory", label: "库存更新" }, { id: "catalog", label: "商品数据" }, { id: "launch", label: "推新 SOP" }, { id: "performance", label: "SKU 经营" }],
};

type LegacySku = { "Supplier Part Number":string;"Wayfair Sku":string;"Product Name":string;"Class Name":string;"Total Revenue":number;Sessions:number;CVR:number;rating:number;review_count:number;tag_pct:number;wsc:number;cogs:number;my_profit:number;my_margin:number;wf_space:number;grade:string;cn_name:string|null };
type LegacyOperatingData = { meta:{store:string;biz_month:string};skus:LegacySku[];trend:{months:string[];revenue:Array<number|null>;orders:Array<number|null>;sessions:Array<number|null>;cvr:Array<number|null>;sp_spend:Array<number|null>};acct_monthly:Array<{m:number;orders:number;ad_orders:number;spend:number;rev:number}> };
const LEGACY_OPERATING_DATA=legacyOperatingDataSource as unknown as LegacyOperatingData;

type ProductAuditAccount = { period:string;label:string;days:number;orders:number;units:number;revenue:number;procurementProfit:number;procurementMargin:number;campaignAdSpend:number;contributionProxy:number;contributionMargin:number;revenuePerDay:number;contributionPerDay:number };
type ProductAuditRole = { listing:string;tier:string;role:string;confidence:string;actionGuardrail:string;platformStatus:string;lastExecutionResult:null;parts:string[];conflictParts:string[];mature56Units:number;julyVsJuneDaily:number|null;matureMargin:number|null;listingAdSpend:number;listingRoas:number|null;breakEvenRoas:number|null;knownContributionUpperBound:number;operatorNote:string };
type ProductOperatingAudit = { auditId:string;version:string;asOfDate:string;performanceThrough:string;roleEvidenceStart:string;roleEvidenceThrough:string;costUpdatedAt:string;sourceSnapshotSha256:string;review:{owner:string;reviewedAt:string;verdict:string};matureWindow:{start:string;end:string;days:number};profitDefinition:string;executionRule:string;account:ProductAuditAccount[];roles:ProductAuditRole[];adCoverage:{campaignSpend:number;listingAllocatedSpend:number;unallocatedSpend:number;listingCoverageRate:number};quality:{soldSkuCostCoverage:number;costHistoryRows:number;matureUnallocatedAdSpend:number;inventoryDuplicateGroups:number;sharedSourceSkuCount:number;multiListingPartCount:number;missingNetProfitInputs:string[]} };

type OrderMetric = { revenue: number; orders: number; units: number; aov: number; advertisingBeforeGrossProfit: number; contributionAfterAds: number | null; advertisingSpend: number | null; advertisingCoverage: string; profitMode: "estimated" | "cost-covered"; costCoverage: number; marginRate: number };
type OrderSummary = {
  current: OrderMetric;
  previous: OrderMetric;
  daily: { date: string; revenue: number; orders: number; units: number }[];
  topSkus: { partNumber: string; revenue: number; units: number }[];
  sync: { syncedAt?: string; refreshed?: boolean; stale?: boolean; error?: string };
  error?: string;
};

type CatalogInsight = { insightId?: string; title?: string; explanation?: string; monthsInViolation?: number; expirationDate?: string; resolution?: { url?: string; description?: string } };
type NewProductSop = {
  ruleId: string;
  targetAgent: "OPERATIONS_AGENT";
  priority: string;
  status: "RECOMMENDED" | "BLOCKED" | "NOT_APPLICABLE";
  recommendation: string;
  blockers: string[];
  automaticExecution: boolean;
  evidence: { imagesComplete: boolean; attributesComplete: boolean; contentEvidence: string; hasSalesEvidence: boolean; units30d: number; catalogStatus: string; listingCount: number; catalogProblems: number };
  steps: { order: number; action: string; label: string; dependsOn: string[]; instruction: string; acceptance: string }[];
};
type CatalogItem = {
  supplierPartNumber: string;
  catalogItemStatus?: string;
  class?: { classId?: string; className?: string };
  marketContext?: { locale?: string; country?: string; brand?: string; channel?: string; segment?: string; location?: string };
  listings?: { listingId?: string }[];
  insights?: { problems?: CatalogInsight[]; warnings?: CatalogInsight[]; opportunities?: CatalogInsight[] };
  recent30d?: { units: number; revenue: number };
  newProductSop?: NewProductSop;
};
type CatalogResponse = { items?: CatalogItem[]; paginationInfo?: { page: number; totalPages: number; totalCount: number; hasNextPage: boolean }; error?: string };

type AdMetric = { impressions: number; clicks: number; spend: number; orders: number; units: number; retail: number; wsc: number; ctr: number; cvr: number; cpa: number; retailRoas: number; wscRoas: number };
type AdCampaign = AdMetric & { campaignId: string; name: string; targetingType: string; site: string; status: string; isActive: string; isB2b: string; dailyCap: string; lifetimeBudget: string; startDate: string; endDate: string; strategy: string; targetRoas: string };
type CampaignControlFact = {
  campaignId:string;status:"ACTIVE"|"PAUSED";dailyCap:number|null;protectedFromWholeCampaignPause:boolean;
  controlMode:"LISTING_ISOLATION"|"CAMPAIGN_PAUSED"|"CAMPAIGN_ACTIVE";
  isolatedProducts:Array<{listing:string;part:string;status:"PAUSED"}>;
};
type CampaignControlSnapshot = {
  asOf:string;source:string;walletDailyCap:number;activeCampaignDailyCap:number;walletHeadroom:number;
  activeCampaignDailyCaps:Record<string,number>;pausedCampaignIds:string[];
  correctedCampaign:{campaignId:"597350";status:"ACTIVE";dailyCap:number;last28Spend:number;last28Revenue:number;last28RetailRoas:number;protectedFromWholeCampaignPause:true;controlMode:"LISTING_ISOLATION";isolatedProducts:Array<{listing:"DMOM1025";part:"LFC-3W";status:"PAUSED"}>};
};
type ZombieCampaignFinding = {
  campaignId: string; campaignName: string; targetingType: string; site: string; listing: string; productName: string; linkStatus: string; bid: number; parts: string[];
  metric: { impressions: number; clicks: number; spend: number; orders: number };
  execution: "MANUAL_REVIEW"; severity: "P0" | "P1"; actionType: "PAUSE_CAMPAIGN" | "CHECK_LISTING_ELIGIBILITY" | "CHECK_LOW_DELIVERY";
  label: string; reasons: string[]; before: Record<string, unknown>; proposed: Record<string, unknown>;
};
type AdListing = {
  listing: string; campaignId: string; campaignName: string; site: string; targetingType?: string; strategy?: string; productName: string; className: string; isB2b: string; campaignStatus: string; parts: string[]; bid: number; status: string;
  current: AdMetric; previous: AdMetric;
  plan: null | { budget: number; augustUnits?: number; julyTargetOrders?: number; role: string; gate: string; eligible: boolean; adRole: string; rating?: number; reviews?: number };
  nextPlan: null | { budget: number; augustUnits?: number; role: string; gate: string; eligible: boolean; adRole: string };
  economics: { marginRate: number; marginMode: string; breakEvenRoas: number };
  linkQuality: { rating: number | null; reviews: number | null; pass: boolean; source: string };
  inventory: { known: boolean; coverDays: number | null; quantityOnHand: number; snapshotAt: string | null };
  cpcBaseline: { category: string; cpc: number | null; targetBid: number | null; hardBidCap: number | null; actualCpc: number | null; source: string; appliesTo: string[] };
  goalGuardrail: { julyPaceGap: number; eventPhase: string; julyRemainingUnits: number; augustReserveUnits: number };
  liveSafety?: { status: string; recent: AdMetric; trailing: AdMetric; thresholds: { spend: number; clicks: number; stopSpend: number }; baselineCvr: number; requiredClicks: number };
  operatorReview?: { owner: string; verdict: string; stage: string; thesis: string; counterpoint: string; controls: string[]; requiresHumanApproval: boolean; proposalOwner: string; decisionOwner: string; decisionStatus: string; hypothesis: string; singleVariable: boolean; cooldownUntil: string | null; reviewDue: string | null; rollbackPlan: string };
  action: { type: string; label: string; recommendation: string; execution: string; confidence: string; reasons: string[]; blockers: string[]; warnings: string[]; repairPlan?: null | { focus?: string; diagnosis: string; steps: string[]; acceptance: string[]; retest: string }; before: Record<string, unknown>; proposed: Record<string, unknown> };
};
type AdModelDecision = {
  unitKey:string;
  identity:{site:string;currency?:string;isB2B:boolean;campaignId:string;targetingType:string;listing:string};
  executionPlan:null|{targetMetric:"ORDERS";listingTargetOrders:number;listingBaseAdBudget:number;listingCanaryBudget:number;listingPlannedAdBudget:number;scaleEligible:boolean;portfolioStageOneAdCap:number;portfolioStageTwoAdCap:number};
  campaignControl:CampaignControlFact|null;
  mode:"SHADOW";
  eligibleForExecution:false;
  suggestedAction:string;
  blockers:string[];
  confidenceScore:number;
  confidence:{data:string;predictive:string;causal:string;explanation:string};
  posterior:{ordersPerDollar:number;ordersPer100Spend:number;ordersPer100SpendInterval80:[number,number];wscPerOrder:number;priorOrdersPer100Spend:number;priorStrengthSpend:number};
  metrics:{wscRoas:number|null;ordersPer100Spend:number|null;contributionProfit:number|null;incrementalMarketingRoi:number|null};
  candidates:Array<{action:string;attributedScenario:{orders:number|null;wsc:number|null;spend:number|null;contributionProxy:number|null;wscRoas:number|null};attributedScenarioDelta:{orders:number|null;wsc:number|null;spend:number|null;contributionProxy:number|null};expected:{orders:null;wsc:null;spend:null;contributionProfit:null;wscRoas:null;incrementalMarketingRoi:null};expectedDelta:{orders:null;wsc:null;spend:null;contributionProfit:null};probabilityIncrementalContributionPositive:null;causalStatus:"NOT_ESTIMABLE_C0"}>;
};
type AdDecisionModel = {
  version:string;mode:"SHADOW";objective:string;grain:string;
  optimalBudget:{status:string;amount:number|null;reason:string};
  summary:{units:number;actionableInShadow:number;blocked:number};
  riskPolicy:{basis:string;monthlyRevenueTarget:number;monthlyContributionFloor:number;baseAdPlan:number;conservativeMarginRate:number;projectedContribution:number;targetBuffer:number;portfolioMaxLoss:number;portfolioMaxDailyIncrementalLoss:number;earliestStart:string;earliestMatureReview:string;scope:string};
  decisions:AdModelDecision[];
};
type AdModelTodo = {
  id:string;unitKey:string;listing:string;campaignId:string;priority:"P1"|"P2";type:"DESIGN_CANARY"|"FIX_MODEL_INPUT"|"WAIT_FOR_EVIDENCE"|"MANUAL_AI_REVIEW";title:string;detail:string;suggestedAction:string;blockers:string[];
  executionPlan:null|{targetMetric:"ORDERS";listingTargetOrders:number;listingBaseAdBudget:number;listingCanaryBudget:number;listingPlannedAdBudget:number;scaleEligible:boolean;portfolioStageOneAdCap:number;portfolioStageTwoAdCap:number};
  campaignControl:CampaignControlFact|null;
  confidence:{data:string;predictive:string;causal:string};attributedScenarioDelta:{orders:number|null;spend:number|null;wsc:number|null;contributionProxy:number|null}|null;incrementalContributionProbability:null;experimentContract:null|{status:string;treatment:string;control:string;primaryMetric:string;attributionWaitDays:number;minimumSampleSize:null;requiresPowerAnalysis:boolean;stopRule:string;contaminationControls:string[];maxIncrementalLoss:number;maxDailyIncrementalLoss:number;portfolioMaxIncrementalLoss:number;portfolioMaxDailyIncrementalLoss:number;earliestStart:string;earliestMatureReview:string};mode:"SHADOW";eligibleForExecution:false;
};
type AdAnalysis = {
  current: AdMetric; previous: AdMetric; decision: { current: AdMetric; previous: AdMetric }; history: ({ date: string } & AdMetric)[]; campaigns: AdCampaign[]; listings: AdListing[]; parentListings?: AdListing[]; liveSafetyFindings?: AdListing[]; zombieFindings: ZombieCampaignFinding[];
  zombieAudit: { matureDays: number; total: number; hard: number; near: number };
  range: { start: string; end: string; previousStart: string; previousEnd: string; asOf: string; matureThrough: string; mature: boolean };
  decisionRange: { start: string; end: string; previousStart: string; previousEnd: string; cadence: string; rule: string };
  liveSafetyRange?: { start: string; end: string; trailingStart: string; days: number; rule: string };
  decisionModel?: AdDecisionModel; modelTodo?: AdModelTodo[]; campaignControl?: CampaignControlSnapshot;
  runKey: string; generatedAt: string; attributionWindowDays: number; cache?: { hit?: boolean; layer?: string; updatedAt?: string }; safety: { reason: string }; error?: string;
};
type SortState = { key: string; direction: "asc" | "desc" };
type EmailFinancial = { remittanceId?:string; amount?:number; currency?:string; paymentDate?:string; paymentMethod?:string; invoiceIds?:string[]; grossAmount?:number; allowanceAmount?:number; epdAmount?:number; serviceFeeAmount?:number };
type EmailOrderItem = { sku:string; name?:string; quantity:number; unitPrice:number };
type EmailOrder = { poNumber:string; currency:string; totalQuantity:number; totalAmount:number; items:EmailOrderItem[] };
type EmailItem = { id:string; category?:string; subject:string; sender:string; receivedAt:string; unread:boolean; priority:string; summary:string; bodyPreview?:string; financial?:EmailFinancial; order?:EmailOrder; owner:string; status:string; webLink:string };
type EmailBrief = { briefDate:string; syncedAt:string; source:string; summary:{total:number;unread:number;actionRequired:number;highestPriority:string}; items:EmailItem[]; tasks:Array<{id:string;title:string;owner:string;dueDate:string;priority:string;status:string}>; sections?:Array<{title:string;body:string;tone?:string}>; error?:string };
type QueuedAdAction = {
  id: string; run_key: string; listing: string; campaign_id: string; action_type: string;
  before_payload: string; proposed_payload: string; status: string; created_at: string; updated_at: string;
  result_event_type?: string; result_payload?: string; result_at?: string;
};
type AdQueueCache = { actions: QueuedAdAction[]; liveEnabled: boolean };
type AdReviewAction = { id:string;run_key:string;listing:string;campaign_id:string;action_type:string;status:string;updated_at:string;result_event_type?:string;result_at?:string;before:Record<string,unknown>;proposed:Record<string,unknown>;result:Record<string,unknown>;review:null|{verdict:string;summary?:string;orderDelta?:number;revenueDelta?:number;roasDelta?:number;evaluated_at?:string} };
type AdReviewResponse = { summary:{totalActions:number;executedActions:number;failedActions:number;reviewedActions:number;pendingReviews:number;effectiveReviews:number;harmfulReviews:number;reviewCoverage:number};weeks:Array<{run_key:string;decision_start:string;decision_end:string;created_at:string;summary:{actions:number;executed:number;failed:number;effective:number;harmful:number};actions:AdReviewAction[]}>;error?:string };
type SystemReadiness = {
  environment: { name: string; platform: string; verified: boolean };
  identity: { expectedSupplierIds: number[]; catalogSupplierId: number | null; verified: boolean };
  sources: { id: string; name: string; status: "ready" | "blocked"; detail: string; scope: string }[];
  live: { ads: { allowed: boolean; blockers: string[] }; inventory: { allowed: boolean; blockers: string[] } };
  scopeHealth?: {
    summary: { healthy: number; syncing: number; stale: number; failed: number; unverified: number };
    sources: {
      id: string;
      app: string;
      permission: string;
      status: "healthy" | "syncing" | "stale" | "failed" | "unverified";
      detail: string;
      lastSuccessAt: string | null;
    }[];
    excluded: { id: string; family: string; permission: string }[];
  };
  metrics: { id: string; label: string; unit: string; grain: string; source: string; definition: string }[];
};
type ZombieResolution = { resolutionKey:string;operationId:string;campaignId:string;listing:string;actionType:string;method:string;owner:string;status:"DISCOVERED"|"ASSIGNED"|"EXECUTING"|"PENDING_ACCEPTANCE"|"VERIFIED"|"FAILED"|"REOPENED";executionResult:string;evidence:string;acceptanceCriteria:string;acceptedBy:string;updatedAt?:string };
type ManualCompletionRecord = { operationId:string;taskKey:string;parentSku:string;taskId:string;campaignId:string;adGroup:string;title:string;status:"OPEN"|"IN_PROGRESS"|"PENDING_ACCEPTANCE"|"VERIFIED"|"REOPENED"|"FAILED";owner:string;executionResult:string;evidence:string;acceptanceCriteria:string;acceptedBy:string;reviewDueAt:string;completedAt:string|null;updatedAt:string };
type OperationRecord = { operationId:string;sourceType:string;sourceId:string;objectType:string;objectId:string;title:string;owner:string;status:string;proposedAction:string;executionResult?:string;terminalReceipt?:string;evidence:{type:string;value:string}[];acceptanceCriteria?:string;acceptedBy?:string;reviewDueAt?:string;reviewVerdict?:string;updatedAt:string };
const API_AD_ACTION_TYPES=new Set(['SET_LISTING_BID','SET_LISTING_ACTIVE']);
const ZOMBIE_METHOD_OPTIONS:Record<ZombieCampaignFinding['actionType'],string[]>={
  PAUSE_CAMPAIGN:['暂停 Campaign','联系 Account Manager 核查后暂停'],
  CHECK_LISTING_ELIGIBILITY:['核查 Listing eligibility / 库存','修复链接后复测','确认不可投后暂停'],
  CHECK_LOW_DELIVERY:['7 天 Bid 测试，仍无投放则暂停','保持观察','直接暂停'],
};
function zombieResolutionKey(row:ZombieCampaignFinding){return `${row.campaignId}:${row.listing}:${row.actionType}`;}
let dashboardSnapshot: OrderSummary | null = null;
type PlanProgress = {
  plan: { month: string; orderTarget: number; baselineOrders: number; floorOrders: number; stretchOrders: number; adBudget: number; estimatedNetProfit: number; source: string; sourceAsOf: string; scopeWarning: string };
  currentOperatingMonth: { month: string; targetStatus: string; note: string }; status: string; asOf: string;
  actual: { orders: number; units: number; revenue: number; adSpend: number | null; adCoverage: string; grossProfitBeforeAds: number; contributionAfterAds: number | null; costCoverage: number };
  progress: { elapsedDays: number; totalDays: number; timeProgress: number; orderCompletion: number; expectedOrders: number; paceGap: number; forecastOrders: number; remainingOrders: number; requiredDailyOrders: number };
  listings: { listing: string; parts: string[]; juneBaselineOrders: number; julyTargetOrders: number; actualOrders: number; actualUnits: number; actualRevenue: number; budget: number; estimatedNetProfit: number; role: string; gate: string; tactic?: string; sourceWarning?: string }[];
  events: { label: string; range: string; note: string }[];
  eventCycle: { asOf: string; mode: string; activeEvents: { id: string; name: string; kind: string; start: string; end: string }[]; endedEvents: { id: string; name: string; kind: string; start: string; end: string }[]; upcomingEvents: { id: string; name: string; kind: string; start: string; end: string }[]; attributionMaturesOn: string | null; strategyNote: string; volatilityRule: string };
  listingPortfolioPolicy: { mode: string; status: string; title: string; decision: string; rule: string; originalListingPlan: string; newListingGate: string; experiments: { axis: string; action: string; guardrail: string }[]; source: string; sourceUrl: string; sourceAsOf: string };
  activity: { name: string; officialEventRange: string; canadaCoInvestRange: string; flashDealRange: string; flashConfirmationDeadline: string; catalogLockRange: string; strategyBudget: number; monthlyBudget: number; budgetNote: string; source: string; sourceAsOf: string; activePhase: string; phases: { id: string; label: string; range: string; budgetCap: number; bidRule: string; capRule: string; objective: string }[] };
  cpcPlan: { sourcePage: number; appliesTo: string[]; benchmarkMeaning: string; categoryBenchmarks: Record<string,number>; operatingRule: string; revenueGuardrail: string; augustGuardrail: string; juneAccountFacts: { adSpend: number; attributedOrders: number; attributedWsc: number; accountWsc: number; wspWscRoas: number } };
  nextPlan: {
    executionPolicy: { authorizationStatus: "APPROVED"; targetMetric: "ORDERS"; stretchOrderTarget: number; baseAdBudget: number; canaryLossCap: number; stageOneAdCap: number; stageTwoAdCap: number; retiredAdBudgets: number[]; earliestCanaryStart: string; policy: string };
    executionStage: { ready: boolean; authorizedAdCap: number; blockers: string[] };
    plan: { targetMetric: "ORDERS"; orderTarget: number; baseAdBudget: number; hardAdCap: number; stageTwoHardAdCap: number; sourceAsOf: string; scopeWarning: string };
    listings: { listing: string; parts: string[]; juneUnits: number; augustUnits: number; actualUnits: number; budget: number; role: string; gate: string }[];
    milestones: { label: string; range: string; cumulative: number; note: string }[];
    salesPlan: { targetMetric: "ORDERS"; orderTarget: number; baselineAsOf: string; baselineMappedOrders: number; currentStoreOrders: number; currentForecastOrders: number; marginFloor: number; marginTarget: number; marginCeiling: number; reviewStatus: "APPROVED"; reviewedAt: string; canExecuteAds: false; canBuildPromotionPlan: true; source: string; sourceAsOf: string; strategy: string; riskNote: string };
    salesPlanRows: { listing: string; parts: string[]; role: "VOLUME_CORE" | "PROFIT_POOL" | "CONTROLLED_GROWTH" | "REPAIR_ORGANIC"; targetOrders: number; julyOrders: number; juneOrders: number; inventoryOnHand: number; averageRevenuePerOrder: number; preAdMarginRate: number; marginMode: "ORDER_ACTUAL" | "STORE_ESTIMATE"; baseAdBudget: number; performanceReserve: number; plannedAdBudget: number; expectedRevenue: number; expectedGrossProfit: number; projectedPostAdProfit: number; projectedPostAdMargin: number; tactic: string; gate: string; stopRule: string; promotion: { status: "SUBMITTED" | "PARTIALLY_SUBMITTED" | "ON_HOLD"; submittedParts: string[]; heldParts: string[]; eventIds: string[]; activeEventIds: string[]; submittedEventIds: string[]; discountTiers: string[]; quantityOfferParts: string[]; marginAlertParts: string[]; marginExceptionParts: string[]; syncedAt: string } }[];
    salesPlanSummary: { targetOrders: number; projectedRevenue: number; projectedGrossProfit: number; baseAdBudget: number; performanceReserve: number; plannedAdBudget: number; projectedPostAdProfit: number; projectedPostAdMargin: number; hardAdCap: number; roleMix: Record<string,{targetOrders:number;projectedRevenue:number;projectedGrossProfit:number;plannedAdBudget:number}> };
    salesMilestones: { label: string; range: string; weekOrders: number; cumulativeOrders: number; note: string }[];
    promotionPlanStatus: "SYNCED_AFTER_SUBMISSION";
    promotionEvents: { id: string; projectId: string; name: string; status: "ACTIVE" | "SUBMITTED"; planningStatus: "ACTIVE" | "SUBMITTED_PROCESSING"; canRelyOnForPlan: boolean; planningNote: string; submissionOpened: string; curationDeadline: string; start: string; end: string; lengthDays: number; category: string; recommendedProducts: number | null; submittedProducts: number; submittedAt: string; sourceAsOf: string }[];
    promotionPlan: { listing: string; part: string; role: "VOLUME_CORE" | "PROFIT_POOL" | "CONTROLLED_GROWTH" | "REPAIR_ORGANIC"; action: "SUBMITTED" | "HOLD"; priceBasisCents: number | null; priceBasisType: "PARTNER_HOME_CURRENT_BASE_COST"; costCents: number | null; inventoryOnHand: number; catalogLiveCount: number; eventIds: string[]; activeEventIds: string[]; submittedEventIds: string[]; discountPlan: string; b2cDiscount: number; b2bTotalDiscount: number; memberB2cDiscount: number | null; quantityOffer: number; quantityPromotionStatus: "PROCESSING" | "NOT_APPLICABLE"; worstDiscount: number; estimatedWorstMargin: number | null; roleMarginFloor: number; marginAlert: boolean; marginExceptionApproved: boolean; reason: string; requiredGates: string[]; reviewStatus: "APPROVED" | "APPROVED_HOLD"; submittedToZiniao: boolean; canSubmitToZiniao: false }[];
    quantityPromotion: { id: string; projectId: string; name: string; status: "PROCESSING"; submittedAt: string; minimumQuantity: number; additionalDiscount: number; stackingRule: string; platformMessage: string; parts: string[] };
    promotionPortfolio: { originalAdBudget: number; recommendedAdBudget: number; baseAdBudget: number; performanceReserve: number; fallbackAdBudget: number; methodology: string; budgetRule: string; scenarios: { promotionOrderShare: number; quantityOrderShare: number; eventDiscountLoss: number; quantityDiscountLoss: number; projectedRevenue: number; projectedGrossProfit: number; projectedPostAdProfit: number; projectedPostAdMargin: number; hardAdCapAt10Percent: number; targetAdCapAt12Percent: number }[] };
    promotionSummary: { totalListings: number; totalParts: number; submittedListings: number; submittedParts: number; heldParts: number; approvedParts: number; ziniaoSubmittedParts: number; activeEvents: number; submittedEvents: number; quantityPromotionParts: number; quantityPromotionStatus: string; marginAlertParts: number; marginExceptionParts: number; originalAdBudget: number; recommendedAdBudget: number; adBudgetReduction: number; projectedPromotionOrderShare: number; projectedQuantityOrderShare: number; projectedRevenue: number; projectedPostAdProfit: number; projectedPostAdMargin: number; stressPromotionOrderShare: number; stressQuantityOrderShare: number; stressPostAdMargin: number; fallbackAdBudget: number; fullPromotionHardAdCap: number };
  };
  error?: string;
};

const AD_BUDGET_ALLOCATION = [
  { id: "keyword", label: "Keyword Targeting", budget: 750, share: "41.7%", note: "扩覆盖、拆 Match Type、小步提 Bid" },
  { id: "product", label: "Product Targeting", budget: 650, share: "36.1%", note: "保留需求发现；低效组设 Cap 与止损" },
  { id: "b2b", label: "Professional / B2B", budget: 150, share: "8.3%", note: "仅 Manual 且库存确认后启用" },
  { id: "canada", label: "Canada", budget: 50, share: "2.8%", note: "只保留已出单组，7 天 0 单暂停" },
  { id: "flex", label: "结构扩容 / 机动", budget: 200, share: "11.1%", note: "只释放给通过 Gate 的赢家" },
] as const;

const KEYWORD_LISTING_ALLOCATION = [
  { listing: "DMOM1021", keyword: 380, product: 250, b2b: 70, total: 700, reason: "三类流量均有证据；Keyword 收割为主" },
  { listing: "DMOM1022", keyword: 120, product: 170, b2b: 50, total: 340, reason: "自然动销强，先验证再扩 Cap" },
  { listing: "DMOM1019", keyword: 200, product: 90, b2b: 0, total: 290, reason: "Keyword 赢家，Product 仅保留发现流量" },
  { listing: "DMOM1003 / 4T", keyword: 50, product: 90, b2b: 0, total: 140, reason: "季节需求明确，库存 Gate 不变" },
  { listing: "DMOM1018", keyword: 20, product: 10, b2b: 0, total: 30, reason: "CVR 偏低，仅作修复验证" },
] as const;

const MANUAL_AD_TASKS = [
  { id: "ai-learning-escalation", parentSkus: ["DMOM1002"], priority: "P0", group: "AI学习期", adGroup: "AI-TROAS · DMOM1002 · 8T-kayak", campaignId: "660198", title: "升级处理超期学习广告组", detail: "保存 Active Learning、开始日期、近14天归因订单、花费、tROAS 与 Daily Cap 截图，联系 Account Manager 核查未完成学习的原因。", sku: "DMOM1002 · 8T-kayak", adType: "Product Targeting · AI-TROAS", keywords: "AI Campaign 不执行关键词或否词动作", match: "不适用", bid: "不改单品 Bid", budget: "当前 NO DAILY CAP（风险项）", rule: "学习期内禁止修改 tROAS、Daily Cap 与 Listing；紧急止损须审批后暂停整个 Campaign。" },
  { id: "legacy-keyword-cleanup", parentSkus: ["DRCI1007"], priority: "P0", group: "旧组清理", adGroup: "Filing Cabinets 共享 Keyword Campaign", campaignId: "597350", title: "从旧共享广告组移除已合并 SKU", detail: "DRCI1007 已被 Wayfair 合并；只移除该 Listing 及其词，不暂停整个 597350，避免误伤同组其他 Listing。该组仅用于 filing cabinets 类目。", sku: "DRCI1007", adType: "Sponsored Products · Keyword", keywords: "移除 DRCI1007 对应词与落地页", match: "沿用后台现有匹配", bid: "不改其他 Listing Bid", budget: "不改整组 Cap", rule: "验收 DRCI1007 7天花费/点击/订单均为0，且同组其他 Listing 持续投放。" },
  { id: "dmom1021-product", parentSkus: ["DMOM1021"], priority: "P0", group: "Product 调整", adGroup: "Product US · DMOM1021-宽二680", campaignId: "622725", title: "下调 DMOM1021 Product Bid 并设定 Cap", detail: "只调整该 Product 广告组，不同步改动 DMOM1021 的 Keyword 组。", sku: "DMOM1021 · LFC-2B-680 / LFC-2W-680", adType: "Sponsored Products · Product", keywords: "Product Targeting", match: "不适用", bid: "$0.68 → $0.55（硬上限 $0.58）", budget: "$320/月 · Daily Cap $10.32", rule: "Day 7 先控 Cap；新增≥20点0单暂停。Day 14 ROAS≥4×、≥3单且 CVR≥2% 才加 Cap。" },
  { id: "dmom1021-keyword", parentSkus: ["DMOM1021"], priority: "P0", group: "Keyword 新建", adGroup: "YB_US_KW_DMOM1021_CORE_202608", campaignId: "新建后回填", title: "新建 DMOM1021 Keyword Core 广告组", detail: "Exact 承接已验证词，Phrase 低价拓词。创建后立即回填平台 Campaign ID，后续所有复盘使用该 ID。", sku: "DMOM1021 · LFC-2B-680 / LFC-2W-680", adType: "Sponsored Products · Keyword", keywords: "lateral filing cabinet; 2 drawer filing cabinet", match: "Exact / Phrase 分层", bid: "按词级设定", budget: "$380/月 · Daily Cap $12.26", rule: "初始 Paused；完成 US站点、Listing、关键词、Negative 双人 QA 后启用。" },
  { id: "dmom1022-product-us", parentSkus: ["DMOM1022"], priority: "P0", group: "Product 调整", adGroup: "Product US · DMOM1022-三抽活动柜", campaignId: "622721", title: "下调 DMOM1022 US Product Bid", detail: "只调整 US 广告组 622721；Canada 组 622722 保持独立预算和止损线。", sku: "DMOM1022 · MFC-D3-W / MFC-D3-B", adType: "Sponsored Products · Product · US", keywords: "Product Targeting", match: "不适用", bid: "$0.60 → $0.42（硬上限 $0.48）", budget: "$220/月 · Daily Cap $7.10", rule: "Live 与库存 ID 通过后执行；Day 14 达到放量 Gate 才增加 Cap。" },
  { id: "dmom1022-product-ca", parentSkus: ["DMOM1022"], priority: "P1", group: "Canada 限额", adGroup: "Product Canada · DMOM1022-三抽活动柜", campaignId: "622722", title: "保留 Canada 组并设置独立限额", detail: "Canada 组不与 US 组合并调整；单独记录 Bid、Cap、花费与订单。", sku: "DMOM1022 · MFC-D3-W / MFC-D3-B", adType: "Sponsored Products · Product · Canada", keywords: "Product Targeting", match: "不适用", bid: "$0.50 → $0.45（硬上限 $0.50）", budget: "$50/月 · Daily Cap $1.61", rule: "累计花费 $50 硬停；新增≥20点0单暂停该 Canada Campaign。" },
  { id: "dmom1022-keyword", parentSkus: ["DMOM1022"], priority: "P1", group: "Keyword 新建", adGroup: "YB_US_KW_DMOM1022_MOBILE_202608", campaignId: "新建后回填", title: "新建 DMOM1022 Mobile Keyword 广告组", detail: "只投 mobile、rolling 和 3-drawer 结构词。创建后回填真实 Campaign ID，不与 Product 或 Canada 组混记。", sku: "DMOM1022 · MFC-D3-W / MFC-D3-B", adType: "Sponsored Products · Keyword · US", keywords: "mobile file cabinet; rolling file cabinet; 3 drawer file cabinet", match: "Exact / Phrase 分层", bid: "按词级设定", budget: "$120/月 · Daily Cap $3.87", rule: "初始 Paused；前14天不投 generic；新增≥20点0单暂停该词。" },
  { id: "dmom1019-product", parentSkus: ["DMOM1019"], priority: "P1", group: "Product 条件重启", adGroup: "Product US · DMOM1019-窄三-VFC-3B", campaignId: "622737", title: "按 Gate 条件重启 DMOM1019 Product 组", detail: "后台 Listing 仍 Inactive 则否决启用；不得用 DMOM1019 的自然单或 Keyword 数据代替该 Product 组验收。", sku: "DMOM1019 · VFC-3B / VFC-3W", adType: "Sponsored Products · Product", keywords: "Product Targeting", match: "不适用", bid: "$0.58 → $0.38（硬上限 $0.45）", budget: "$90/月 · Daily Cap $2.90", rule: "Listing Active 与库存同时通过才重启；新增≥20点0单暂停。" },
  { id: "dmom1019-keyword", parentSkus: ["DMOM1019"], priority: "P1", group: "Keyword 新建", adGroup: "YB_US_KW_DMOM1019_CORE_202608", campaignId: "新建后回填", title: "新建 DMOM1019 Keyword Core 广告组", detail: "将已验证的 vertical / 3 drawer 词放入独立组。创建后回填真实 Campaign ID，与 622737 Product 组分开复盘。", sku: "DMOM1019 · VFC-3B / VFC-3W", adType: "Sponsored Products · Keyword", keywords: "vertical file cabinet; 3 drawer file cabinet; metal file cabinet", match: "Exact / Phrase 分层", bid: "按词级设定", budget: "$200/月 · Daily Cap $6.45", rule: "初始 Paused；US站点、Listing、词意和 Negative 双人 QA 通过后启用。" },
  { id: "dmom1003-product", parentSkus: ["DMOM1003"], priority: "P1", group: "Product 调整", adGroup: "Product US · HIGH_POTENTIAL_SKU-Wayfair(US)-0507", campaignId: "635903", title: "下调 4T-Kayak Product Bid 并独立复盘", detail: "只调整 635903；新建的 DMOM1003 Keyword 测试必须使用另一 Campaign ID。", sku: "DMOM1003 · 4T-Kayak", adType: "Sponsored Products · Product", keywords: "Product Targeting", match: "不适用", bid: "$0.75 → $0.55（硬上限 $0.60）", budget: "$90/月 · Daily Cap $2.90", rule: "4T-Kayak Live 且库存节点归属确认后执行；Backorder 立即暂停该 Campaign。" },
] as const;

type ManualAdTask = (typeof MANUAL_AD_TASKS)[number];
const MANUAL_AD_TASK_IDS = new Set<string>(MANUAL_AD_TASKS.map(task => task.id));
const manualTaskKey = (sku: string, taskId: string) => `${sku}::${taskId}`;
const MANUAL_AD_TASK_GROUPS = (() => {
  const groups: Array<{ sku: string; tasks: ManualAdTask[] }> = [];
  for (const task of MANUAL_AD_TASKS) {
    for (const sku of task.parentSkus) {
      let group = groups.find(item => item.sku === sku);
      if (!group) {
        group = { sku, tasks: [] };
        groups.push(group);
      }
      group.tasks.push(task);
    }
  }
  return groups;
})();
const MANUAL_AD_TASK_COUNT = MANUAL_AD_TASK_GROUPS.reduce((sum, group) => sum + group.tasks.length, 0);

const presetOptions = [
  ["today", "今天"], ["yesterday", "昨天"], ["7d", "最近 7 天"], ["14d", "最近 14 天"],
  ["30d", "最近 30 天"], ["month", "本月"], ["lastMonth", "上个月"], ["custom", "自定义日期"],
] as const;

function dateText(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return dateText(date);
}

function rangeFor(preset: string) {
  const today = dateText(new Date());
  if (preset === "today") return { start: today, end: today };
  if (preset === "yesterday") { const day = shiftDate(today, -1); return { start: day, end: day }; }
  if (["7d", "14d", "30d"].includes(preset)) return { start: shiftDate(today, -(Number(preset.replace("d", "")) - 1)), end: today };
  const [year, month] = today.split("-").map(Number);
  if (preset === "month") return { start: `${year}-${String(month).padStart(2, "0")}-01`, end: today };
  const lastMonth = new Date(Date.UTC(year, month - 2, 1, 12));
  const lastMonthEnd = new Date(Date.UTC(year, month - 1, 0, 12));
  return { start: dateText(lastMonth), end: dateText(lastMonthEnd) };
}

const adPresetOptions = [["7d","最近 7 天"],["14d","最近 14 天"],["month","本月"],["lastMonth","上月"],["custom","自定义"]] as const;

function adRangeFor(preset: string) {
  const today = dateText(new Date());
  if (preset === "7d") return { start: shiftDate(today, -6), end: today };
  if (preset === "14d") return { start: shiftDate(today, -13), end: today };
  if (preset === "month") return { start: `${today.slice(0, 7)}-01`, end: today };
  const [year, month] = today.split("-").map(Number);
  return { start: dateText(new Date(Date.UTC(year, month - 2, 1, 12))), end: dateText(new Date(Date.UTC(year, month - 1, 0, 12))) };
}

function money(value = 0) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value); }
function money2(value = 0) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
function percent(value = 0) { return new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 }).format(value); }
function metricCpc(metric?: AdMetric) { return metric?.clicks ? metric.spend / metric.clicks : 0; }
function adBudgetValue(value?: string) { const numeric=Number(value); return value&&Number.isFinite(numeric)?money2(numeric):value||"—"; }
function adSpendGapNote(coverage?: string) {
  if (coverage === "PENDING") return "Wayfair 广告数据 T+1 提供，当日广告费次日回传";
  if (coverage === "UNAVAILABLE" || coverage === "NO_DB") return "广告快照存储不可读，净利润暂不可计算";
  return "该周期广告快照缺失，到广告优化同步后才计净利润";
}
function change(current = 0, previous = 0) {
  if (!previous) return current ? "新发生" : "无变化";
  const value = (current - previous) / previous * 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}% 较前周期`;
}
function adDailySignal(row: { spend: number; orders: number; wscRoas: number }) {
  if (row.spend >= 20 && row.orders === 0) return { label: "无订单消耗", tone: "bad" };
  if (row.orders > 0 && row.wscRoas >= 4) return { label: "高效产出", tone: "good" };
  if (row.orders > 0) return { label: "有单观察", tone: "watch" };
  return { label: "样本较少", tone: "neutral" };
}
function SortHeader({ label, field, sort, onSort }: { label:string; field:string; sort:SortState; onSort:(field:string)=>void }) {
  const active=sort.key===field;
  return <button className={`sort-header ${active?'active':''}`} onClick={()=>onSort(field)} aria-label={`${label}，${active?(sort.direction==='desc'?'降序':'升序'):'点击排序'}`}>{label}<i>{active?(sort.direction==='desc'?'↓':'↑'):'↕'}</i></button>;
}
type EvidenceReport = { title: string; file: string; kind: string; date?: string; summary: string; metrics?: string[][]; sections: string[][] };
type UploadedReport = { id: string; fileName: string; title: string; kind: string; contentType: string; createdAt: string };
const REPORTS: EvidenceReport[] = [
  { title: "7月推广计划 v3.1 真实基线", file: "Wayfair_7月推广计划_v3真实基线_20260623.html", kind: "当前计划", date: "2026/06/23", summary: "以6月真实基线制定7月128 Orders目标、$790广告预算、SKU责任和活动节奏。", metrics: [["主目标","128 Orders"],["真实基线","102 Orders"],["广告预算","$790"],["预计净利","$3,394"],["冲刺目标","145 Orders"]], sections: [["01","目标阶梯","保底112、主目标128、冲刺145；长尾激活待新产品SOP，不计入承诺目标。"],["02","SKU责任","10个Listing拆解128 Orders；系统用订单API关联实际订单与件数。"],["03","数据冲突","正文基线102、SKU表合计100；DMOM1022正文10单、表格5单，均保留待确认。"],["04","广告联动","月预算、SKU角色、利润与链接Gate直接约束当前广告动作。"]] },
  { title: "Black Friday in July 官宣与广告策略", file: "Wayfair 北美地区 Black Friday in July官宣定档！.pdf", kind: "活动", date: "2026/07/16", summary: "官方活动规则已转成独立阶段策略，活动预算包含在7月$790内。", metrics: [["北美主活动","07/23-07/28"],["Canada Co-Invest","07/23-07/27"],["Flash窗口","07/26-07/27"],["活动广告上限","$330"],["商品锁定","07/21-07/28"]], sections: [["01","资格与费用","Flash Deal须07/17前确认；受邀SKU上线收取$75固定费，必须计入利润。"],["02","投放节奏","资格确认、预热、Member Day衔接、主活动、Flash窗口、收尾六阶段独立预算。"],["03","价格与商品","普通折扣不叠加；Conditional Offer会叠加；商品编辑在07/21-07/28锁定。"],["04","执行护栏","促销、利润、库存、链接和历史ROAS全部通过后，才释放活动Bid与Cap。"]] },
  { title: "8月150单完整增长 Playbook", file: "YB店_8月150单完整增长Playbook.html", kind: "历史来源", date: "2026/07/15", summary: "原始SKU、渠道和Scorecard来源；冲突口径已由2026-07-28授权执行策略替代。", metrics: [["当前目标","150 Orders"],["旧口径","150 Units（仅库存参考）"],["基础预算","$1,800"],["首阶段总上限","$1,861.10"],["第二阶段上限","$2,019.57"]], sections: [["01","目标锁定","150 Orders为冲刺目标；旧Units责任表不再作为经营目标。"],["02","预算锁定","基础预算$1,800；Canary最大增量亏损$61.10。"],["03","周节奏","W1/W2/W3/W4/收口累计目标25/59/98/136/150。"],["04","经营护栏","促销、利润、库存、履约、Listing与映射门禁全部通过后才进入第二阶段。"]] },
  { title: "2026年6月月度复盘总览", file: "index.html", kind: "REVIEW", summary: "6月经营基线、诊断结论和全部复盘证据索引。", sections: [["01","经营基线","6月SKU拆解基线90 Units，为8月150 Units计划提供增量基准。"],["02","核心矛盾","流量并非唯一瓶颈；库存、Catalog、Listing承接和广告结构共同限制增长。"],["03","证据边界","不同报告日期和口径必须保留来源，不用下一月目标冒充当前月目标。"],["04","进入计划","复盘结论已结构化为SKU责任、预算Gate和周里程碑。"]] },
  { title: "店铺诊断报告", file: "YB店_店铺诊断报告.html", kind: "诊断", summary: "店铺增长是否成立、主要瓶颈和优先级判断。", sections: [["01","增长判断","增长成立，但不能靠无差别增加广告预算。"],["02","结构问题","头部SKU贡献集中，长尾商品和低质量链接稀释效率。"],["03","优先级","先修库存与目录，再修链接承接，最后扩广告。"],["04","验收","每项诊断必须落到负责人、期限和可量化验收条件。"]] },
  { title: "SKU健康体检", file: "YB店_SKU健康体检.html", kind: "SKU", summary: "90个Part的销量、Sessions/CVR、评分评论、目录和整改证据。", sections: [["01","商品范围","覆盖90个Supplier Part，不再只展示Catalog当前状态。"],["02","质量维度","Sessions、CVR、评分评论、内容问题、图片和目录状态共同判断链接质量。"],["03","运营分组","区分主力、修复、自然观察和永久剔除池。"],["04","广告联动","链接质量不通过时，只生成整改任务，不允许加Bid或扩预算。"]] },
  { title: "SKU广告重构执行清单", file: "YB店_SKU广告重构执行清单_2026-07-15.html", kind: "广告", summary: "SKU到Campaign/Listing的执行映射、参数和人工动作。", sections: [["01","执行层级","父体用于运营审阅；精确Listing载荷才可进入API Dry-run。"],["02","API边界","只有 Listing Bid 可由中台执行；Campaign状态、Daily Cap、tROAS、关键词和否词均不自动写入。"],["03","安全机制","一次只改变一个变量，保存前值、建议值、回滚值。"],["04","复查","D7只做安全止损；D21/D28用成熟归因评估结果。"]] },
  { title: "广告深度分析：商品+关键词", file: "YB店_广告深度分析_商品+关键词.html", kind: "广告", summary: "商品广告、关键词、搜索词与归因效率分析。", sections: [["01","历史证据","并列成熟7天、前7天、滚动28天和月累计。"],["02","漏斗","曝光→点击→转化→WSC ROAS逐层定位，不直接用订单数下结论。"],["03","盈利线","每个SKU按贡献毛利计算自己的保本ROAS。"],["04","数据成熟","14天归因未成熟的周期只观察，不进入执行审批。"]] },
  { title: "广告诊断报告", file: "YB店_广告诊断报告.html", kind: "广告", summary: "广告账户问题、止损对象和预算迁移机会。", sections: [["01","账户对账","Campaign与Listing花费需对账后才可信。"],["02","止损","成熟点击≥20且0单进入暂停或降Bid候选。"],["03","扩量","盈利、质量、库存、计划和预算余量全部通过才放量。"],["04","禁止项","计划预算为0或永久剔除对象禁止任何加价。"]] },
  { title: "150单SKU与广告预算分配论证", file: "YB店_150单SKU与广告预算分配论证_2026-07-15.html", kind: "预算", summary: "为什么给每个SKU目标与预算，以及释放边界。", sections: [["01","主力","DMOM1021目标50、预算$700；DMOM1022目标30、预算$340。"],["02","赢家","DMOM1019目标21、预算$290，以高效Keyword为主。"],["03","修复池","DMOM1018/1017/1000合计预算仅$50，严格Gate。"],["04","零预算池","DMOM1025/1026/1016与DRCI1007不得用广告救量。"]] },
  { title: "Conditional Offers 8月计划", file: "YB店_ConditionalOffers_8月150单增长计划.html", kind: "OFFER", summary: "Offer候选、利润底线、实验组与退出条件。", sections: [["01","盈利口径","WSC收入减出库成本、Offer Owed、广告和其他变动成本。"],["02","实验原则","A/B/C小流量验证；无增量或毛利<20%立即结束。"],["03","目标","Offer约20单，但不能以牺牲毛利换完成率。"],["04","归因","价格、Offer和广告同期变化必须记录，避免错误归因。"]] },
  { title: "新增四报前后对比", file: "YB店_新增四报前后对比.html", kind: "证据", summary: "新增报告对既有结论、目标和执行口径的修正。", sections: [["01","变化记录","保留旧结论和新证据，说明为什么修正。"],["02","数据冲突","冲突字段进入待确认，不选择性搬运。"],["03","影响范围","目标、预算、Campaign和SKU责任同步更新。"],["04","审计","每次计划变更保留时间、来源和责任人。"]] },
  { title: "店铺对标：类目均值", file: "YB店_店铺对标_类目均值.html", kind: "对标", summary: "店铺与类目均值在流量、转化和商品结构上的差异。", sections: [["01","用途","对标用于定位差距，不直接生成广告动作。"],["02","流量","曝光分位高但转化弱时，优先修承接。"],["03","转化","评分、评论、价格和内容是CVR诊断上下文。"],["04","目标","用类目基准校验计划是否可达，而非机械追平。"]] },
  { title: "运营ToDoList详细指引", file: "YB店_运营ToDoList_详细指引.html", kind: "任务", summary: "诊断结论到负责人、期限和验收物的运营任务。", sections: [["01","任务化","每项结论都有对象、负责人、截止日和验收物。"],["02","优先级","先处理影响业绩的P0/P1，再处理信息类待办。"],["03","跨模块","库存、商品、广告和月报共享同一任务状态。"],["04","闭环","完成后记录结果并进入下一次复盘证据。"]] },
  { title: "执行清单 XLSX", file: "YB店_SKU广告重构执行清单_2026-07-15.xlsx", kind: "表格", summary: "可下载、核对和执行的SKU广告参数账本。", sections: [["01","精确载荷","保存Listing、Campaign、当前Bid和建议Bid。"],["02","人工动作","Daily Cap、tROAS、关键词与否词分开列示。"],["03","回滚","每个动作保存原值和触发回滚的条件。"],["04","审批","个人测试阶段仅Dry-run，不执行生产写入。"]] },
];

function ShellHeader({ active, activeSub, onNavigate, onSubNavigate }: { active: View; activeSub: SubView | null; onNavigate: (view: View) => void; onSubNavigate: (view: SubView) => void }) {
  const [mobileOpen,setMobileOpen]=useState(false);
  const navigate=(next:View)=>{onNavigate(next);setMobileOpen(false);};
  return <aside className="sidebar">
    <button className="brand" onClick={() => navigate("dashboard")}><span>W</span><strong>Wayfair AI</strong><small>运营中台</small></button>
    <button className="mobile-nav-toggle" aria-expanded={mobileOpen} aria-controls="app-navigation" onClick={()=>setMobileOpen(value=>!value)}><span>{mobileOpen?'关闭':'菜单'}</span><b>{PRIMARY_NAV.find(item=>item.id===active)?.label||SYSTEM_NAV.find(item=>item.id===active)?.label}</b></button>
    <div className={`sidebar-navigation${mobileOpen?' open':''}`} id="app-navigation">
      <nav className="nav" aria-label="主导航">
        {PRIMARY_NAV.map((item) => <div className={`nav-group ${active === item.id ? "expanded" : ""}`} key={item.id}><button className={active === item.id ? "active" : ""} aria-current={active===item.id&&!SUB_NAV[item.id]?.length?'page':undefined} aria-expanded={SUB_NAV[item.id]?.length?active===item.id:undefined} onClick={() => navigate(item.id)}>{item.label}</button>{active === item.id && SUB_NAV[item.id]?.length ? <div className="nav-submenu" aria-label={`${item.label}子菜单`}>{SUB_NAV[item.id]?.map((child) => <button key={child.id} className={activeSub === child.id ? "active" : ""} aria-current={activeSub===child.id?'page':undefined} onClick={() => {onSubNavigate(child.id);setMobileOpen(false);}}>{child.label}</button>)}</div> : null}</div>)}
      </nav>
      <nav className="nav utility-nav" aria-label="系统导航">
        {SYSTEM_NAV.map((item) => <button key={item.id} className={active === item.id ? "active" : ""} aria-current={active===item.id?'page':undefined} onClick={() => navigate(item.id)}>{item.label}</button>)}
      </nav>
    </div>
    <div className="system"><i></i><span><strong>生产数据已连接</strong><small>写操作需人工确认</small></span></div>
  </aside>;
}

function Hero({ eyebrow, title, text, side }: { eyebrow: string; title: string; text: string; side?: React.ReactNode }) {
  void eyebrow; void text;
  return <header className="hero page-heading"><h1>{title}</h1>{side}</header>;
}

function useEmailDailyBrief(date: string) {
  const cacheKey = `email:daily:${date}`;
  const [brief, setBrief] = useState<EmailBrief | null>(readClientCache<EmailBrief>(cacheKey));
  const [loading, setLoading] = useState(!brief);
  const [error, setError] = useState("");

  useEffect(() => {
    const cached = readClientCache<EmailBrief>(cacheKey);
    const controller = new AbortController();
    if (cached) {
      queueMicrotask(() => { if (!controller.signal.aborted) { setBrief(cached); setLoading(false); setError(""); } });
    } else {
      queueMicrotask(() => { if (!controller.signal.aborted) { setLoading(true); setError(""); } });
    }
    fetch(`/api/email/daily?date=${encodeURIComponent(date)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { const body = await response.json() as EmailBrief; if (!response.ok) throw new Error(body.error || "Outlook 日报读取失败"); return body; })
      .then(body => { writeClientCache(cacheKey, body); setBrief(body); })
      .catch(reason => { if (reason.name !== "AbortError") setError(reason.message || "Outlook 日报读取失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cacheKey, date]);

  return { brief, loading, error };
}

function useEmailBriefDates() {
  const [dates, setDates] = useState<string[]>(readClientCache<string[]>("email:daily:available") || []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/email/daily?available=1", { signal: controller.signal })
      .then(async response => { const body = await response.json() as { dates?: string[]; error?: string }; if (!response.ok) throw new Error(body.error || "日报日期读取失败"); return body.dates || []; })
      .then(value => { writeClientCache("email:daily:available", value); setDates(value); })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return dates;
}

function Dashboard() {
  const initialRange = rangeFor("today");
  const initialDashboardCacheKey=`orders:${initialRange.start}:${initialRange.end}`;
  const retainedDashboard=dashboardSnapshot??readClientCache<OrderSummary>(initialDashboardCacheKey,CLIENT_CACHE_RETENTION_MS);
  const [preset, setPreset] = useState("today");
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);
  const [data, setData] = useState<OrderSummary | null>(retainedDashboard);
  const [loading, setLoading] = useState(!retainedDashboard);
  const [refreshing,setRefreshing]=useState(false);
  const [forceRefresh,setForceRefresh]=useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const cacheKey = `orders:${start}:${end}`;
    const fresh=readClientCache<OrderSummary>(cacheKey);
    const retained=readClientCache<OrderSummary>(cacheKey,CLIENT_CACHE_RETENTION_MS);
    const controller = new AbortController();
    if (fresh&&!forceRefresh) {
      queueMicrotask(()=>{if(!controller.signal.aborted){dashboardSnapshot=fresh;setData(fresh);setLoading(false);setRefreshing(false);setError("");}});
      return () => controller.abort();
    }
    if(retained) queueMicrotask(()=>{if(!controller.signal.aborted){dashboardSnapshot=retained;setData(retained);setLoading(false);setRefreshing(true);setError("");}});
    else queueMicrotask(()=>{if(!controller.signal.aborted){setData(null);setLoading(true);setRefreshing(false);}});
    fetch(`/api/orders/summary?start=${start}&end=${end}${forceRefresh?"&refresh=1":""}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as OrderSummary;
        if (!response.ok) throw new Error(body.error || "订单数据读取失败");
        return body;
      })
      .then((body) => { dashboardSnapshot=body;setData(body);writeClientCache(cacheKey, body); })
      .catch((reason) => { if (reason.name !== "AbortError") setError(reason.message || "订单数据读取失败"); })
      .finally(() => { if (!controller.signal.aborted) {setLoading(false);setRefreshing(false);setForceRefresh(false);} });
    return () => controller.abort();
  }, [start, end, forceRefresh]);

  function selectPreset(next: string) {
    setPreset(next);
    if (next !== "custom") { const range = rangeFor(next); if (range.start !== start || range.end !== end) { setLoading(true); setError(""); setStart(range.start); setEnd(range.end); } }
  }

  function refreshDashboard(){
    setError("");
    setRefreshing(true);
    setForceRefresh(true);
  }

  const current = data?.current;
  const previous = data?.previous;
  const chartMax = Math.max(1, ...(data?.daily || []).map((item) => Number(item.revenue)));
  const rangeLabel = start === end ? start : `${start} - ${end}`;
  const loadingLabel=(retained:boolean)=>retained?"后台更新中":"同步中";
  return <>
    <Hero eyebrow="ORDERS API · OPERATING BRIEF" title="Dashboard" text={`${rangeLabel} · 订单业绩与经营概览`} side={<div className="hero-side"><b>{refreshing ? loadingLabel(true) : loading ? loadingLabel(false) : error ? "需检查" : "已更新"}</b><span>{data?.sync.stale ? "正在使用最近缓存" : "Ops API（库存 + 订单）"}</span></div>} />
    <section className="date-console" aria-label="经营周期">
      <div className="preset-list">{presetOptions.map(([id, label]) => <button key={id} className={preset === id ? "active" : ""} onClick={() => selectPreset(id)}>{label}</button>)}</div>
      {preset === "custom" && <div className="custom-range"><label>开始<input type="date" value={start} max={end} onChange={(event) => {setLoading(true);setError("");setStart(event.target.value);}} /></label><label>结束<input type="date" value={end} min={start} onChange={(event) => {setLoading(true);setError("");setEnd(event.target.value);}} /></label></div>}
      <div className="dashboard-sync-tools"><span className={error ? "sync-state error" : "sync-state"}>{error || (data?.sync.stale ? `同步失败，显示缓存：${data.sync.error}` : data?.sync.syncedAt ? `最近同步 ${new Date(data.sync.syncedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}` : "正在连接订单数据")}</span><button type="button" className={`dashboard-refresh ${refreshing?"refreshing":""}`} aria-label="立即刷新订单数据" title="立即刷新" disabled={refreshing} onClick={refreshDashboard}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7"/></svg></button></div>
    </section>
    <section className="stat-grid six order-kpis">
      {[
        [loading ? "-" : money(current?.revenue), "销售额", change(current?.revenue, previous?.revenue)],
        [loading ? "-" : String(current?.orders || 0), "订单", change(current?.orders, previous?.orders)],
        [loading ? "-" : String(current?.units || 0), "件数", change(current?.units, previous?.units)],
        [loading ? "-" : money(current?.aov), "客单价", change(current?.aov, previous?.aov)],
        [loading ? "-" : money(current?.advertisingBeforeGrossProfit), "广告前商品毛利", `成本覆盖 ${Math.round((current?.costCoverage || 0) * 100)}% · 未覆盖部分按 ${((current?.marginRate || .2826) * 100).toFixed(2)}%估算`],
        [loading ? "-" : current?.contributionAfterAds == null ? "待广告同步" : money(current.contributionAfterAds), "广告后店铺贡献", current?.advertisingSpend == null ? adSpendGapNote(current?.advertisingCoverage) : `已扣广告费 ${money(current.advertisingSpend)} · ${current.advertisingCoverage === 'FULL' ? '完整覆盖' : '部分覆盖（当期仍在累计）'}`],
      ].map(([value,label,note]) => <article className={`stat ${/毛利|贡献/.test(label) ? "profit-stat" : ""}`} key={label}><strong>{value}</strong><span>{label}</span><small>{note}</small></article>)}
    </section>
    <section className="card order-performance">
      <div className="section-head"><div><span>订单业绩</span><h2>{rangeLabel} 订单走势</h2></div><b>{data?.sync.refreshed ? "API 已刷新并写入缓存" : "每小时后台同步，读取已保存快照"}</b></div>
      <div className="order-performance-body">
        <div className="daily-bars">{(data?.daily || []).length ? data?.daily.map((item) => <div key={item.date} title={`${item.date} · ${money(item.revenue)} · ${item.orders} 单`}><span>{money(item.revenue)}</span><i style={{ height: `${Math.max(4, Number(item.revenue) / chartMax * 100)}%` }}></i><b>{item.date.slice(5)}</b></div>) : <p>{loading ? "正在拉取订单数据…" : "所选周期暂无订单"}</p>}</div>
        <aside className="top-skus"><span>热销 SKU</span>{(data?.topSkus || []).slice(0, 5).map((item, index) => <div key={item.partNumber}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{item.partNumber}</strong><small>{item.units} 件</small></span><em>{money(item.revenue)}</em></div>)}{!data?.topSkus?.length && <p>暂无 SKU 销售记录</p>}</aside>
      </div>
    </section>
  </>;
}

function Daily() {
  const today = dateText(new Date());
  const [date, setDate] = useState(today);
  const [done, setDone] = useState<string[]>([]);
  const [previewEmail, setPreviewEmail] = useState<EmailItem | null>(null);
  const [importJson, setImportJson] = useState("");
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const { brief, loading, error } = useEmailDailyBrief(date);
  const availableDates = useEmailBriefDates();
  const dates = [...new Set([today, ...availableDates])].sort((left, right) => right.localeCompare(left)).slice(0, 31);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of brief?.items || []) counts.set(item.category || "其他运营", (counts.get(item.category || "其他运营") || 0) + 1);
    return [...counts.entries()];
  }, [brief]);
  useEffect(() => {
    if (!previewEmail) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [previewEmail]);
  const previewFinancial = previewEmail ? financialDetailsForEmail(previewEmail) : null;
  const previewInvoiceIds = previewFinancial?.invoiceIds ?? [];
  const previewOrder = previewEmail?.order;
  async function importDailyBrief() {
    setImporting(true);
    setImportStatus("");
    try {
      const payload = JSON.parse(importJson) as EmailBrief;
      const response = await fetch("/api/email/daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { ok?: boolean; briefDate?: string; error?: string };
      if (!response.ok || !result.ok || !result.briefDate) throw new Error(result.error || "日报补录失败");
      invalidateClientCache(`email:daily:${result.briefDate}`);
      invalidateClientCache("email:daily:available");
      setImportStatus(`${result.briefDate} 已补录，正在刷新…`);
      window.setTimeout(() => window.location.reload(), 350);
    } catch (reason) {
      setImportStatus(reason instanceof Error ? reason.message : "日报补录失败");
      setImporting(false);
    }
  }
  return <>
    <Hero eyebrow="OUTLOOK · WAYFAIR OPERATING BRIEF" title="运营日报" text="覆盖订单履约、活动广告、绩效合规、账单回款与售后扣款；按日保存快照" side={<div className="hero-side"><b>{loading ? "同步中" : error ? "需检查" : `${brief?.summary.total || 0} 封`}</b><span>{brief?.syncedAt ? `同步 ${new Date(brief.syncedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}` : "等待同步"}</span></div>} />
    <section className="daily-date-tabs" aria-label="日报日期">{dates.map(value => <button key={value} className={date === value ? "active" : ""} onClick={() => { setDate(value); setPreviewEmail(null); }}>{value === today ? "今天" : value.slice(5)}<small>{value}</small></button>)}</section>
    <details className="daily-import card"><summary>补录日报</summary><div><label>日报 JSON<textarea aria-label="日报 JSON" value={importJson} onChange={(event) => setImportJson(event.target.value)} placeholder="粘贴完整日报 JSON" /></label><button type="button" className="primary" disabled={importing || !importJson.trim()} onClick={importDailyBrief}>{importing ? "写入中…" : "写入日报"}</button>{importStatus && <p role="status">{importStatus}</p>}<small>仅已登录的私有站点会话可写入；自动同步正常时无需使用。</small></div></details>
    {error && <div className="inline-error">{error}</div>}
    <section className="stat-grid four daily-kpis">
      <article className="stat"><strong>{brief?.summary.total ?? "-"}</strong><span>相关邮件</span><small>{brief?.source || "读取中"}</small></article>
      <article className="stat"><strong>{brief?.summary.unread ?? "-"}</strong><span>未读</span><small>需要优先打开确认</small></article>
      <article className="stat"><strong>{brief?.summary.actionRequired ?? "-"}</strong><span>需跟进</span><small>最高优先级 {brief?.summary.highestPriority || "-"}</small></article>
      <article className="stat"><strong>{categories.length}</strong><span>邮件类型</span><small>{categories.map(([category]) => category).join(" · ") || "暂无数据"}</small></article>
    </section>
    <section className="daily-report-grid">
      <article className="card daily-mail-card"><div className="section-head"><div><span>ALL WAYFAIR MAIL</span><h2>{date} 邮件明细</h2></div><b>{brief?.items.length || 0} 封已分类</b></div><div className="outlook-mail-list daily-mail-list">{(brief?.items || []).map(item => <button type="button" className="daily-mail-row" onClick={() => setPreviewEmail(item)} key={item.id}><span className={`mail-priority ${item.priority.toLowerCase()}`}>{item.priority}</span><span><b>{item.subject}</b><small>{item.category || "其他运营"} · {item.summary}</small></span><span><em>{item.unread ? "未读" : "已读"}</em><small>{item.owner} · {item.status}</small></span></button>)}{!loading && !brief?.items.length && <p className="empty-state">该日没有已保存的 Wayfair 邮件快照。</p>}</div></article>
      <aside className="daily-side-stack"><article className="card category-card"><div className="section-head"><div><span>MAIL MIX</span><h2>分类分布</h2></div></div><div>{categories.map(([category, count]) => <p key={category}><b>{category}</b><span>{count} 封</span></p>)}{!categories.length && <p>暂无分类数据。</p>}</div></article><article className="card todo-card"><h2>当天待办</h2>{(brief?.tasks || []).map(task => <label key={task.id}><input type="checkbox" checked={done.includes(task.id)} onChange={() => setDone(value => value.includes(task.id) ? value.filter(id => id !== task.id) : [...value, task.id])}/><span><b>{task.title}</b><small>{task.owner} · {task.priority} · 截止 {task.dueDate} · {task.status}</small></span></label>)}{!brief?.tasks.length ? <p>该日没有从邮件提取的待办。</p> : null}</article></aside>
    </section>
    {!!brief?.sections?.length && <section className="daily-insights">{brief.sections.map((section, index) => <article className={`card daily-insight ${section.tone || ""}`} key={`${section.title}-${index}`}><span>运营摘要</span><h2>{section.title}</h2><p>{section.body}</p></article>)}</section>}
    {previewEmail && <div className="email-preview-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewEmail(null); }} onKeyDown={(event) => { if (event.key === "Escape") setPreviewEmail(null); }}>
      <section className={`email-preview-dialog ${previewOrder ? "has-order-details" : ""}`} role="dialog" aria-modal="true" aria-labelledby="email-preview-title">
        <header><div><span>{previewEmail.category || "其他运营"} · {previewEmail.priority}</span><h2 id="email-preview-title">{previewEmail.subject}</h2></div><button type="button" autoFocus aria-label="关闭邮件预览" onClick={() => setPreviewEmail(null)}>×</button></header>
        <div className="email-preview-meta"><div><span>发件人</span><b>{previewEmail.sender}</b></div><div><span>收件时间</span><b>{new Date(previewEmail.receivedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</b></div><div><span>处理状态</span><b>{previewEmail.unread ? "未读" : "已读"} · {previewEmail.status}</b></div><div><span>负责人</span><b>{previewEmail.owner}</b></div></div>
        {previewOrder && <section className="email-order-summary" aria-label="订单信息"><header><div><span>ORDER DETAILS</span><h3>订单信息</h3></div><b>{previewOrder.items.length} 个 SKU</b></header><div className="email-order-kpis"><article><span>订单号</span><strong>{previewOrder.poNumber}</strong></article><article><span>订单数量</span><strong>{previewOrder.totalQuantity}</strong><small>Units</small></article><article><span>订单金额</span><strong>{previewOrder.currency} {previewOrder.totalAmount.toFixed(2)}</strong><small>Order total</small></article></div><div className="email-order-lines"><div className="email-order-line head"><span>SKU</span><span>商品名称</span><span>数量</span><span>单价</span><span>小计</span></div>{previewOrder.items.map((item, index) => <div className="email-order-line" key={`${item.sku}-${index}`}><b>{item.sku}</b><span>{item.name || "商品名待同步"}</span><strong>{item.quantity}</strong><span>{previewOrder.currency} {item.unitPrice.toFixed(2)}</span><strong>{previewOrder.currency} {(item.quantity * item.unitPrice).toFixed(2)}</strong></div>)}</div><div className="email-order-action"><span>履约要求</span><p>{previewEmail.bodyPreview?.split("\n")[0] || previewEmail.summary}</p></div></section>}
        {previewFinancial?.isFinancial && <section className="email-finance-summary" aria-label="财务信息"><header><div><span>FINANCE DETAILS</span><h3>汇款核对</h3></div><b>{previewFinancial.amountLabel === "待邮件同步" ? "待核对" : "数据完整"}</b></header><div className="email-finance-primary"><article><span>实际汇款</span><strong>{previewFinancial.amountLabel}</strong><small>{previewFinancial.currency}</small></article><article><span>汇款单号</span><strong>{previewFinancial.remittanceId}</strong><small>Remittance ID</small></article><article><span>付款日期</span><strong>{previewFinancial.paymentDate}</strong><small>Payment date</small></article><article><span>付款方式</span><strong>{previewFinancial.paymentMethod}</strong><small>Payment method</small></article></div><div className="email-finance-adjustments"><article><span>发票货值</span><strong>{previewFinancial.grossAmountLabel}</strong></article><article><span>质量扣款</span><strong>{previewFinancial.allowanceAmountLabel}</strong></article><article><span>早付折扣</span><strong>{previewFinancial.epdAmountLabel}</strong></article><article><span>服务费</span><strong>{previewFinancial.serviceFeeAmountLabel}</strong></article></div><div className="email-finance-invoices"><span>关联发票 · {previewInvoiceIds.length} 张</span><p>{previewInvoiceIds.length ? previewInvoiceIds.join(" · ") : "待邮件同步"}</p></div></section>}
        {!previewOrder && !previewFinancial?.isFinancial && <div className="email-preview-content"><span>邮件内容预览</span><p>{previewEmail.bodyPreview || previewEmail.summary}</p></div>}
        <footer>邮件详情已在运营中台内展示，不会跳转到 Outlook。</footer>
      </section>
    </div>}
  </>;
}

function Plan({ embedded = false, onOpenReview, tab, onTabChange }: { embedded?: boolean; onOpenReview: () => void; tab: PlanSection; onTabChange: (tab: PlanSection) => void }) {
  const [data,setData]=useState<PlanProgress|null>(null); const [error,setError]=useState('');
  useEffect(()=>{const cached=readClientCache<PlanProgress>(PLAN_PROGRESS_CACHE_KEY);if(cached){queueMicrotask(()=>setData(cached));return;}fetch('/api/plan/progress').then(async r=>{const body=await r.json() as PlanProgress;if(!r.ok)throw new Error(body.error||'计划读取失败');return body;}).then(body=>{setData(body);writeClientCache(PLAN_PROGRESS_CACHE_KEY,body);}).catch(e=>setError(e.message));},[]);
  const p=data?.progress; const actual=data?.actual;
  const salesSummary=data?.nextPlan?.salesPlanSummary;
  const promotionSummary=data?.nextPlan?.promotionSummary;
  const executionPolicy=data?.nextPlan?.executionPolicy;
  const executionStage=data?.nextPlan?.executionStage;
  const salesRoleNames:Record<string,string>={VOLUME_CORE:'跑量核心',PROFIT_POOL:'利润池',CONTROLLED_GROWTH:'受控增长',REPAIR_ORGANIC:'修复 / 自然'};
  const salesPromotionStatusNames:Record<string,string>={SUBMITTED:'全部已提报',PARTIALLY_SUBMITTED:'部分提报',ON_HOLD:'暂缓'};
  return <>{!embedded&&<Hero eyebrow="MONTHLY OPERATING PLAN" title="目标与执行" text="6月复盘 → 7月真实基线执行 → 8月下一阶段准备；目标、利润与广告共用同一套运营计划" side={<button className="hero-button" onClick={onOpenReview}>查看完整复盘证据</button>} />}
    {tab!=='august'&&<><section className="context-strip" aria-label="经营月份导航"><button aria-label="打开6月复盘资料" onClick={onOpenReview}><span>复盘月</span><b>2026-06</b><small>经营事实已归档</small></button><button aria-label="查看7月执行计划" className="active" onClick={()=>onTabChange('july')}><span>当前经营月</span><b>{data?.currentOperatingMonth.month||'2026-07'} · 128 Orders</b><small>{data?.currentOperatingMonth.note||'真实基线计划读取中'}</small></button><button aria-label="查看8月推广计划" onClick={()=>onTabChange('august')}><span>下一计划月</span><b>2026-08 · 150 Orders</b><small>销售计划已确认 · 促销已提报同步</small></button></section>
    <section className={`event-cycle-banner card ${data?.eventCycle.mode||'loading'}`}><div><span>活动周期判断</span><h2>{data?.eventCycle.mode==='ACTIVE_PEAK'?'活动峰值期':data?.eventCycle.mode==='POST_PEAK_TRANSITION'?'活动峰值回落 / 长周期折扣切换':data?.eventCycle.mode==='ALWAYS_ON_PROMOTION'?'长周期折扣期':'活动周期加载中'}</h2></div><p>{data?.eventCycle.strategyNote||'正在读取活动窗口。'}<small>{data?.eventCycle.volatilityRule||'活动结束只作为业务波动解释候选。'}</small></p>{data?.eventCycle.attributionMaturesOn?<b>归因成熟 {data.eventCycle.attributionMaturesOn}</b>:<b>{data?.eventCycle.activeEvents?.map(item=>item.name).join(' · ')||'待确认'}</b>}</section>
    <section className="stat-grid six plan-kpis">{[
      [`${actual?.orders||0} / 128`,"7月订单完成",`${((p?.orderCompletion||0)*100).toFixed(1)}% · ${actual?.units||0} 件`],
      [`${p?.expectedOrders||0}`,"截至今日应完成",`节奏差 ${p?.paceGap||0} Orders`],
      [`${p?.forecastOrders||0}`,"月末订单预测",`剩余 ${p?.remainingOrders??128} Orders`],
      [`${p?.requiredDailyOrders||0}`,"后续所需日均",`按剩余天数计算 · 截至 ${data?.asOf||'-'}`],
      [actual?.adSpend==null?'待广告同步':money(actual.adSpend),"7月广告实际",`月预算 $790 · ${actual?.adCoverage||'未覆盖'}`],
      [actual?.contributionAfterAds==null?'待广告同步':money(actual.contributionAfterAds),"广告后店铺贡献",`${actual?.adCoverage==='FULL'?'广告完整覆盖':'广告仅部分覆盖'} · 成本覆盖 ${Math.round((actual?.costCoverage||0)*100)}% · 计划预计净利 $3,394`],
    ].map(([value,label,note])=><article className="stat" key={label}><strong>{value}</strong><span>{label}</span><small>{note}</small></article>)}</section>
    <div className="plan-tabs"><button className={tab==='july'?'active':''} onClick={()=>onTabChange('july')}>7月执行计划</button><button className={tab==='bfij'?'active':''} onClick={()=>onTabChange('bfij')}>BFIJ 活动广告策略</button><button onClick={()=>onTabChange('august')}>8月推广计划</button></div></>}
    {error&&<div className="inline-error">{error}</div>}
    {tab==='july'&&<><div className="plan-workspace">
      <article className="card target-card"><div className="section-head"><div><span>SKU 责任</span><h2>128 Orders责任拆解与订单API实际</h2></div><b>来源：真实基线 v3.1 · 2026-06-23</b></div><div className="plan-table july"><div className="plan-row head"><span>Listing / Part</span><span>6月基线</span><span>7月目标</span><span>实际订单 / 件</span><span>广告预算</span><span>策略与Gate</span></div>{(data?.listings||[]).map(item=><div className="plan-row" key={item.listing}><span><b>{item.listing}</b><small>{item.parts.join(' · ')}</small></span><span>{item.juneBaselineOrders}</span><span><b>{item.julyTargetOrders}</b></span><span><b>{item.actualOrders} / {item.actualUnits}</b><small>{money(item.actualRevenue)}</small></span><span>{money(item.budget)}<small>预计净利 {money(item.estimatedNetProfit)}</small></span><span><b>{item.role} · {item.tactic}</b><small>{item.gate}{item.sourceWarning?` · ${item.sourceWarning}`:''}</small></span></div>)}</div></article>
      <aside className="card milestone-card"><div className="section-head"><div><span>活动节点</span><h2>活动节奏</h2></div></div><div className="milestones">{(data?.events||[]).map(item=><div key={item.label}><b>{item.label}<small>{item.range}</small></b><strong>{item.range.includes('23')?'当前重点':'记录'}</strong><p>{item.note}</p></div>)}</div></aside>
    </div><div className="scope-alert"><b>来源口径冲突</b><span>{data?.plan.scopeWarning||'正在读取7月计划来源说明。'}</span></div></>}
    {tab==='bfij'&&<><section className="activity-brief card"><div><span>OFFICIAL EVENT · 2026</span><h2>{data?.activity.name||'Black Friday in July 广告策略'}</h2><p>北美主活动 {data?.activity.officialEventRange.replace('/',' → ')||'07/23 → 07/28'}；Canada Co-Invest {data?.activity.canadaCoInvestRange.replace('/',' → ')||'07/23 → 07/27'}。活动预算与7月月计划共用同一预算池。</p></div><div><small>活动窗口建议上限</small><strong>{money(data?.activity.strategyBudget||330)}</strong><span>/ 7月 {money(data?.activity.monthlyBudget||790)}</span></div></section>
      <section className="activity-facts"><article><span>07/17 前</span><b>确认 Flash Deal</b><small>只有收到邀请的SKU才进入；每个上线SKU固定费$75计入利润。</small></article><article><span>07/21-07/28</span><b>商品编辑锁定</b><small>Listing、折扣、媒体和变体必须在锁定前完成核查。</small></article><article><span>07/23-07/28</span><b>北美主活动</b><small>普通折扣不叠加；Conditional Offer会叠加，必须核算最终折扣。</small></article><article><span>14天后</span><b>归因复盘</b><small>活动当日只看预算、库存与异常，不用未成熟ROAS做结论。</small></article></section>
      <section className="card activity-plan"><div className="section-head"><div><span>活动投放</span><h2>六阶段广告执行表</h2></div><b>{data?.activity.budgetNote||'活动预算包含在7月总预算内'}</b></div><div className="phase-list"><div className="phase-head"><span>阶段</span><span>预算上限</span><span>Bid规则</span><span>Cap规则</span><span>运营目标</span></div>{(data?.activity.phases||[]).map(phase=><article className={data?.activity.activePhase===phase.id?'active':''} key={phase.id}><div><b>{phase.label}</b><small>{phase.range}</small></div><strong>{money(phase.budgetCap)}</strong><p>{phase.bidRule}</p><p>{phase.capRule}</p><p>{phase.objective}</p></article>)}</div></section>
      <div className="scope-alert"><b>7–8月共用 CPC 基准</b><span>Makeace 6月报告 P{data?.cpcPlan.sourcePage||22}：Filing {money2(data?.cpcPlan.categoryBenchmarks['Filing Cabinets']||.53)}、Bike/Rack {money2(data?.cpcPlan.categoryBenchmarks['Bike And Sport Racks']||.57)}。BM CPC是成本锚，不是直接写入的Bid；有订单组单次最多降10%，活动赢家只加Cap，且先保留8月责任库存。</span></div></>}
    {tab==='august'&&<div className="august-brief">
      <section className="august-command card">
        <header><div><span>2026年8月 · 已批准执行</span><h2>150 单，广告后利润率守住 10%–15%</h2><p>促销和多件优惠已经提报。8月只围绕销量、利润和库存三条线执行，不再增加新口径。</p></div><b>授权阶段 {executionStage?.ready?'2':'1'} · 07/28</b></header>
        <div className="august-command-body">
          <article className="august-target"><span>订单目标</span><strong>{salesSummary?.targetOrders||150}</strong><small>7月月末预测 {data?.nextPlan.salesPlan.currentForecastOrders||56.5} 单，8月需要新增约 {Math.round((salesSummary?.targetOrders||150)-(data?.nextPlan.salesPlan.currentForecastOrders||56.5))} 单</small></article>
          <div className="august-pulse">
            <article><span>广告后利润率</span><strong>{percent(promotionSummary?.projectedPostAdMargin||0)}</strong><small>压力情景 {percent(promotionSummary?.stressPostAdMargin||0)} · 硬底线 10%</small></article>
            <article><span>首阶段广告总上限</span><strong>{money(executionStage?.authorizedAdCap||executionPolicy?.stageOneAdCap||0)}</strong><small>基础 {money(executionPolicy?.baseAdBudget||0)} + Canary {money(executionPolicy?.canaryLossCap||0)} · 第二阶段 {money(executionPolicy?.stageTwoAdCap||0)}</small></article>
            <article><span>促销覆盖</span><strong>{promotionSummary?.submittedParts||0}<em> / {promotionSummary?.totalParts||21}</em></strong><small>{promotionSummary?.heldParts||0} 个保护款暂缓 · 多件优惠 {promotionSummary?.quantityPromotionParts||0} 个</small></article>
          </div>
        </div>
        <footer><b>本月判断：</b><span>用利润款补贴跑量款；活动订单按 60% 建模，买 2 件优惠按 15% 建模。原销售预算 {executionPolicy?.retiredAdBudgets.map(money).join('、')||'$2,700、$4,050'} 已废止。</span></footer>
      </section>

      <section className="august-operating-grid">
        <article className="card august-allocation">
          <div className="section-head"><div><span>ORDER OWNERSHIP</span><h2>150 单由谁完成</h2></div><b>按目标单量排序</b></div>
          <div className="august-allocation-list">{[...(data?.nextPlan.salesPlanRows||[])].sort((a,b)=>b.targetOrders-a.targetOrders).map(item=><article key={item.listing}>
            <div><b>{item.listing}</b><small>{item.parts.join(' · ')}</small></div>
            <span className={`sales-role ${item.role.toLowerCase()}`}>{salesRoleNames[item.role]||item.role}</span>
            <progress max={salesSummary?.targetOrders||150} value={item.targetOrders}/>
            <strong>{item.targetOrders}<small>单</small></strong>
          </article>)}</div>
          <footer><b>前三组承担 {((data?.nextPlan.salesPlanRows||[]).slice().sort((a,b)=>b.targetOrders-a.targetOrders).slice(0,3).reduce((sum,item)=>sum+item.targetOrders,0))} 单</b><span>主力是 DMOM1021、DMOM1022 和 DMOM1017；利润款不需要和跑量款使用同一折扣或广告强度。</span></footer>
        </article>

        <aside className="card august-control">
          <div className="section-head"><div><span>CONTROL ROOM</span><h2>只看这 4 条红线</h2></div></div>
          <div className="august-control-list">
            <article><b>01</b><div><strong>利润率低于 12%</strong><small>停止释放 $500 机动预算；低于 10% 停止扩量。</small></div></article>
            <article><b>02</b><div><strong>广告不超过授权上限</strong><small>当前阶段 {money(executionStage?.authorizedAdCap||executionPolicy?.stageOneAdCap||0)}；已包含活动折扣和买 2 件额外 5%。</small></div></article>
            <article><b>03</b><div><strong>5T-1830-900 保持保护</strong><small>当前库存 37；恢复到 60 件再评估活动和广告。</small></div></article>
            <article><b>04</b><div><strong>{executionStage?.ready?'第二阶段已解锁':'第二阶段仍锁定'}</strong><small>{executionStage?.ready?'门禁已全部通过。':`活动、利润、库存等还有 ${executionStage?.blockers.length||0} 项门禁待完成。`}</small></div></article>
          </div>
        </aside>
      </section>

      <section className="card august-rhythm">
        <div className="section-head"><div><span>MONTHLY RHYTHM</span><h2>8月作战节奏</h2></div><b>累计 150 Orders</b></div>
        <div className="august-rhythm-track">{(data?.nextPlan.salesMilestones||[]).map((item,index)=><article key={item.label}><span>0{index+1}</span><div><b>{item.label} · {item.range}</b><strong>{item.cumulativeOrders} 单</strong></div><progress max={salesSummary?.targetOrders||150} value={item.cumulativeOrders}/><p>本阶段 {item.weekOrders} 单</p></article>)}</div>
        <div className="august-event-strip">{(data?.nextPlan.promotionEvents||[]).map(event=><article key={event.id}><div><b>{event.name.replace('NA ','').replace(' - August 2026','').replace(' (July - Nov 2026)','')}</b><small>{event.start.slice(5,10)} → {event.end.slice(5,10)}</small></div><strong>{event.submittedProducts} SKU</strong><span className={event.status==='ACTIVE'?'active':'processing'}>{event.status==='ACTIVE'?'已生效':'处理中'}</span></article>)}</div>
      </section>

      <section className="august-status-line" aria-label="促销执行摘要">
        <article><span>活动提报</span><b>{promotionSummary?.submittedEvents||0} 个处理中</b><small>另有 {promotionSummary?.activeEvents||0} 个已生效</small></article>
        <article><span>多件优惠</span><b>买 2 件额外 5%</b><small>#{data?.nextPlan.quantityPromotion.projectId||'-'} · {promotionSummary?.quantityPromotionParts||0} SKU</small></article>
        <article className="attention"><span>当前唯一例外</span><b>5T-1830-900 暂缓</b><small>利润与库存保护，不属于数据缺失</small></article>
      </section>

      <details className="card august-detail">
        <summary><span><b>完整 Listing 执行表</b><small>10 个 Listing · 目标、促销、广告预算与止损规则</small></span><em>展开明细</em></summary>
        <div className="sales-plan-table"><div className="sales-plan-row compact head"><span>Listing / Part</span><span>8月订单</span><span>角色</span><span>促销同步</span><span>广告池</span><span>执行Gate / 止损</span></div>{(data?.nextPlan.salesPlanRows||[]).map(item=><article className="sales-plan-row compact" key={item.listing}><span><b>{item.listing}</b><small>{item.parts.join(' · ')}</small></span><span><strong>{item.targetOrders}</strong><small>7月 {item.julyOrders} 单 · 库存 {item.inventoryOnHand}</small></span><span><b className={`sales-role ${item.role.toLowerCase()}`}>{salesRoleNames[item.role]||item.role}</b><small>{item.tactic}</small></span><span><b className={`promotion-sync ${item.promotion.status.toLowerCase()}`}>{salesPromotionStatusNames[item.promotion.status]||item.promotion.status}</b><small>{item.promotion.discountTiers.length?item.promotion.discountTiers.join(' · '):'无活动折扣'}{item.promotion.quantityOfferParts.length?` · 多件 ${item.promotion.quantityOfferParts.length}款`:''}{item.promotion.heldParts.length?` · 暂缓 ${item.promotion.heldParts.join('、')}`:''}</small></span><span><b>{money(item.plannedAdBudget)}</b><small>收入 {money(item.expectedRevenue)} · 毛利 {percent(item.preAdMarginRate)}</small></span><span><b>{item.gate}</b><small>止损：{item.stopRule}</small></span></article>)}</div>
      </details>

      <details className="card august-detail">
        <summary><span><b>逐 Part 折扣与利润明细</b><small>21 个 Part · Partner Base、采购成本、叠加后毛利与活动状态</small></span><em>展开明细</em></summary>
        <div className="promotion-review-table"><div className="promotion-review-row head"><span>Listing / Part</span><span>角色 / 证据</span><span>活动折扣 / 多件优惠</span><span>叠加后毛利</span><span>活动 / 状态</span></div>{(data?.nextPlan.promotionPlan||[]).map(item=><article className="promotion-review-row" key={`${item.listing}-${item.part}`}><span><b>{item.listing}</b><small>{item.part}</small></span><span><b className={`sales-role ${item.role.toLowerCase()}`}>{salesRoleNames[item.role]||item.role}</b><small>Partner Base {item.priceBasisCents==null?'待补':money2(item.priceBasisCents/100)} · 成本 {item.costCents==null?'待补':money2(item.costCents/100)} · 库存 {item.inventoryOnHand}</small></span><span><b>{item.discountPlan}</b><small>{item.reason}</small></span><span><b className={item.marginAlert?'margin-alert':''}>{item.estimatedWorstMargin==null?'待补证据':percent(item.estimatedWorstMargin)}</b><small>角色底线 {percent(item.roleMarginFloor)}</small></span><span><b className={`promotion-decision ${item.action.toLowerCase()}`}>{item.action==='SUBMITTED'?'已提报':'暂缓'}</b><small>{item.submittedEventIds.length?`${item.submittedEventIds.length} 个活动已提交`:'不进入活动'}</small></span></article>)}</div>
      </details>
    </div>}
  </>;
}

function SkuCostPanel() {
  type CostSummary={costedParts:number;soldParts:number;missingParts:number;revenueCoverage:number;missing:{partNumber:string;units:number;revenueCents:number}[];lookbackDays?:number;error?:string;imported?:number;message?:string;errors?:{line:number;part?:string;message:string}[];warnings?:{line:number;part?:string;message:string}[]};
  const [data,setData]=useState<CostSummary|null>(readClientCache<CostSummary>('sku-costs:summary'));
  const [file,setFile]=useState<File|null>(null);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [issues,setIssues]=useState<{line:number;part?:string;message:string}[]>([]);
  async function reload(){const response=await fetch('/api/sku-costs');const body=await response.json() as CostSummary;if(response.ok){setData(body);writeClientCache('sku-costs:summary',body);}}
  useEffect(()=>{const controller=new AbortController();fetch('/api/sku-costs',{signal:controller.signal}).then(async response=>{const body=await response.json() as CostSummary;if(!response.ok)throw new Error(body.error||'SKU 成本读取失败');return body;}).then(body=>{setData(body);writeClientCache('sku-costs:summary',body);}).catch(()=>{});return()=>controller.abort();},[]);
  async function upload(){if(!file)return;setBusy(true);setMessage('');setIssues([]);try{const form=new FormData();form.set('file',file);const response=await fetch('/api/sku-costs',{method:'POST',body:form});const body=await response.json() as CostSummary;if(!response.ok){setIssues(body.errors||[]);throw new Error(body.error||'成本导入失败');}setMessage(body.message||'导入完成');setIssues(body.warnings||[]);setFile(null);invalidateClientCache('orders:');invalidateClientCache('ads:');await reload();}catch(error){setMessage(error instanceof Error?error.message:"成本导入失败");}finally{setBusy(false);}}
  const coverage=Math.round((data?.revenueCoverage||0)*100);
  return <article className="card upload-card"><span className="step">SKU 成本</span><h2>成本覆盖 {coverage}%</h2>
    <div className="soft-note">保本 ROAS、广告前毛利、广告后店铺贡献全部依赖它。未覆盖的 SKU 只能按全店 28.26% 估算，广告出价建议也会跟着失真。{data?.lookbackDays?`统计近 ${data.lookbackDays} 天已售 SKU。`:''}</div>
    <div className="gate-metrics"><div><span>已录成本</span><strong>{data?.costedParts??'-'}</strong></div><div><span>已售 SKU</span><strong>{data?.soldParts??'-'}</strong></div><div><span>待补</span><strong>{data?.missingParts??'-'}</strong></div></div>
    {data?.missing?.length?<div className="soft-note">按收入排序待补：{data.missing.slice(0,6).map(item=>item.partNumber).join('、')}{data.missing.length>6?` 等 ${data.missing.length} 个`:''}</div>:null}
    <a className="text-link" href="/api/sku-costs?template=1">下载待补 SKU 模板（CSV）</a>
    <label className="drop"><input type="file" accept=".csv,.xlsx" onChange={event=>{setFile(event.target.files?.[0]||null);setMessage('');setIssues([]);}}/><b>{file?.name||'选择成本 CSV / XLSX'}</b><span>表头需含 part_number 或 SKU、货号，以及 unit_cost 或 成本、采购成本；金额按美元填写</span></label>
    <button className="primary" disabled={!file||busy} onClick={upload}>{busy?'导入中…':'校验并导入成本'}</button>
    {message&&<div className={issues.length&&!message.includes('已写入')?'inventory-message bad':'inventory-message good'}>{message}</div>}
    {issues.length?<div className="soft-note">{issues.slice(0,8).map(item=>`第${item.line}行${item.part?`（${item.part}）`:''}：${item.message}`).join('；')}</div>:null}
  </article>;
}

function Inventory({ embedded = false }: { embedded?: boolean }) {
  type Preview={snapshotId?:string;sourceFile?:string;createdAt?:string;canPush?:boolean;summary?:{totalRows:number;supplierCount:number;zeroStockRows:number;missingCombinations:number;totalQuantityOnHand:number;ignoredStockRows:number};valueRisk?:{inventoryValue:number;absoluteChangeValue:number;costCoverage:number;unvaluedUnits:number};warnings?:{message:string}[];errors?:{message:string}[];error?:string};
  type InventoryPushResult={error?:string;itemCount?:number;batchCount?:number;mode?:string;feedKind?:'TRUE_UP';status?:'processing'|'completed'|'failed';completedBatches?:number;failedBatches?:number;pushId?:string;batches?:{index:number;state:string;reason?:string;status?:string;completedCount?:number;processingCount?:number;errorCount?:number}[]};
  const savedPreview=readClientCache<Preview>('inventory:preview',CLIENT_CACHE_RETENTION_MS);
  const [file,setFile]=useState<File|null>(null);const [preview,setPreview]=useState<Preview|null>(savedPreview);const [state,setState]=useState(savedPreview?.snapshotId?'最近快照可用':"读取最近快照");const [busy,setBusy]=useState(false);const [confirmation,setConfirmation]=useState("");const [zeroConfirmed,setZeroConfirmed]=useState(false);const [message,setMessage]=useState("");
  useEffect(()=>{const cached=readClientCache<Preview>('inventory:preview');const controller=new AbortController();if(cached){queueMicrotask(()=>{setPreview(cached);setState(cached.snapshotId?'最近快照可用':'等待库存文件');});return()=>controller.abort();}fetch('/api/inventory/preview',{signal:controller.signal}).then(async r=>await r.json() as Preview).then(body=>{if(body.snapshotId){setPreview(body);setState('最近快照可用');writeClientCache('inventory:preview',body);}else setState('等待库存文件');}).catch(()=>setState('等待库存文件'));return()=>controller.abort();},[]);
  async function validate(){if(!file)return;setBusy(true);setMessage('');setState('正在解析与校验');try{const form=new FormData();form.set('file',file);const response=await fetch('/api/inventory/preview',{method:'POST',body:form});const body=await response.json() as Preview;if(!response.ok)throw new Error(`${body.error||'库存校验失败'}${body.errors?.[0]?.message?`：${body.errors[0].message}`:''}`);setPreview(body);writeClientCache('inventory:preview',body);invalidateClientCache('ads:');setState('校验通过 · 已入库');setMessage(`已保存库存快照 ${body.snapshotId?.slice(0,8)}；广告放量Gate将在下次打开时自动读取。`);}catch(error){setState('校验未通过');setMessage(error instanceof Error?error.message:'库存校验失败');}finally{setBusy(false);}}
  async function waitForPush(pushId:string,initial:InventoryPushResult){let latest=initial;for(let attempt=0;attempt<20&&latest.status==='processing';attempt++){await new Promise(resolve=>setTimeout(resolve,3000));const response=await fetch(`/api/inventory/push?pushId=${encodeURIComponent(pushId)}`);latest=await response.json() as InventoryPushResult;if(!response.ok)throw new Error(latest.error||'库存推送状态查询失败');}return latest;}
  async function push(dryRun:boolean){if(!preview?.snapshotId)return;setBusy(true);setMessage('');setState(dryRun?'正在执行 Wayfair API Dry-run':'正在提交Wayfair');try{const response=await fetch('/api/inventory/push',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({snapshotId:preview.snapshotId,dryRun,confirmation,zeroStockConfirmed:zeroConfirmed})});let body=await response.json() as InventoryPushResult;if(!response.ok)throw new Error(`${body.error||'库存推送失败'}${body.batches?.find(item=>item.state==='failed')?.reason?`：${body.batches.find(item=>item.state==='failed')?.reason}`:''}`);if(body.status==='processing'&&body.pushId){setState(dryRun?'Wayfair Dry-run 处理中':'Wayfair 处理中');setMessage(`${body.batchCount||0}个${dryRun?'Dry-run ':''}差量批次已提交，正在核对Wayfair处理结果；回执 ${body.pushId.slice(0,8)}。`);body=await waitForPush(body.pushId,body);}if(dryRun){if(body.status==='completed'){setState('Wayfair API Dry-run 已通过');setMessage(`Wayfair真实Dry-run通过：${body.completedBatches}/${body.batchCount}个批次、共${body.itemCount}条；尚未写入库存。`);}else if(body.status==='failed'){throw new Error(`${body.error||'Wayfair API Dry-run 未通过'}${body.batches?.find(item=>item.state==='failed')?.reason?`：${body.batches.find(item=>item.state==='failed')?.reason}`:''}`);}else{setState('Wayfair Dry-run 仍在处理');setMessage(`Wayfair尚未形成Dry-run完成回执：${body.completedBatches||0}/${body.batchCount}个批次完成。正式推送继续锁定；回执 ${body.pushId?.slice(0,8)}。`);}return;}if(body.status==='completed'){setState('Wayfair feed 完成 · 待库存回读');setMessage(`Wayfair仅确认差量feed处理完成：${body.completedBatches}/${body.batchCount}个批次、共${body.itemCount}条；回执 ${body.pushId?.slice(0,8)}。这不等于Partner Home库存已生效，仍需抽查变更SKU。`);}else if(body.status==='failed'){throw new Error(`${body.error||'Wayfair 库存批次处理失败'}${body.batches?.find(item=>item.state==='failed')?.reason?`：${body.batches.find(item=>item.state==='failed')?.reason}`:''}`);}else{setState('Wayfair 处理中');setMessage(`Wayfair 仍在处理：${body.completedBatches||0}/${body.batchCount}个批次完成。回执 ${body.pushId?.slice(0,8)}，未形成完成回执前不得视为写入成功。`);}}catch(error){setState(dryRun?'Dry-run 失败':'正式推送未完成');setMessage(error instanceof Error?error.message:'库存推送失败');}finally{setBusy(false);}}
  const metrics=[["可推送行",preview?.summary?.totalRows],["Supplier",preview?.summary?.supplierCount],["零库存",preview?.summary?.zeroStockRows],["未匹配组合",preview?.summary?.missingCombinations]];
  return <>{!embedded&&<Hero eyebrow="INVENTORY UPDATE · CONTROLLED WRITE" title="库存更新" text="真实解析领星库存、套用SKU/仓库映射、持久化快照，再执行Dry-run与受控推送" side={<div className="hero-side"><b>{state}</b><span>{preview?.sourceFile||'尚无库存快照'}</span></div>} />}
    <div className="inventory-grid"><SkuCostPanel /><article className="card upload-card"><span className="step">库存文件与校验</span><h2>生成库存快照</h2><label className="drop"><input type="file" accept=".xlsx" onChange={e=>{const next=e.target.files?.[0]||null;setFile(next);setState(next?'文件待校验':preview?'最近快照可用':'等待库存文件');setMessage('');}}/><b>{file?.name||preview?.sourceFile||"选择领星库存 XLSX"}</b><span>读取品名、SKU、仓库、可用量、锁定量、待到货与调拨在途；映射表已固化为当前生产版本</span></label><button className="primary" disabled={!file||busy} onClick={validate}>{busy&&state.includes('解析')?'校验中…':'校验并保存快照'}</button>{preview?.createdAt&&<div className="snapshot-note">最近快照 {new Date(preview.createdAt).toLocaleString('zh-CN')} · 库存合计 {preview.summary?.totalQuantityOnHand||0}</div>}{preview?.valueRisk&&<div className="soft-note">库存成本价值 {money(preview.valueRisk.inventoryValue)} · 较上次绝对变动 {money(preview.valueRisk.absoluteChangeValue)} · 成本覆盖 {Math.round(preview.valueRisk.costCoverage*100)}%</div>}</article><article className="card gate-card"><span className="step">预检与确认</span><h2>推送前检查</h2><div className="gate-metrics">{metrics.map(([label,value])=><div key={String(label)}><span>{label}</span><strong>{value??'-'}</strong></div>)}</div>{preview?.warnings?.length?<div className="soft-note">{preview.warnings.map(item=>item.message).join('；')}</div>:<div className="soft-note">只有真实校验通过的D1快照可进入Dry-run；正式推送不会复用浏览器临时状态。</div>}<button className="primary" disabled={!preview?.canPush||busy} onClick={()=>push(true)}>执行 Wayfair API Dry-run</button><div className="live-confirm"><label>正式确认<input value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder="输入：正式推送"/></label><label className="zero-check"><input type="checkbox" checked={zeroConfirmed} onChange={e=>setZeroConfirmed(e.target.checked)}/>确认零库存记录会改变可售状态</label><button className="primary dark" disabled={!preview?.canPush||busy||confirmation!=='正式推送'} onClick={()=>push(false)}>正式推送库存</button></div>{message&&<div className={state.includes('失败')||state.includes('阻止')||state.includes('未通过')||state.includes('未完成')?'inventory-message bad':'inventory-message good'}>{message}</div>}</article></div>
  </>;
}

function AdReviewDashboard() {
  const retained=readClientCache<AdReviewResponse>('ad-history:dashboard',CLIENT_CACHE_RETENTION_MS);
  const [data,setData]=useState<AdReviewResponse|null>(retained);
  const [loading,setLoading]=useState(!retained);
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  const [verdict,setVerdict]=useState('ALL');
  useEffect(()=>{const fresh=readClientCache<AdReviewResponse>('ad-history:dashboard');const controller=new AbortController();if(fresh){queueMicrotask(()=>setData(fresh));return()=>controller.abort();}fetch('/api/ads/history',{signal:controller.signal}).then(async response=>{const body=await response.json() as AdReviewResponse;if(!response.ok)throw new Error(body.error||'广告优化历史读取失败');return body;}).then(body=>{setData(body);writeClientCache('ad-history:dashboard',body);}).catch(reason=>{if(reason.name!=='AbortError')setError(reason.message||'广告优化历史读取失败');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[]);
  const actions=useMemo(()=>{const needle=query.trim().toLowerCase();return (data?.weeks||[]).flatMap(week=>week.actions.map(action=>({...action,decisionStart:week.decision_start,decisionEnd:week.decision_end}))).filter(action=>(!needle||[action.listing,action.campaign_id,action.action_type].some(value=>String(value).toLowerCase().includes(needle)))&&(verdict==='ALL'||(verdict==='PENDING'?!action.review:action.review?.verdict===verdict)));},[data,query,verdict]);
  const summary=data?.summary;
  const actionChange=(action:AdReviewAction)=>action.action_type==='SET_LISTING_BID'?`${money2(Number(action.before.bid||0))} → ${money2(Number(action.proposed.bid||0))}`:`${action.before.active===false?'暂停':'启用'} → ${action.proposed.active===false?'暂停':'启用'}`;
  const statusLabel=(status:string)=>({PLANNED:'待确认',APPROVED:'待预检',VALIDATED:'预检通过',EXECUTING:'执行中',EXECUTED:'执行成功',FAILED:'执行失败'}[status]||status);
  const reviewLabel=(review:AdReviewAction['review'])=>!review?'待成熟复盘':({EFFECTIVE:'有效',HARMFUL:'有害',NEUTRAL:'中性',INCONCLUSIVE:'样本不足',PENDING:'待成熟'}[review.verdict]||review.verdict);
  return <div className="ad-review-dashboard">
    <section className="card review-dashboard-intro"><div><span>AD OPTIMIZATION MEMORY</span><h2>广告优化记录与复盘看板</h2><p>执行前 → 建议值 → 执行结果 → 成熟复盘，所有自动写入动作使用同一条审计链。</p></div><b>{loading?'读取中':`${data?.weeks.length||0} 个决策周期`}</b></section>
    {error?<div className="inline-error">{error}</div>:null}
    <section className="stat-grid six ad-review-kpis">{[
      [summary?.totalActions??'-','优化动作','进入执行队列'],[summary?.executedActions??'-','执行成功',`失败 ${summary?.failedActions||0}`],[summary?`${Math.round(summary.reviewCoverage*100)}%`:'-','复盘覆盖率',`${summary?.reviewedActions||0} 项已有结论`],[summary?.effectiveReviews??'-','有效调整','可延续策略'],[summary?.harmfulReviews??'-','有害调整','停止同向调整'],[summary?.pendingReviews??'-','待复盘','等待成熟归因'],
    ].map(([value,label,note])=><article className="stat" key={String(label)}><strong>{value}</strong><span>{label}</span><small>{note}</small></article>)}</section>
    <section className="review-week-grid">{(data?.weeks||[]).map(week=><article className="card" key={week.run_key}><span>{week.decision_start||'-'} → {week.decision_end||'-'}</span><h3>{week.summary.actions} 项优化 · {week.summary.executed} 项成功</h3><div><b>{week.summary.effective} 有效</b><b className={week.summary.harmful?'bad':''}>{week.summary.harmful} 有害</b><b>{week.summary.failed} 失败</b></div></article>)}{!loading&&!data?.weeks.length?<article className="card empty-state">尚无广告优化批次。执行首个周度动作后会自动形成记录。</article>:null}</section>
    <section className="card ad-review-ledger"><div className="section-head"><div><span>AUDIT LEDGER</span><h2>优化动作明细</h2></div><b>{actions.length} 条记录</b></div><div className="review-ledger-tools"><label>搜索<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Listing、Campaign 或动作类型"/></label><label>复盘结论<select value={verdict} onChange={event=>setVerdict(event.target.value)}><option value="ALL">全部</option><option value="PENDING">待复盘</option><option value="EFFECTIVE">有效</option><option value="HARMFUL">有害</option><option value="NEUTRAL">中性</option><option value="INCONCLUSIVE">样本不足</option></select></label></div><div className="review-ledger-scroll"><div className="review-ledger"><div className="review-ledger-row head"><span>成熟决策周</span><span>Listing / Campaign</span><span>优化动作</span><span>执行结果</span><span>成熟复盘</span></div>{actions.map(action=><article className="review-ledger-row" key={action.id}><time>{action.decisionStart}<small>至 {action.decisionEnd}</small></time><span><b>{action.listing}</b><small>Campaign {action.campaign_id}</small></span><span><b>{action.action_type==='SET_LISTING_BID'?'调整 Bid':'Listing 启停'}</b><small>{actionChange(action)}</small></span><span><em className={action.status==='EXECUTED'?'good':action.status==='FAILED'?'bad':'warn'}>{statusLabel(action.status)}</em><small>{action.result_at?new Date(action.result_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'尚无终态时间'}</small></span><span><em className={`review-${String(action.review?.verdict||'pending').toLowerCase()}`}>{reviewLabel(action.review)}</em><small>{action.review?.summary||'执行成功并经过至少 7 天成熟窗口后生成结论'}{action.review?` · Δ订单 ${action.review.orderDelta||0} · Δ收入 ${money(Number(action.review.revenueDelta||0))} · ΔROAS ${Number(action.review.roasDelta||0).toFixed(2)}`:''}</small></span></article>)}{!loading&&!actions.length?<p className="empty-state">当前筛选没有优化记录。</p>:null}</div></div></section>
  </div>;
}

function Ads({ tab }: { tab: AdsTab }) {
  const initial=adRangeFor('7d');
  const initialAnalysis=readClientCache<AdAnalysis>(`ads:v11:${initial.start}:${initial.end}`,CLIENT_CACHE_RETENTION_MS);
  const initialQueue=initialAnalysis?.runKey?readClientCache<AdQueueCache>(`ad-queue:${initialAnalysis.runKey}`,CLIENT_CACHE_RETENTION_MS):null;
  const [preset,setPreset]=useState('7d');
  const [start,setStart]=useState(initial.start); const [end,setEnd]=useState(initial.end); const [requested,setRequested]=useState({start:initial.start,end:initial.end,refresh:false});
  const [data,setData]=useState<AdAnalysis|null>(initialAnalysis); const [loading,setLoading]=useState(!initialAnalysis); const [error,setError]=useState('');
  const [queueState,setQueueState]=useState<Record<string,string>>(queuedActionState(initialQueue?.actions||[]));
  const [queuedActions,setQueuedActions]=useState<QueuedAdAction[]>(initialQueue?.actions||[]); const [queueLoading,setQueueLoading]=useState(false); const [queueError,setQueueError]=useState('');
  const [liveEnabled,setLiveEnabled]=useState(Boolean(initialQueue?.liveEnabled)); const [batchBusy,setBatchBusy]=useState(false); const [batchMessage,setBatchMessage]=useState('');
  const [actionQuery,setActionQuery]=useState(''); const [queueFilter,setQueueFilter]=useState('ALL');
  const [managerQuery,setManagerQuery]=useState(''); const [managerStatus,setManagerStatus]=useState('ALL');
  const [managerCampaignStatus,setManagerCampaignStatus]=useState('ALL'); const [managerCampaignTargeting,setManagerCampaignTargeting]=useState('ALL');
  const [managerCampaignAudience,setManagerCampaignAudience]=useState('ALL'); const [managerCampaignPerformance,setManagerCampaignPerformance]=useState('ALL');
  const [campaignSort,setCampaignSort]=useState<SortState>({key:'spend',direction:'desc'}); const [listingSort,setListingSort]=useState<SortState>({key:'spend',direction:'desc'});
  const [selectedRecommendations,setSelectedRecommendations]=useState<string[]>([]); const [selectedQueue,setSelectedQueue]=useState<string[]>([]);
  const [manualDone,setManualDone]=useState<string[]>([]);
  const [manualRecords,setManualRecords]=useState<Record<string,ManualCompletionRecord>>({});
  const [manualDrafts,setManualDrafts]=useState<Record<string,Partial<ManualCompletionRecord>>>({});
  const [manualRecordMessage,setManualRecordMessage]=useState('');
  const [zombieResolutions,setZombieResolutions]=useState<Record<string,ZombieResolution>>({});
  useEffect(()=>{const cacheKey=`ads:v11:${requested.start}:${requested.end}`;const cached=!requested.refresh&&readClientCache<AdAnalysis>(cacheKey);const controller=new AbortController();if(cached){queueMicrotask(()=>{if(!controller.signal.aborted){setData(cached);setLoading(false);setError('');}});return()=>controller.abort();}fetch(`/api/ads/analysis?start=${requested.start}&end=${requested.end}${requested.refresh?'&refresh=1':''}`,{signal:controller.signal}).then(async r=>{const body=await r.json() as AdAnalysis;if(!r.ok)throw new Error(body.error||'广告分析失败');return body;}).then(body=>{setData(body);writeClientCache(cacheKey,body);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[requested]);
  useEffect(()=>{if(!data?.runKey)return;const cacheKey=`ad-queue:${data.runKey}`;const cached=readClientCache<AdQueueCache>(cacheKey);const controller=new AbortController();setQueueError('');if(cached){queueMicrotask(()=>{if(!controller.signal.aborted){setQueuedActions(cached.actions);setQueueState(queuedActionState(cached.actions));setLiveEnabled(cached.liveEnabled);setQueueLoading(false);}});return()=>controller.abort();}setQueueLoading(true);fetch(`/api/ads/actions?runKey=${encodeURIComponent(data.runKey)}`,{signal:controller.signal}).then(async response=>{const body=await response.json() as {actions?:QueuedAdAction[];liveEnabled?:boolean;error?:string};if(!response.ok)throw new Error(body.error||'执行批次读取失败');return body;}).then(body=>{const actions=body.actions||[];const next={actions,liveEnabled:Boolean(body.liveEnabled)};setQueuedActions(actions);setQueueState(queuedActionState(actions));setLiveEnabled(next.liveEnabled);writeClientCache(cacheKey,next);}).catch(reason=>{if(reason.name!=='AbortError')setQueueError(reason.message||'执行批次读取失败');}).finally(()=>{if(!controller.signal.aborted)setQueueLoading(false);});return()=>controller.abort();},[data?.runKey]);
  useEffect(()=>{
    if(tab!=='manual')return;
    const controller=new AbortController();
    let localCompleted:string[]=[];
    try{
      const stored=JSON.parse(window.localStorage.getItem('manual-ad-todos:v1')||'[]');
      if(Array.isArray(stored)){
        const completed=stored.filter((item):item is string=>typeof item==='string');
        const expanded=completed.flatMap(item=>{
          const legacyTask=MANUAL_AD_TASK_IDS.has(item)?MANUAL_AD_TASKS.find(task=>task.id===item):undefined;
          return legacyTask?legacyTask.parentSkus.map(sku=>manualTaskKey(sku,legacyTask.id)):[item];
        });
        localCompleted=[...new Set(expanded.filter(key=>manualCompletionPayload(key,MANUAL_AD_TASKS)!==null))];
        setManualDone(localCompleted);
      }
    }catch{}

    async function syncManualRecords(){
      const response=await fetch('/api/ads/manual-completions',{signal:controller.signal});
      const body=await response.json() as {records?:ManualCompletionRecord[];error?:string};
      if(!response.ok)throw new Error(body.error||'手动执行记录读取失败');
      const records=body.records||[];
      const serverKeys=new Set(records.map(record=>record.taskKey));
      const migrationPayloads=localCompleted
        .filter(key=>!serverKeys.has(key))
        .map(key=>manualCompletionPayload(key,MANUAL_AD_TASKS))
        .filter((payload):payload is NonNullable<ReturnType<typeof manualCompletionPayload>>=>payload!==null);
      const migrated=await Promise.all(migrationPayloads.map(async payload=>{
        const migrationResponse=await fetch('/api/ads/manual-completions',{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify(payload),
          signal:controller.signal,
        });
        const migrationBody=await migrationResponse.json() as {record?:ManualCompletionRecord;error?:string};
        if(!migrationResponse.ok||!migrationBody.record)throw new Error(migrationBody.error||'旧版手动记录迁移失败');
        return migrationBody.record;
      }));
      if(controller.signal.aborted)return;
      const byKey=Object.fromEntries([...records,...migrated].map(record=>[record.taskKey,record]));
      const synchronized=Object.values(byKey);
      const completed=synchronized.filter(record=>record.status==='VERIFIED').map(record=>record.taskKey);
      setManualRecords(byKey);
      setManualDone(completed);
      window.localStorage.setItem('manual-ad-todos:v1',JSON.stringify(completed));
      setManualRecordMessage(migrated.length?`已将 ${migrated.length} 条旧版勾选记录迁移为待验收任务；补充证据后才能关闭`:'服务器闭环记录已同步');
    }

    async function syncZombieRecords(){
      const response=await fetch('/api/ads/zombie-resolutions/',{signal:controller.signal});
      const body=await response.json() as {records?:ZombieResolution[];error?:string};
      if(!response.ok)throw new Error(body.error||'Zombie 处置记录读取失败');
      if(controller.signal.aborted)return;
      setZombieResolutions(Object.fromEntries((body.records||[]).map(record=>[record.resolutionKey,record])));
    }

    void Promise.all([syncManualRecords(),syncZombieRecords()]).catch(reason=>{
      if(reason.name!=='AbortError')setManualRecordMessage('服务器记录读取失败，当前显示本机缓存');
    });
    return()=>controller.abort();
  },[tab]);
  function selectAdPreset(next:string){setPreset(next);if(next==='custom')return;const range=adRangeFor(next);setStart(range.start);setEnd(range.end);setLoading(true);setError('');setRequested({...range,refresh:false});}
  async function reloadQueue(){if(!data?.runKey)return;const response=await fetch(`/api/ads/actions?runKey=${encodeURIComponent(data.runKey)}`);const body=await response.json() as {actions?:QueuedAdAction[];liveEnabled?:boolean;error?:string};if(!response.ok)throw new Error(body.error||'执行批次读取失败');const actions=body.actions||[];const next={actions,liveEnabled:Boolean(body.liveEnabled)};setQueuedActions(actions);setQueueState(queuedActionState(actions));setLiveEnabled(next.liveEnabled);writeClientCache(`ad-queue:${data.runKey}`,next);}
  async function queueAction(row:AdListing){const key=`${row.campaignId}:${row.listing}`;setQueueState(value=>({...value,[key]:'saving'}));setBatchMessage('');try{const response=await fetch('/api/ads/actions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({runKey:data?.runKey,listing:row.listing,campaignId:row.campaignId,actionType:row.action.type,before:row.action.before,proposed:row.action.proposed})});const body=await response.json() as {message?:string;error?:string};if(!response.ok)throw new Error(body.error||'执行单保存失败');await reloadQueue();setBatchMessage('已加入 API 执行批次，刷新页面仍会保留。');}catch(reason){setQueueState(value=>({...value,[key]:reason instanceof Error?reason.message:'保存失败'}));}}
  async function removeAction(action:QueuedAdAction){setBatchBusy(true);setBatchMessage('');try{const response=await fetch(`/api/ads/actions?id=${encodeURIComponent(action.id)}`,{method:'DELETE'});const body=await response.json() as {error?:string};if(!response.ok)throw new Error(body.error||'移除失败');await reloadQueue();setBatchMessage('已从对应执行清单移除。');}catch(reason){setBatchMessage(reason instanceof Error?reason.message:'移除失败');}finally{setBatchBusy(false);}}
  async function postExecution(dryRun:boolean){if(!data?.runKey)throw new Error('执行批次尚未生成');const response=await fetch('/api/ads/actions/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({runKey:data.runKey,dryRun,confirmation:dryRun?undefined:'执行广告修改'})});const body=await response.json() as {message?:string;error?:string};await reloadQueue();if(!response.ok)throw new Error(body.error||'广告执行失败');return body;}
  async function queueSelected(){if(!data?.runKey)return;const rows=optimizationListings.filter(row=>API_AD_ACTION_TYPES.has(row.action.type)&&selectedRecommendations.includes(`${row.campaignId}:${row.listing}`));if(!rows.length)return;setBatchBusy(true);setBatchMessage('');try{const results=await Promise.all(rows.map(async row=>{const response=await fetch('/api/ads/actions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({runKey:data.runKey,listing:row.listing,campaignId:row.campaignId,actionType:row.action.type,before:row.action.before,proposed:row.action.proposed})});const body=await response.json() as {error?:string};if(!response.ok)throw new Error(`${row.listing}: ${body.error||'加入失败'}`);return row;}));await reloadQueue();setSelectedRecommendations([]);setBatchMessage(`已加入 ${results.length} 项到 API 执行批次。`);}catch(reason){setBatchMessage(reason instanceof Error?reason.message:'批量加入失败');}finally{setBatchBusy(false);}}
  async function prepareSelected(){const actions=apiQueuedActions.filter(action=>selectedQueue.includes(action.id)&&isBulkApprovable(action));if(!actions.length&&!approvedActions.length)return;setBatchBusy(true);setBatchMessage('');try{await Promise.all(actions.map(async action=>{const response=await fetch('/api/ads/actions',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:action.id,status:'APPROVED'})});const body=await response.json() as {error?:string};if(!response.ok)throw new Error(`${action.listing}: ${body.error||'确认失败'}`);}));const body=await postExecution(true);setSelectedQueue([]);setBatchMessage(body.message||`已确认并预检 ${actions.length+approvedActions.length} 项。`);}catch(reason){setBatchMessage(reason instanceof Error?reason.message:'确认并预检失败');}finally{setBatchBusy(false);}}
  async function executeValidated(){if(!validatedActions.length||!window.confirm(`将正式修改 ${validatedActions.length} 项 Wayfair 广告。是否继续？`))return;setBatchBusy(true);setBatchMessage('');try{const body=await postExecution(false);setBatchMessage(body.message||'执行完成，逐项结果已更新。');}catch(reason){setBatchMessage(reason instanceof Error?reason.message:'广告执行失败');}finally{setBatchBusy(false);}}
  function patchManualDraft(id:string,patch:Partial<ManualCompletionRecord>){setManualDrafts(value=>({...value,[id]:{...value[id],...patch}}));}
  async function saveManualTask(id:string,parentSku:string,task:ManualAdTask,status:ManualCompletionRecord['status']){const draft={...manualRecords[id],...manualDrafts[id]};setManualRecordMessage('正在写入统一任务账本…');try{const response=await fetch('/api/ads/manual-completions/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskKey:id,parentSku,taskId:task.id,campaignId:task.campaignId,adGroup:task.adGroup,title:task.title,status,owner:draft.owner||'广告运营',executionResult:draft.executionResult||'',evidence:draft.evidence||'',acceptanceCriteria:draft.acceptanceCriteria||task.rule,acceptedBy:draft.acceptedBy||'',reviewDueAt:draft.reviewDueAt||''})});const body=await response.json() as {record?:ManualCompletionRecord;error?:string};if(!response.ok||!body.record)throw new Error(body.error||'手动任务保存失败');setManualRecords(value=>({...value,[id]:body.record as ManualCompletionRecord}));setManualDrafts(value=>{const next={...value};delete next[id];return next;});setManualDone(value=>status==='VERIFIED'?[...new Set([...value,id])]:value.filter(item=>item!==id));setManualRecordMessage(status==='VERIFIED'?'执行证据和验收已写入统一任务账本':status==='REOPENED'?'任务已重开，历史事件保留':'任务状态已更新');}catch(reason){setManualRecordMessage(reason instanceof Error?reason.message:'手动任务保存失败');}}
  function patchZombieResolution(key:string,patch:Partial<ZombieResolution>){setZombieResolutions(value=>({...value,[key]:{...value[key],...patch} as ZombieResolution}));}
  async function saveZombieResolution(item:ZombieCampaignFinding,status:ZombieResolution['status']){const key=zombieResolutionKey(item);const current=zombieResolutions[key];const methods=ZOMBIE_METHOD_OPTIONS[item.actionType];try{const response=await fetch('/api/ads/zombie-resolutions/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({resolutionKey:key,campaignId:item.campaignId,listing:item.listing,actionType:item.actionType,method:current?.method||methods[0],owner:current?.owner||'广告运营',status,executionResult:current?.executionResult||'',evidence:current?.evidence||'',acceptanceCriteria:current?.acceptanceCriteria||`${current?.method||methods[0]} 已在 Wayfair 平台生效`,acceptedBy:current?.acceptedBy||''})});const body=await response.json() as {record?:ZombieResolution;error?:string};if(!response.ok||!body.record)throw new Error(body.error||'Zombie 处置保存失败');setZombieResolutions(value=>({...value,[key]:body.record as ZombieResolution}));setManualRecordMessage(status==='VERIFIED'?'Zombie 处置已提交证据并通过验收':'Zombie 处置进度已写入服务器');}catch(reason){setManualRecordMessage(reason instanceof Error?reason.message:'Zombie 处置保存失败');}}
  const visibleHistory=(data?.history||[]).filter(x=>x.date>=requested.start&&x.date<=requested.end);
  const dailySpendMax=Math.max(1,...visibleHistory.map(x=>x.spend));
  const liveSafetyKeys=new Set((data?.liveSafetyFindings||[]).map(row=>`${row.campaignId}:${row.listing}`));
  const optimizationListings=[...(data?.liveSafetyFindings||[]),...(data?.listings||[]).filter(row=>!liveSafetyKeys.has(`${row.campaignId}:${row.listing}`))];
  const apiListings=optimizationListings.filter(row=>API_AD_ACTION_TYPES.has(row.action.type));
  const ready=apiListings.length;
  const zombieFindings=data?.zombieFindings||[];
  const zombieAudit=data?.zombieAudit||{matureDays:14,total:0,hard:0,near:0};
  const apiQueuedActions=queuedActions.filter(action=>API_AD_ACTION_TYPES.has(action.action_type));
  const approvedActions=apiQueuedActions.filter(item=>item.status==='APPROVED'); const validatedActions=apiQueuedActions.filter(item=>item.status==='VALIDATED'); const executedActions=apiQueuedActions.filter(item=>item.status==='EXECUTED'); const failedActions=apiQueuedActions.filter(item=>item.status==='FAILED');
  const queueActionByKey=new Map(apiQueuedActions.map(action=>[`${action.campaign_id}:${action.listing}:${action.action_type}`,action]));
  const filteredListings=filterAdActions(optimizationListings,{query:actionQuery,recommendation:'ALL',queue:queueFilter},queueState) as AdListing[];
  const selectableListings=filteredListings.filter(row=>API_AD_ACTION_TYPES.has(row.action.type)&&row.operatorReview?.verdict==='CANDIDATE'&&!queueActionByKey.has(`${row.campaignId}:${row.listing}:${row.action.type}`));
  const selectableQueueActions=filteredListings.map(row=>queueActionByKey.get(`${row.campaignId}:${row.listing}:${row.action.type}`)).filter((action):action is QueuedAdAction=>Boolean(action&&isBulkApprovable(action)));
  const selectableRecommendationKeys=selectableListings.map(row=>`${row.campaignId}:${row.listing}`);
  const selectableQueueIds=selectableQueueActions.map(action=>action.id);
  const allSelectableActionsSelected=isBulkActionSelectionComplete({selectableRecommendationKeys,selectableQueueIds,selectedRecommendationKeys:selectedRecommendations,selectedQueueIds:selectedQueue});
  function toggleAllSelectableActions(){const next=nextBulkActionSelection({selectableRecommendationKeys,selectableQueueIds,selectedRecommendationKeys:selectedRecommendations,selectedQueueIds:selectedQueue});setSelectedRecommendations(next.recommendationKeys);setSelectedQueue(next.queueIds);}
  const resolvedZombieCount=zombieFindings.filter(row=>zombieResolutions[zombieResolutionKey(row)]?.status==='VERIFIED').length;
  const keywordCampaigns=(data?.campaigns||[]).filter(row=>/keyword/i.test(row.targetingType)); const productCampaigns=(data?.campaigns||[]).filter(row=>/product/i.test(row.targetingType));
  const keywordSpend=keywordCampaigns.reduce((sum,row)=>sum+row.spend,0); const productSpend=productCampaigns.reduce((sum,row)=>sum+row.spend,0);
  const normalizedManagerQuery=managerQuery.trim().toLowerCase();
  const allCampaigns=data?.campaigns||[];
  const campaignStatuses=Array.from(new Set(allCampaigns.map(row=>String(row.status||'未标记').trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const campaignTargetingTypes=Array.from(new Set(allCampaigns.map(row=>String(row.targetingType||'未标记').trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const hasCampaignFilters=Boolean(managerQuery||managerCampaignStatus!=='ALL'||managerCampaignTargeting!=='ALL'||managerCampaignAudience!=='ALL'||managerCampaignPerformance!=='ALL');
  const clearCampaignFilters=()=>{setManagerQuery('');setManagerCampaignStatus('ALL');setManagerCampaignTargeting('ALL');setManagerCampaignAudience('ALL');setManagerCampaignPerformance('ALL');};
  const managerCampaigns=sortRows(allCampaigns.filter(row=>{
    const status=String(row.status||'未标记').trim();
    const targetingType=String(row.targetingType||'未标记').trim();
    const isB2b=String(row.isB2b).toLowerCase()==='true';
    const performance=managerCampaignPerformance==='ALL'||(managerCampaignPerformance==='WITH_ORDERS'&&row.orders>0)||(managerCampaignPerformance==='SPEND_NO_ORDERS'&&row.spend>0&&row.orders===0)||(managerCampaignPerformance==='NO_SPEND'&&row.spend===0);
    return (!normalizedManagerQuery||[row.campaignId,row.name,row.targetingType,row.site].some(value=>String(value||'').toLowerCase().includes(normalizedManagerQuery)))
      &&(managerCampaignStatus==='ALL'||status===managerCampaignStatus)
      &&(managerCampaignTargeting==='ALL'||targetingType===managerCampaignTargeting)
      &&(managerCampaignAudience==='ALL'||(managerCampaignAudience==='B2B'?isB2b:!isB2b))
      &&performance;
  }),campaignSort,{name:(row:AdCampaign)=>row.name,status:(row:AdCampaign)=>row.status,dailyCap:(row:AdCampaign)=>Number(row.dailyCap||0),impressions:(row:AdCampaign)=>row.impressions,clicks:(row:AdCampaign)=>row.clicks,ctr:(row:AdCampaign)=>row.ctr,spend:(row:AdCampaign)=>row.spend,cpc:(row:AdCampaign)=>metricCpc(row),orders:(row:AdCampaign)=>row.orders,units:(row:AdCampaign)=>row.units,cpa:(row:AdCampaign)=>row.cpa,wsc:(row:AdCampaign)=>row.wsc,retail:(row:AdCampaign)=>row.retail,wscRoas:(row:AdCampaign)=>row.wscRoas,retailRoas:(row:AdCampaign)=>row.retailRoas}) as AdCampaign[];
  const managerListings=sortRows((data?.parentListings||data?.listings||[]).filter(row=>(managerStatus==='ALL'||String(row.status||'').toUpperCase().includes(managerStatus))&&(!normalizedManagerQuery||[row.listing,row.campaignId,row.campaignName,row.productName,row.className,row.site,...row.parts].some(value=>String(value||'').toLowerCase().includes(normalizedManagerQuery)))),listingSort,{listing:(row:AdListing)=>row.listing,status:(row:AdListing)=>row.status,bid:(row:AdListing)=>row.bid,impressions:(row:AdListing)=>row.current.impressions,clicks:(row:AdListing)=>row.current.clicks,ctr:(row:AdListing)=>row.current.ctr,spend:(row:AdListing)=>row.current.spend,cpc:(row:AdListing)=>metricCpc(row.current),orders:(row:AdListing)=>row.current.orders,units:(row:AdListing)=>row.current.units,cpa:(row:AdListing)=>row.current.cpa,wsc:(row:AdListing)=>row.current.wsc,retail:(row:AdListing)=>row.current.retail,cvr:(row:AdListing)=>row.current.cvr,wscRoas:(row:AdListing)=>row.current.wscRoas,retailRoas:(row:AdListing)=>row.current.retailRoas}) as AdListing[];
  const sortCampaign=(field:string)=>setCampaignSort(value=>nextSort(value,field) as SortState); const sortListing=(field:string)=>setListingSort(value=>nextSort(value,field) as SortState);
  const aiDecisionCurrent=data?.decision.current;
  const aiDecisionPrevious=data?.decision.previous;
  const decisionModel=data?.decisionModel;
  const modelTodo=data?.modelTodo||[];
  const campaignControl=data?.campaignControl;
  const headerRange=tab==='review'?null:tab==='ai'?data?.decisionRange:requested;
  const pageTitle=tab==='manager'?'广告管理器':tab==='listings'?'父体 SKU 广告表现':tab==='manual'?'手动优化 To-Do':tab==='review'?'优化记录与复盘':'AI 优化';
  const pageCount=tab==='manager'?`${data?.campaigns.length||0} 个 Campaign`:tab==='listings'?`${data?.listings.length||0} 个父体 SKU`:tab==='manual'?`${resolvedZombieCount} / ${zombieFindings.length} 诊断已完成 · ${manualDone.length} / ${MANUAL_AD_TASK_COUNT} To-Do`:tab==='review'?'完整审计链':`${ready} 项建议 · ${validatedActions.length} 项待执行`;
  return <><Hero eyebrow="" title={pageTitle} text="" side={<div className="hero-side compact-status"><b>{loading?'同步中':error?'需检查':pageCount}</b>{headerRange?<span>{headerRange.start} 至 {headerRange.end}</span>:null}</div>} />
    {(tab==='manager'||tab==='manual')&&<section className="period-bar ad-period"><div>{adPresetOptions.map(([id,label])=><button key={id} className={preset===id?'active':''} onClick={()=>selectAdPreset(id)}>{label}</button>)}</div>{preset==='custom'&&<><label>开始<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>结束<input type="date" value={end} max={dateText(new Date())} onChange={e=>setEnd(e.target.value)}/></label><button disabled={loading||start>end} onClick={()=>{setLoading(true);setError('');setRequested({start,end,refresh:false});}}>读取</button></>}<span>{error||`每小时自动同步 · 最近入库 ${data?.generatedAt?new Date(data.generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'-'}`}</span></section>}
    {error&&tab!=='review'&&<div className="inline-error">{error}；系统未展示任何静态替代建议。</div>}
    {tab==='review'&&<AdReviewDashboard/>}
    {tab==='manager'&&<>
      <section className="stat-grid six ad-manager-kpis">{[
        [loading?'-':money(data?.current.spend),"花费",change(data?.current.spend,data?.previous.spend)],
        [loading?'-':String(data?.current.impressions||0),"曝光",`CTR ${((data?.current.ctr||0)*100).toFixed(2)}%`],
        [loading?'-':String(data?.current.clicks||0),"点击",`CPC ${money2(metricCpc(data?.current))}`],
        [loading?'-':String(data?.current.orders||0),"归因订单",`CVR ${((data?.current.cvr||0)*100).toFixed(2)}%`],
        [loading?'-':String(data?.current.units||0),"归因件数",`前周期 ${data?.previous.units||0} 件`],
        [loading?'-':`${(data?.current.wscRoas||0).toFixed(2)}×`,"WSC ROAS",`WSC ${money(data?.current.wsc||0)} · Retail ${money(data?.current.retail||0)}`],
      ].map(([value,label,note])=><article className="stat" key={label}><strong>{value}</strong><span>{label}</span><small>{note}</small></article>)}</section>
      <section className="manager-source"><div><b>Advertising API</b><span>Campaign Report + Listing Report</span></div><div><b>{data?.cache?.layer||'连接中'}</b><span>{data?.generatedAt?`更新 ${new Date(data.generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}`:'正在读取'}</span></div><div><b>{managerCampaigns.length} / {managerListings.length}</b><span>Campaign / Listing</span></div></section>
      {tab==='manager'&&<section className="card ad-manager-card"><div className="section-head"><div><span>账户结构</span><h2>Campaign 管理</h2></div><b>{managerCampaigns.length} / {allCampaigns.length} 个 Campaign</b></div>
        <div className="manager-filters"><label>搜索<input value={managerQuery} onChange={event=>setManagerQuery(event.target.value)} placeholder="Campaign、投放类型或站点"/></label><label>筛选状态<select value={managerCampaignStatus} onChange={event=>setManagerCampaignStatus(event.target.value)}><option value="ALL">全部状态</option>{campaignStatuses.map(status=><option value={status} key={status}>{status}</option>)}</select></label><label>投放类型<select value={managerCampaignTargeting} onChange={event=>setManagerCampaignTargeting(event.target.value)}><option value="ALL">全部类型</option>{campaignTargetingTypes.map(type=><option value={type} key={type}>{type}</option>)}</select></label><label>客群<select value={managerCampaignAudience} onChange={event=>setManagerCampaignAudience(event.target.value)}><option value="ALL">全部客群</option><option value="B2B">B2B</option><option value="B2C">B2C</option></select></label><label>效果<select value={managerCampaignPerformance} onChange={event=>setManagerCampaignPerformance(event.target.value)}><option value="ALL">全部效果</option><option value="WITH_ORDERS">有归因订单</option><option value="SPEND_NO_ORDERS">有花费未出单</option><option value="NO_SPEND">无花费</option></select></label><button className="clear-manager-filters" type="button" disabled={!hasCampaignFilters} onClick={clearCampaignFilters}>清除筛选</button></div>
        <div className="api-table-scroll"><div className="api-table campaign-manager-table"><div className="api-row head"><SortHeader label="Campaign" field="name" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="状态 / 客群" field="status" sort={campaignSort} onSort={sortCampaign}/><span>投放类型 / 策略</span><SortHeader label="Daily Cap" field="dailyCap" sort={campaignSort} onSort={sortCampaign}/><span>Lifetime Budget</span><span>Target ROAS</span><span>投放周期</span><SortHeader label="曝光" field="impressions" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="点击" field="clicks" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="CTR" field="ctr" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="花费" field="spend" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="CPC" field="cpc" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="订单" field="orders" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="件数" field="units" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="CPA" field="cpa" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="WSC 销售额" field="wsc" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="Retail 销售额" field="retail" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="WSC ROAS" field="wscRoas" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="Retail ROAS" field="retailRoas" sort={campaignSort} onSort={sortCampaign}/></div>{managerCampaigns.map(row=><article className="api-row" key={row.campaignId}><span><b>{row.name||`Campaign ${row.campaignId}`}</b><small>ID {row.campaignId} · {row.site||'-'}</small></span><span><em className={/active/i.test(row.status)&&!/false/i.test(row.isActive)?'good':'bad'}>{row.status||'—'}</em><small>{String(row.isB2b).toLowerCase()==='true'?'B2B':'B2C'}</small></span><span><b>{row.targetingType||'-'}</b><small>{row.strategy||'-'}</small></span><b>{adBudgetValue(row.dailyCap)}</b><b>{adBudgetValue(row.lifetimeBudget)}</b><b>{row.targetRoas?`${row.targetRoas}%`:'—'}</b><span><b>{row.startDate||'—'}</b><small>至 {row.endDate||'NO END DATE'}</small></span><b>{row.impressions}</b><b>{row.clicks}</b><b>{(row.ctr*100).toFixed(2)}%</b><b>{money2(row.spend)}</b><b>{money2(metricCpc(row))}</b><b>{row.orders}</b><b>{row.units}</b><b>{money2(row.cpa)}</b><b>{money2(row.wsc)}</b><b>{money2(row.retail)}</b><strong>{row.wscRoas.toFixed(2)}×</strong><strong>{row.retailRoas.toFixed(2)}×</strong></article>)}{!loading&&!managerCampaigns.length?<p className="empty-state">当前筛选没有 Campaign 数据。</p>:null}</div></div>
      </section>}
    </>}
    {tab==='listings'&&<section className="card ad-manager-card listing-performance-card"><div className="manager-filters"><label>搜索<input value={managerQuery} onChange={event=>setManagerQuery(event.target.value)} placeholder="父体 SKU、Campaign、商品或子体 Part"/></label><label>状态<select value={managerStatus} onChange={event=>setManagerStatus(event.target.value)}><option value="ALL">全部状态</option><option value="ACTIVE">投放中</option><option value="PAUSE">已暂停</option><option value="INACTIVE">未启用</option></select></label></div><div className="listing-grain-note"><b>统计口径：父体 SKU</b><span>按父体 Listing 汇总广告指标；子体 Supplier Part 仅展示关联关系，不拆分广告归因。</span></div><div className="api-table-scroll"><div className="api-table listing-manager-table listing-performance-table"><div className="api-row head"><SortHeader label="父体 SKU / Campaign" field="listing" sort={listingSort} onSort={sortListing}/><span>商品名称 / 类目</span><SortHeader label="状态 / 客群" field="status" sort={listingSort} onSort={sortListing}/><SortHeader label="Bid" field="bid" sort={listingSort} onSort={sortListing}/><SortHeader label="曝光" field="impressions" sort={listingSort} onSort={sortListing}/><SortHeader label="点击" field="clicks" sort={listingSort} onSort={sortListing}/><SortHeader label="CTR" field="ctr" sort={listingSort} onSort={sortListing}/><SortHeader label="花费" field="spend" sort={listingSort} onSort={sortListing}/><SortHeader label="CPC" field="cpc" sort={listingSort} onSort={sortListing}/><SortHeader label="订单" field="orders" sort={listingSort} onSort={sortListing}/><SortHeader label="CPA" field="cpa" sort={listingSort} onSort={sortListing}/><SortHeader label="WSC 销售额" field="wsc" sort={listingSort} onSort={sortListing}/><SortHeader label="CVR" field="cvr" sort={listingSort} onSort={sortListing}/><SortHeader label="WSC ROAS" field="wscRoas" sort={listingSort} onSort={sortListing}/></div>{managerListings.map(row=><article className="api-row" key={`${row.campaignId}:${row.listing}`}><span><b>{row.listing}</b><small>{row.campaignName||`Campaign ${row.campaignId}`} · {row.parts.join(' / ')||'Part未映射'}</small></span><span><b>{row.productName||'—'}</b><small>{row.className||'未分类'}</small></span><span><em className={/active/i.test(row.status)?'good':/pause|inactive/i.test(row.status)?'bad':'neutral'}>{row.status||'—'}</em><small>{String(row.isB2b).toLowerCase()==='true'?'B2B':'B2C'} · Campaign {row.campaignStatus||'—'}</small></span><b>{money2(row.bid)}</b><b>{row.current.impressions}</b><b>{row.current.clicks}</b><b>{(row.current.ctr*100).toFixed(2)}%</b><b>{money2(row.current.spend)}</b><b>{money2(metricCpc(row.current))}</b><b>{row.current.orders}</b><b>{money2(row.current.cpa)}</b><b>{money2(row.current.wsc)}</b><b>{(row.current.cvr*100).toFixed(2)}%</b><strong>{row.current.wscRoas.toFixed(2)}×</strong></article>)}{!loading&&!managerListings.length?<p className="empty-state">当前筛选没有父体 SKU 数据。</p>:null}</div></div></section>}
    {tab==='manual'&&<div className="manual-optimization-workspace">
      <section className="card manual-boundary"><div><span>MANUAL CONTROL</span><h2>关键词布局与预算分配</h2><p>基础容量 $1,800 是月度上限，不是必须花完；关键词需同时看 CTR 与 WSC ROAS。</p></div><b>关键词、否词、Campaign Cap 和 tROAS 保留人工执行</b></section>
      <section className="keyword-allocation-grid">{AD_BUDGET_ALLOCATION.map(item=>{const actual=item.id==='keyword'?keywordSpend:item.id==='product'?productSpend:null;return <article className={`card allocation-${item.id}`} key={item.id}><span>{item.share}</span><strong>${item.budget}</strong><h3>{item.label}</h3><p>{item.note}</p><small>{actual==null?'按计划释放':`所选周期已花 ${money2(actual)}`}</small></article>})}</section>
      <section className="card allocation-ledger"><div className="section-head"><div><span>LISTING × AD TYPE</span><h2>头部 Listing 分配</h2></div><b>Keyword $750 · Product $650 · B2B $150</b></div><div className="allocation-table"><div className="allocation-row head"><span>Listing</span><span>Keyword</span><span>Product</span><span>B2B</span><span>合计</span><span>分配理由</span></div>{KEYWORD_LISTING_ALLOCATION.map(item=><article className="allocation-row" key={item.listing}><strong>{item.listing}</strong><b>{money(item.keyword)}</b><b>{money(item.product)}</b><b>{money(item.b2b)}</b><strong>{money(item.total)}</strong><p>{item.reason}</p></article>)}</div><p className="allocation-note">其余容量：Canada $50，结构扩容 / 机动 $200；低效 Product 达到迁移 Gate 后，最多 $150 转给已过 Gate 的 Keyword。</p></section>
      <section className="card zombie-resolution-card"><div className="section-head"><div><span>MANUAL DIAGNOSIS</span><h2>Campaign / 资格诊断</h2></div><b>{resolvedZombieCount} / {zombieFindings.length} 已完成 · 硬僵尸 {zombieAudit.hard} · 准僵尸 {zombieAudit.near}</b></div>
        <p className="allocation-note">处置进入统一任务账本；只有提交执行结果、平台证据并由验收人确认后，才计为完成。</p>
        <div className="zombie-resolution-table">{zombieFindings.map(item=>{const key=zombieResolutionKey(item);const resolution=zombieResolutions[key];const methods=ZOMBIE_METHOD_OPTIONS[item.actionType];const method=resolution?.method||methods[0];const done=resolution?.status==='VERIFIED';return <article className={`zombie-resolution-row ${done?'done':''}`} key={key}>
          <div><span><em>{item.severity}</em><strong>{item.campaignName||`Campaign ${item.campaignId}`}</strong></span><small>ID {item.campaignId} · {item.listing} · {item.targetingType||'Targeting 未知'}</small></div>
          <p><b>{item.metric.impressions} 曝光 · {money2(item.metric.spend)} · {item.metric.orders} 单</b><small>{item.linkStatus} · Bid {money2(item.bid)} · {item.label}</small></p>
          <div className="zombie-method-fields"><label>处理方式<select aria-label={`${item.listing} 处理方式`} value={method} onChange={event=>patchZombieResolution(key,{method:event.target.value})}>{methods.map(option=><option value={option} key={option}>{option}</option>)}</select></label><label>负责人<input value={resolution?.owner||''} placeholder="广告运营" onChange={event=>patchZombieResolution(key,{owner:event.target.value})}/></label></div>
          <div className="zombie-closure-form"><label>执行结果<input value={resolution?.executionResult||''} placeholder="平台实际状态或数值" onChange={event=>patchZombieResolution(key,{executionResult:event.target.value})}/></label><label>执行证据<input value={resolution?.evidence||''} placeholder="Partner Home 证据说明" onChange={event=>patchZombieResolution(key,{evidence:event.target.value})}/></label><label>验收人<input value={resolution?.acceptedBy||''} placeholder="负责人姓名" onChange={event=>patchZombieResolution(key,{acceptedBy:event.target.value})}/></label><div><button className="ghost" onClick={()=>saveZombieResolution(item,done?'REOPENED':'EXECUTING')}>{done?'重新打开':'保存进度'}</button><button className="primary" disabled={!resolution?.executionResult||!resolution?.evidence||!resolution?.acceptedBy} onClick={()=>saveZombieResolution(item,'VERIFIED')}>提交验收</button></div></div>
        </article>})}{!loading&&!zombieFindings.length?<p className="empty-state">未发现满足规则的硬僵尸或准僵尸 Campaign。</p>:null}</div>
      </section>
      <section className="card manual-todo-card"><div className="section-head"><div><span>OPERATOR CHECKLIST</span><h2>手动优化 To-Do List · 按父体 SKU</h2></div><b>统一任务账本 / 服务器审计记录 · {manualDone.length} / {MANUAL_AD_TASK_COUNT} 已验收</b></div>{manualRecordMessage&&<p className="manual-record-message">{manualRecordMessage}</p>}<div className="manual-todo-list">{MANUAL_AD_TASK_GROUPS.map(group=>{const completed=group.tasks.filter(task=>manualDone.includes(manualTaskKey(group.sku,task.id))).length;return <details className={`manual-sku-group${completed===group.tasks.length?' done':''}`} open key={group.sku}><summary><span><small>PARENT SKU</small><strong>{group.sku}</strong></span><span><b>{completed} / {group.tasks.length} 已验收</b><progress max={group.tasks.length} value={completed}/></span></summary><div className="manual-sku-actions">{group.tasks.map((task,index)=>{const taskId=manualTaskKey(group.sku,task.id);const record=manualRecords[taskId];const draft={...record,...manualDrafts[taskId]};const done=record?.status==='VERIFIED';const progressStatus:ManualCompletionRecord['status']=done||record?.status==='PENDING_ACCEPTANCE'?'REOPENED':'IN_PROGRESS';return <article className={`manual-todo-row${done?' done':''}`} key={taskId}><span className="manual-todo-priority"><i>{String(index+1).padStart(2,'0')}</i><em>{task.priority}</em><small>{task.group}</small><b>Campaign ID: {task.campaignId}</b><strong>{record?.status||'OPEN'}</strong></span><div className="manual-todo-content"><strong>{task.title}</strong><p>{task.detail}</p>{done&&record?.completedAt?<small className="manual-audit-time">验收时间：{new Date(record.completedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</small>:null}<dl className="manual-task-details"><div><dt>广告组</dt><dd>{task.adGroup}</dd></div><div><dt>Campaign ID</dt><dd>{task.campaignId}</dd></div><div><dt>具体 SKU</dt><dd>{task.sku}</dd></div><div><dt>广告类型</dt><dd>{task.adType}</dd></div><div><dt>关键词</dt><dd>{task.keywords}</dd></div><div><dt>匹配</dt><dd>{task.match}</dd></div><div><dt>起始 Bid</dt><dd>{task.bid}</dd></div><div><dt>预算</dt><dd>{task.budget}</dd></div><div className="rule"><dt>执行 / 验收规则</dt><dd>{task.rule}</dd></div></dl><div className="manual-task-closure"><label>负责人<input value={draft.owner||''} placeholder="广告运营" onChange={event=>patchManualDraft(taskId,{owner:event.target.value})}/></label><label>执行结果<input value={draft.executionResult||''} placeholder="填写平台实际数值或状态" onChange={event=>patchManualDraft(taskId,{executionResult:event.target.value})}/></label><label>执行证据<input value={draft.evidence||''} placeholder="填写 Partner Home 证据说明" onChange={event=>patchManualDraft(taskId,{evidence:event.target.value})}/></label><label>验收人<input value={draft.acceptedBy||''} placeholder="负责人姓名" onChange={event=>patchManualDraft(taskId,{acceptedBy:event.target.value})}/></label><label>成熟复盘日<input type="date" value={draft.reviewDueAt||''} onChange={event=>patchManualDraft(taskId,{reviewDueAt:event.target.value})}/></label><div><button className="ghost" onClick={()=>saveManualTask(taskId,group.sku,task,progressStatus)}>{done||record?.status==='PENDING_ACCEPTANCE'?'重新打开':'保存进度'}</button><button className="primary" disabled={!draft.executionResult||!draft.evidence||!draft.acceptedBy||record?.status==='REOPENED'} onClick={()=>saveManualTask(taskId,group.sku,task,'VERIFIED')}>提交验收</button></div></div></div></article>})}</div></details>})}</div></section>
    </div>}
    {tab==='ai'&&<>
    <div className="card model-shadow-card"><div className="section-head"><div><span>MODEL FIRST · READ ONLY</span><h2>广告决策模型 · Shadow</h2></div><b>{decisionModel?`${decisionModel.version} · ${decisionModel.summary.actionableInShadow} 个 Canary 候选 · ${decisionModel.summary.blocked} 个阻断`:'等待成熟数据'}</b></div>
      {campaignControl&&<><div className="ai-decision-context live-safety-context"><span>已回读执行口径</span><b>Wallet Daily Cap {money2(campaignControl.walletDailyCap)}</b><em>活跃 Campaign Cap 合计 {money2(campaignControl.activeCampaignDailyCap)} · 安全余量 {money2(campaignControl.walletHeadroom)}。Campaign 级暂停必须先检查混投关系，不得因单个零预算 Listing 误伤整组。</em></div>
      <div className="ai-workbench-metrics"><span><small>Campaign 597350</small><b>Active · {money2(campaignControl.correctedCampaign.dailyCap)}/day</b><em>纠偏后保持活跃</em></span><span><small>商品隔离</small><b>DMOM1025 / LFC-3W</b><em>产品行 Paused，不暂停整组</em></span><span><small>L28 Retail ROAS</small><b>{campaignControl.correctedCampaign.last28RetailRoas.toFixed(2)}×</b><em>{money2(campaignControl.correctedCampaign.last28Spend)} 花费 · {money2(campaignControl.correctedCampaign.last28Revenue)} Revenue</em></span><span><small>继续 Paused</small><b>{campaignControl.pausedCampaignIds.join(' · ')}</b><em>已执行状态，不再生成重复暂停任务</em></span></div></>}
      <div className="ai-decision-context"><span>长期目标</span><b>最大化预期增量广告后贡献</b><em>当前阶段先学习增量响应。模型只读取成熟数据；因果置信度为 C0，所以只展示归因场景假设，不计算真实增量 ROI 或成功概率，也不会进入广告 API 执行队列。</em></div>
      <div className="ai-workbench-metrics"><span><small>模型单元</small><b>{decisionModel?.summary.units||0}</b><em>Campaign × Listing</em></span><span><small>Shadow Canary</small><b>{decisionModel?.summary.actionableInShadow||0}</b><em>仅生成实验设计</em></span><span><small>输入阻断</small><b>{decisionModel?.summary.blocked||0}</b><em>成本 / 映射 / 库存 / 链接</em></span><span><small>模型最优预算</small><b>{decisionModel?.optimalBudget.status==='UNKNOWN'?'尚不可估计':money(decisionModel?.optimalBudget.amount||0)}</b><em>等待真实干预响应曲线</em></span></div>
      <p className="ai-workbench-note">实验最大损失：组合 {money2(decisionModel?.riskPolicy?.portfolioMaxLoss||0)}，单日增量 {money2(decisionModel?.riskPolicy?.portfolioMaxDailyIncrementalLoss||0)}；守住 8 月贡献代理下限 {money2(decisionModel?.riskPolicy?.monthlyContributionFloor||0)}。最早 {decisionModel?.riskPolicy?.earliestStart||'-'} 启动，{decisionModel?.riskPolicy?.earliestMatureReview||'-'} 首评。该下限基于收入目标、当前采购毛利率与基础广告计划，不等同于含退货、物流及扣款后的净利润。</p>
      <p className="ai-workbench-note">指标口径分开：成熟 WSC ROAS 衡量平台归因销售效率；每 $100 广告花费订单数衡量获单效率；增量营销 ROI 只有在可识别的新增投入与增量贡献同时存在时才计算。贡献利润仍是经营贡献代理，不是店铺净利润。</p>
      <div className="action-list rich model-shadow-list"><div className="action-head"><span>Listing / Campaign</span><span>模型任务</span><span>置信度</span><span>归因场景假设</span><span>边界</span></div>{modelTodo.map(item=>{const delta=item.attributedScenarioDelta;return <article key={item.id}><div><strong>{item.listing}</strong><small>Campaign {item.campaignId}</small><small>{item.executionPlan?`8月目标 ${item.executionPlan.listingTargetOrders} Orders · 授权广告池 ${money2(item.executionPlan.listingPlannedAdBudget)}`:'8月计划未映射'}</small></div><div><b>{item.title}</b><small>{item.detail}</small></div><p><b>{item.confidence.data} / {item.confidence.predictive} / {item.confidence.causal}</b><br/>真实增量为正概率：不可估计</p><p>{delta&&delta.orders!=null&&delta.spend!=null&&delta.wsc!=null?<><b>归因订单 {delta.orders>=0?'+':''}{delta.orders.toFixed(2)}</b><br/>花费场景 {delta.spend>=0?'+':''}{money2(delta.spend)}<br/>归因 WSC {delta.wsc>=0?'+':''}{money2(delta.wsc)}<br/>贡献场景 {delta.contributionProxy==null?'不可估计':`${delta.contributionProxy>=0?'+':''}${money2(delta.contributionProxy)}`}</>:<b>等待输入</b>}</p><div className="recommendation-execution"><em className="neutral">Shadow only</em><small>{item.blockers.length?item.blockers.join(' · '):'需先完成预注册、功效分析和人工审批'}</small></div></article>})}{!loading&&!modelTodo.length?<p className="empty-state">当前没有可生成的模型任务。</p>:null}</div>
    </div>
    <section className="card action-ledger ai-api-workbench"><div className="section-head"><div><span>ADVERTISING API</span><h2>AI API 执行工作台</h2></div><b>{queueLoading?'读取中':`${ready} 项建议 · ${apiQueuedActions.length} 项已入批次 · 成功 ${executedActions.length} · 失败 ${failedActions.length}`}</b></div>
      <div className="ai-decision-context"><span>建议与动作依据</span><b>成熟周 {data?.decisionRange.start||'-'} → {data?.decisionRange.end||'-'}</b><em>成熟数据负责评估；Campaign × Listing 分开计算，不用父体汇总混淆多个 Campaign。</em></div>
      <div className="ai-decision-context live-safety-context"><span>实时安全窗</span><b>{data?.liveSafetyRange?.start||'-'} → {data?.liveSafetyRange?.end||'-'}</b><em>4日异常只报警；持续7日达到真实成熟CVR样本门槛才进入辩论，未成熟数据绝不直接调参。</em></div>
      <div className="ai-workbench-metrics"><span><small>成熟周花费</small><b>{loading?'-':money(aiDecisionCurrent?.spend)}</b><em>{change(aiDecisionCurrent?.spend,aiDecisionPrevious?.spend)}</em></span><span><small>成熟周归因订单</small><b>{loading?'-':String(aiDecisionCurrent?.orders||0)}</b><em>{change(aiDecisionCurrent?.orders,aiDecisionPrevious?.orders)}</em></span><span><small>成熟周 WSC ROAS</small><b>{loading?'-':`${(aiDecisionCurrent?.wscRoas||0).toFixed(2)}×`}</b><em>前成熟周 {(aiDecisionPrevious?.wscRoas||0).toFixed(2)}×</em></span><span><small>动作进度</small><b>{validatedActions.length} 待执行</b><em>{approvedActions.length} 待预检</em></span></div>
      <p className="ai-workbench-note">双窗口决策：成熟归因负责评估和扩量，实时安全窗负责预警和阻止过时动作。仅 Bid 与 Listing 启停进入此处；其余动作留在手动优化。每次执行前还会对照最新 Listing 报表重新校验状态与 Bid。</p>
      <div className="table-tools ai-workbench-tools"><label className="search-field">搜索<input value={actionQuery} onChange={event=>setActionQuery(event.target.value)} placeholder="筛选 Listing、Campaign 或 Part"/></label><label>执行状态<select value={queueFilter} onChange={event=>setQueueFilter(event.target.value)}><option value="ALL">全部</option><option value="unqueued">待加入</option><option value="queued">已入批次</option></select></label><span>待加入 {selectedRecommendations.length} · 待预检 {selectedQueue.length+approvedActions.length}</span><button disabled={!selectedRecommendations.length||batchBusy} onClick={queueSelected}>加入执行 ({selectedRecommendations.length})</button><button className="primary" disabled={(!selectedQueue.length&&!approvedActions.length)||batchBusy} onClick={prepareSelected}>确认并预检 ({selectedQueue.length+approvedActions.length})</button><button className="primary dark" disabled={!validatedActions.length||batchBusy||!liveEnabled} onClick={executeValidated}>执行已预检项 ({validatedActions.length})</button><em>{liveEnabled?'生产写入已启用':'生产写入安全开关未启用'}</em></div>
      {queueError&&<div className="inline-error">{queueError}</div>}
      <div className="action-list rich"><div className="action-head selectable"><input type="checkbox" aria-label="选择全部可处理项" checked={allSelectableActionsSelected} onChange={toggleAllSelectableActions}/><span>Listing / Campaign</span><span>双窗口证据</span><span>利润 / 链接 / 库存 / 目标</span><span>建议动作与运营辩论</span><span>API 状态 / 结果</span></div>{filteredListings.map(row=>{const key=`${row.campaignId}:${row.listing}`;const queuedAction=queueActionByKey.get(`${key}:${row.action.type}`);const queueSelectable=Boolean(queuedAction&&isBulkApprovable(queuedAction));const recommendationSelectable=API_AD_ACTION_TYPES.has(row.action.type)&&row.operatorReview?.verdict==='CANDIDATE'&&!queuedAction;const selectable=recommendationSelectable||queueSelectable;const checked=queuedAction?selectedQueue.includes(queuedAction.id):selectedRecommendations.includes(key);const result=queuedAction?executionResultForAction(queuedAction):null;const statusLabel=queuedAction?.status==='PLANNED'?'待确认':queuedAction?.status==='APPROVED'?'待预检':queuedAction?.status==='VALIDATED'?'预检通过':queuedAction?.status==='EXECUTING'?'执行中':queuedAction?.status==='EXECUTED'?'已执行':queuedAction?.status==='FAILED'?'失败可重试':'待加入';return <article className="selectable" key={key}><input type="checkbox" aria-label={`选择 ${row.listing}`} disabled={!selectable} checked={checked} onChange={event=>{if(queuedAction)setSelectedQueue(value=>event.target.checked?[...value,queuedAction.id]:value.filter(id=>id!==queuedAction.id));else setSelectedRecommendations(value=>event.target.checked?[...value,key]:value.filter(id=>id!==key));}}/><div><strong>{row.listing}</strong><small>Campaign {row.campaignId}<br/>{row.parts.join(' / ')||'Part未映射'}</small></div><p>{row.liveSafety&&['ALERT','CONFIRMED_STOP'].includes(row.liveSafety.status)?<span className="live-safety-evidence"><em>{row.liveSafety.status==='ALERT'?'实时预警':'持续异常候选'}</em><b>{money(row.liveSafety.recent.spend)} / {row.liveSafety.recent.clicks} 点击 / {row.liveSafety.recent.orders} 单</b><small>{data?.liveSafetyRange?.start} → {data?.liveSafetyRange?.end} · 样本门槛 {row.liveSafety.requiredClicks} 点击</small></span>:<><b>{money(row.current.spend)} / {row.current.clicks} 点击 / {row.current.orders} 单</b><br/>成熟 ROAS {row.current.wscRoas.toFixed(2)}×</>}<br/>CPC {row.cpcBaseline.actualCpc==null?'—':money2(row.cpcBaseline.actualCpc)} / BM {row.cpcBaseline.cpc==null?'—':money2(row.cpcBaseline.cpc)}</p><p><b>保本</b> {row.economics.breakEvenRoas.toFixed(2)}×<br/><b>链接</b> {row.linkQuality.rating??'缺失'}分 / {row.linkQuality.reviews??'-'}评<br/><b>库存</b> {row.inventory.known?`${row.inventory.quantityOnHand}件 / ${row.inventory.coverDays}天`:'未入库'}<br/><b>责任</b> 7月余{row.goalGuardrail.julyRemainingUnits} / 8月留{row.goalGuardrail.augustReserveUnits}</p><div className="recommendation-cell"><div className="recommendation-title"><span className={row.action.recommendation==='READY'?'recommend-ready':'recommend-hold'}>{row.action.recommendation==='READY'?'候选调整':'建议保持'}</span><b>{row.action.label}</b></div><p className="recommendation-reason">{row.action.reasons[0]||'依据成熟归因周期与经营目标生成。'}</p>{row.action.reasons.length>1?<dl className="recommendation-evidence">{row.action.reasons.slice(1,3).map((reason,index)=><div key={`${key}:reason:${index}`}><dt>依据 {index+1}</dt><dd>{reason}</dd></div>)}</dl>:null}{row.operatorReview?<div className={`operator-debate ${row.operatorReview.verdict==='CANDIDATE'?'candidate':'hold'}`}><header><b>运营 Agent 辩论</b><span>{row.operatorReview.verdict==='CANDIDATE'?'候选，待负责人批准':'反方驳回 / 继续观察'}</span></header><p>{row.operatorReview.counterpoint}</p><small>负责人：{row.operatorReview.decisionOwner}{row.operatorReview.cooldownUntil?` · 冷却至 ${row.operatorReview.cooldownUntil}`:''}</small><small>单一变量：{row.operatorReview.singleVariable?'是':'否'} · 回滚：{row.operatorReview.rollbackPlan}</small></div>:null}{row.action.repairPlan?<div className="recommendation-repair"><header><b>修复清单</b><span>{row.action.repairPlan.focus}</span></header><p>{row.action.repairPlan.diagnosis}</p><ol>{row.action.repairPlan.steps.map((step,index)=><li key={`${key}:repair:${index}`}>{step}</li>)}</ol><div className="repair-acceptance"><b>验收门槛</b><ul>{row.action.repairPlan.acceptance.map((item,index)=><li key={`${key}:acceptance:${index}`}>{item}</li>)}</ul></div><small><b>验收后重测</b>{row.action.repairPlan.retest}</small></div>:null}{row.action.warnings.length||row.action.blockers.length?<div className="recommendation-alerts">{row.action.warnings.slice(0,1).map((warning,index)=><span className="recommendation-warning" key={`${key}:warning:${index}`}>{warning}</span>)}{row.action.blockers.length?<span className="gate-warning">预算审批：{row.action.blockers.join('；')}</span>:null}</div>:null}</div><div className="recommendation-execution"><em className={queuedAction?(queuedAction.status==='FAILED'?'bad':queuedAction.status==='EXECUTED'?'good':'warn'):(row.action.execution==='READY_FOR_PLAN'?'good':row.action.execution==='NEEDS_INPUT'?'warn':'neutral')}>{queuedAction?statusLabel:row.action.execution==='READY_FOR_PLAN'?'可加入':row.action.execution==='NEEDS_INPUT'?'预算待审批':'本周保持'}</em>{queuedAction&&result?<div className={`workbench-result ${result.tone}`}><b>{result.title}</b><small>{result.detail}</small></div>:null}{recommendationSelectable?<button onClick={()=>queueAction(row)}>加入执行</button>:null}{queuedAction&&canRemoveAction(queuedAction.status)?<button className="ghost" disabled={batchBusy} onClick={()=>removeAction(queuedAction)}>移除</button>:null}</div></article>})}{!loading&&!filteredListings.length&&<p className="empty-state">没有符合筛选条件的建议。</p>}</div>
      {batchMessage&&<div className="batch-message">{batchMessage}</div>}
    </section>
    </>}
    {tab==='manager'&&<section className="card daily-efficiency"><div className="section-head"><div><span>所选周期</span><h2>日级投放效率</h2></div><b>{money(data?.current.spend||0)} 花费 · {data?.current.orders||0} 单 · ROAS {(data?.current.wscRoas||0).toFixed(2)}×</b></div><div className="daily-efficiency-list"><div className="daily-efficiency-row head"><span>日期</span><span>曝光</span><span>点击 / CPC</span><span>花费</span><span>归因订单</span><span>归因销售额</span><span>ROAS</span><span>运营判断</span></div>{visibleHistory.map(row=>{const signal=adDailySignal(row);return <article className="daily-efficiency-row manager" key={row.date}><time>{row.date}</time><b>{row.impressions}</b><b>{row.clicks} / {money2(metricCpc(row))}</b><div className="spend-cell"><b>{money2(row.spend)}</b><i><span style={{width:`${Math.max(2,row.spend/dailySpendMax*100)}%`}}></span></i></div><b>{row.orders} 单</b><b>{money2(row.wsc)}</b><strong>{row.wscRoas.toFixed(2)}×</strong><em className={signal.tone}>{signal.label}</em></article>})}{!loading&&!visibleHistory.length?<p className="empty-state">所选周期没有广告日级数据。</p>:null}</div></section>}
  </>;
}

function Review({ embedded = false, onOpenPlan }: { embedded?: boolean; onOpenPlan: (section: PlanSection) => void }) {
  const [report,setReport]=useState(0);const [uploads,setUploads]=useState<UploadedReport[]>(readClientCache<UploadedReport[]>('reports:list',CLIENT_CACHE_RETENTION_MS)||[]);const [uploading,setUploading]=useState(false);const [uploadMessage,setUploadMessage]=useState('');
  useEffect(()=>{const cached=readClientCache<UploadedReport[]>('reports:list');const controller=new AbortController();if(cached){queueMicrotask(()=>setUploads(cached));return()=>controller.abort();}fetch('/api/reports',{signal:controller.signal}).then(async r=>await r.json() as {reports?:UploadedReport[]}).then(body=>{const reports=body.reports||[];setUploads(reports);writeClientCache('reports:list',reports);}).catch(()=>{});return()=>controller.abort();},[]);
  const allReports=useMemo(()=>[...REPORTS.map(item=>({...item,assetUrl:`/reports/${encodeURIComponent(item.file)}`,uploaded:false})),...uploads.map(item=>({title:item.title,file:item.fileName,kind:item.kind,date:new Date(item.createdAt).toLocaleDateString('zh-CN'),summary:'用户补充的复盘证据，原文件已持久化保存。',sections:[],assetUrl:`/api/reports/file?id=${encodeURIComponent(item.id)}`,uploaded:true}))],[uploads]);
  const selected=allReports[Math.min(report,allReports.length-1)];const spreadsheet=selected.file.endsWith('.xlsx');
  async function uploadReport(file:File|null){if(!file)return;setUploading(true);setUploadMessage('');try{const form=new FormData();form.set('file',file);const response=await fetch('/api/reports',{method:'POST',body:form});const body=await response.json() as UploadedReport&{error?:string};if(!response.ok)throw new Error(body.error||'报告上传失败');setUploads(value=>{const next=[body,...value];writeClientCache('reports:list',next);return next;});setReport(REPORTS.length);setUploadMessage('报告已保存并加入资料库。');}catch(error){setUploadMessage(error instanceof Error?error.message:'报告上传失败');}finally{setUploading(false);}}
  return <>{!embedded&&<Hero eyebrow="MONTHLY REVIEW · FULL REPORTS" title="月度复盘" text="直接阅读完整原报告，不再用四个摘要框代替正文" side={<label className="hero-button upload-report">{uploading?'上传中…':'补充复盘资料'}<input type="file" accept=".html,.htm,.pdf,.xlsx" disabled={uploading} onChange={e=>uploadReport(e.target.files?.[0]||null)}/></label>} />}
    <section className="review-context" aria-label="复盘与计划月份导航"><button aria-label="查看6月月度复盘" onClick={()=>setReport(REPORTS.findIndex(item=>item.title==='2026年6月月度复盘总览'))}><span>复盘事实月</span><b>2026-06 · 已归档</b></button><i>→</i><button aria-label="返回7月执行计划" onClick={()=>onOpenPlan('july')}><span>当前经营月</span><b>2026-07 · 128 Orders执行中</b></button><i>→</i><button aria-label="查看8月推广计划" onClick={()=>onOpenPlan('august')}><span>下一计划月</span><b>2026-08 · 150 Orders推广准备</b></button></section>
    {uploadMessage&&<div className="upload-message">{uploadMessage}</div>}
    <div className="review-grid full-reader"><aside className="card report-list"><div><span>复盘资料</span><h2>完整复盘资料</h2><b>{allReports.length}</b></div>{allReports.map((x,i)=><button className={report===i?'active':''} onClick={()=>setReport(i)} key={`${x.uploaded?'upload':'builtin'}:${x.file}`}><strong>{x.title}</strong><small>{x.kind} · {x.date||'2026/07/15'}</small></button>)}</aside><article className="card report-reader"><header><div><span>{selected.kind} · 完整原报告</span><h2>{selected.title}</h2><p>{selected.summary}</p></div><div className="report-actions">{embedded&&<label className="compact-upload">{uploading?'上传中…':'补充复盘资料'}<input type="file" accept=".html,.htm,.pdf,.xlsx" disabled={uploading} onChange={e=>uploadReport(e.target.files?.[0]||null)}/></label>}<a href={selected.assetUrl} target="_blank" rel="noreferrer">{spreadsheet?'下载原表格':'在新窗口打开'}</a></div></header>{spreadsheet?<div className="sheet-download"><b>执行清单为 XLSX 原表格</b><p>点击右上角下载完整文件；同一内容的可读版请在左侧打开“SKU广告重构执行清单”。</p><a href={selected.assetUrl} download>下载 {selected.file}</a></div>:<iframe key={selected.assetUrl} title={selected.title} src={selected.assetUrl} sandbox={selected.uploaded?'':'allow-same-origin allow-scripts allow-popups'} />}</article></div>
  </>;
}

function Catalog({ embedded = false }: { embedded?: boolean }) {
  const initialCatalog=readClientCache<CatalogResponse>('catalog:page=1&pageSize=30',CLIENT_CACHE_RETENTION_MS);
  const [query,setQuery]=useState(''); const [submitted,setSubmitted]=useState(''); const [status,setStatus]=useState('');
  const [catalogSort,setCatalogSort]=useState<SortState>({key:'revenue',direction:'desc'});
  const [page,setPage]=useState(1); const [refresh,setRefresh]=useState(0); const [data,setData]=useState<CatalogResponse | null>(initialCatalog); const [loading,setLoading]=useState(!initialCatalog); const [error,setError]=useState(''); const [selected,setSelected]=useState<CatalogItem | null>(initialCatalog?.items?.[0]||null);
  useEffect(()=>{
    const controller=new AbortController();
    const params=new URLSearchParams({page:String(page),pageSize:'30'}); if(submitted)params.set('q',submitted); if(status)params.set('status',status);
    const cacheKey=`catalog:${params}`;const cached=refresh===0?readClientCache<CatalogResponse>(cacheKey):null;if(cached){queueMicrotask(()=>{if(!controller.signal.aborted){setData(cached);setSelected(cached.items?.[0]||null);setLoading(false);}});return()=>controller.abort();}
    fetch(`/api/catalog/items?${params}`,{signal:controller.signal}).then(async response=>{const body=await response.json() as CatalogResponse;if(!response.ok)throw new Error(body.error||'商品数据读取失败');return body;}).then(body=>{setData(body);setSelected(body.items?.[0]||null);writeClientCache(cacheKey,body);}).catch(reason=>{if(reason.name!=='AbortError')setError(reason.message||'商品数据读取失败');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[submitted,status,page,refresh]);
  const pages=data?.paginationInfo;
  const insights=selected?.insights;
  const insightTotal=(insights?.problems?.length||0)+(insights?.warnings?.length||0)+(insights?.opportunities?.length||0);
  const catalogItems=sortRows(data?.items||[],catalogSort,{sku:(item:CatalogItem)=>item.supplierPartNumber,status:(item:CatalogItem)=>item.catalogItemStatus,brand:(item:CatalogItem)=>item.marketContext?.brand,issues:(item:CatalogItem)=>(item.insights?.problems?.length||0)+(item.insights?.warnings?.length||0),units:(item:CatalogItem)=>item.recent30d?.units||0,revenue:(item:CatalogItem)=>item.recent30d?.revenue||0}) as CatalogItem[];
  function submit(){setLoading(true);setError('');setPage(1);setSubmitted(query.trim().toUpperCase());setRefresh(value=>value+1);}
  return <>{!embedded&&<Hero eyebrow="CATALOG READ V2 · ORDER JOIN" title="商品数据" text="Catalog 商品事实与近 30 天订单表现合并为 SKU 360° 视图" side={<div className="hero-side"><b>{loading?'同步中':error?'需检查':'已连接'}</b><span>Catalog Read V2 · {pages?.totalCount||0} 个商品</span></div>} />}
    <section className="card catalog-card"><div className="filters"><label>Supplier Part #<input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')submit();}} placeholder="精确输入，如 DMOM1022"/></label><label>商品状态<select value={status} onChange={e=>{setLoading(true);setError('');setStatus(e.target.value);setPage(1);}}><option value="">全部状态</option><option value="LIVE">LIVE</option><option value="NOT_LIVE">NOT LIVE</option><option value="LAUNCHING">LAUNCHING</option></select></label><button className="primary" onClick={submit}>查询商品</button></div>
      {error&&<div className="inline-error">{error}</div>}
      <div className="catalog-layout"><div className="catalog-results"><div className="catalog-row catalog-head"><SortHeader label="SKU / Listing" field="sku" sort={catalogSort} onSort={field=>setCatalogSort(value=>nextSort(value,field) as SortState)}/><SortHeader label="状态" field="status" sort={catalogSort} onSort={field=>setCatalogSort(value=>nextSort(value,field) as SortState)}/><SortHeader label="品牌 · 类目" field="brand" sort={catalogSort} onSort={field=>setCatalogSort(value=>nextSort(value,field) as SortState)}/><span>市场</span><SortHeader label="诊断" field="issues" sort={catalogSort} onSort={field=>setCatalogSort(value=>nextSort(value,field) as SortState)}/><span className="dual-sort"><SortHeader label="近30天件数" field="units" sort={catalogSort} onSort={field=>setCatalogSort(value=>nextSort(value,field) as SortState)}/><SortHeader label="销售额" field="revenue" sort={catalogSort} onSort={field=>setCatalogSort(value=>nextSort(value,field) as SortState)}/></span></div>{catalogItems.map(item=>{const issues=(item.insights?.problems?.length||0)+(item.insights?.warnings?.length||0);return <button className={`catalog-row ${selected?.supplierPartNumber===item.supplierPartNumber?'selected':''}`} key={item.supplierPartNumber} onClick={()=>setSelected(item)}><span><strong>{item.supplierPartNumber}</strong><small>{item.listings?.length||0} 个 Listing</small></span><em className={item.catalogItemStatus==='LIVE'?'good':'bad'}>{item.catalogItemStatus?.replace('_',' ')||'-'}</em><span><b>{item.marketContext?.brand||'-'}</b><small>{item.class?.className||'未分类'}</small></span><span><b>{item.marketContext?.country||'-'} · {item.marketContext?.locale||'-'}</b><small>{item.marketContext?.channel||'-'} / {item.marketContext?.segment||'-'}</small></span><span><b>{issues} 问题</b><small>{item.insights?.opportunities?.length||0} 机会</small></span><span><b>{item.recent30d?.units||0} 件</b><small>{money(item.recent30d?.revenue||0)}</small></span></button>})}{!loading&&!data?.items?.length&&<p className="empty-state">没有符合条件的商品</p>} {loading&&<p className="empty-state">正在读取 Catalog…</p>}
        <div className="pagination"><span>第 {pages?.page||1} / {pages?.totalPages||1} 页 · 共 {pages?.totalCount||0} 个</span><button disabled={page<=1} onClick={()=>{setLoading(true);setError('');setPage(page-1);}}>上一页</button><button disabled={!pages?.hasNextPage} onClick={()=>{setLoading(true);setError('');setPage(page+1);}}>下一页</button></div></div>
        <aside className="product-detail">{selected?<><span>SKU 360°</span><h2>{selected.supplierPartNumber}</h2><div className="product-facts"><div><small>商品状态</small><b>{selected.catalogItemStatus?.replace('_',' ')}</b></div><div><small>Listing</small><b>{selected.listings?.length||0}</b></div><div><small>近 30 天销售</small><b>{money(selected.recent30d?.revenue||0)}</b></div><div><small>诊断信号</small><b>{insightTotal}</b></div></div><section><h3>市场与标识</h3><p>{selected.marketContext?.brand||'-'} · {selected.class?.className||'未分类'} · {selected.marketContext?.country||'-'} / {selected.marketContext?.channel||'-'}</p><div className="listing-tags">{selected.listings?.map(item=><i key={item.listingId}>{item.listingId}</i>)}</div></section><section><h3>Catalog 诊断</h3>{([['问题',insights?.problems],['警告',insights?.warnings],['机会',insights?.opportunities]] as [string,CatalogInsight[]|undefined][]).map(([label,list])=>list?.map(item=><article className="insight" key={item.insightId||item.title}><b>{label} · {item.title||'未命名信号'}</b><p>{item.explanation||'Catalog 未提供详细解释。'}</p>{item.monthsInViolation? <small>已持续 {item.monthsInViolation} 个月</small>:null}{item.resolution?.url&&/^https:\/\//.test(item.resolution.url)&&<a href={item.resolution.url} target="_blank" rel="noreferrer">查看 Wayfair 处理指引</a>}</article>))}{!insightTotal&&<p className="empty-insight">当前没有 Catalog 问题、警告或机会。</p>}</section>{selected.newProductSop&&selected.newProductSop.status!=='NOT_APPLICABLE'?<section className="linkage-note"><h3>运营 Agent · 推新 SOP</h3><p><b>{selected.newProductSop.status==='RECOMMENDED'?'先送测，再投广告':'条件未齐，暂不推新'}</b><br/>{selected.newProductSop.recommendation}</p>{selected.newProductSop.status==='RECOMMENDED'?<ol>{selected.newProductSop.steps.map(step=><li key={step.action}><b>{step.order}. {step.label}</b>：{step.instruction}<small>{step.acceptance}</small></li>)}</ol>:<ul>{selected.newProductSop.blockers.map(item=><li key={item}>{item}</li>)}</ul>}<small>{selected.newProductSop.automaticExecution?'允许自动执行':'只推送建议；送测与广告均需运营确认并通过各自 Gate。'}</small></section>:null}<section className="linkage-note"><h3>跨模块联动</h3><p>订单表现已关联；库存写入前进入 Inventory Gate，广告动作在周度父体清单统一审批。</p></section></>:<p>选择左侧商品查看完整信息。</p>}</aside></div>
    </section></>;
}

function NewProductSopWorkspace() {
  const [items,setItems]=useState<CatalogItem[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    async function loadPage(page:number){
      const response=await fetch(`/api/catalog/items?page=${page}&pageSize=30`,{signal:controller.signal});
      const body=await response.json() as CatalogResponse;
      if(!response.ok)throw new Error(body.error||'推新 SOP 商品读取失败');
      return body;
    }
    loadPage(1).then(async first=>{
      const totalPages=Math.min(10,Math.max(1,Number(first.paginationInfo?.totalPages||1)));
      const rest=totalPages>1?await Promise.all(Array.from({length:totalPages-1},(_,index)=>loadPage(index+2))):[];
      const unique=new Map<string,CatalogItem>();
      for(const item of [first,...rest].flatMap(result=>result.items||[])){
        const key=`${item.supplierPartNumber}:${item.marketContext?.country||''}:${item.marketContext?.channel||''}`;
        unique.set(key,item);
      }
      if(!controller.signal.aborted)setItems([...unique.values()]);
    }).catch(reason=>{if(reason.name!=='AbortError')setError(reason.message||'推新 SOP 商品读取失败');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[refresh]);
  function refreshQueue(){setLoading(true);setError('');setRefresh(value=>value+1);}
  const ready=items.filter(item=>item.newProductSop?.status==='RECOMMENDED');
  const blocked=items.filter(item=>item.newProductSop?.status==='BLOCKED');
  return <div className="sop-board">
    <section className="card sop-summary">
      <div><span>OPERATIONS AGENT</span><h2>推新规则队列</h2><p>图片与属性齐全后先送测；送测步骤通过，再进入小预算广告测试与 7/14 天复查。</p></div>
      <div className="sop-summary-metrics"><article><b>{ready.length}</b><span>运营 Agent 待接</span></article><article><b>{blocked.length}</b><span>待补条件</span></article><article><b>{items.length}</b><span>已扫描商品</span></article></div>
      <button className="primary" disabled={loading} onClick={refreshQueue}>{loading?'同步中…':'刷新队列'}</button>
    </section>
    {error?<p className="inventory-message bad">{error}</p>:null}
    <section className="sop-lane">
      <div className="section-head"><div><span>READY FOR OPERATIONS</span><h2>待送测</h2></div><b>{ready.length} 个新品候选</b></div>
      <div className="sop-card-grid">{ready.map(item=>{const sop=item.newProductSop!;return <article className="card sop-item ready" key={`${item.supplierPartNumber}:${item.marketContext?.country||''}:ready`}><header><span>{sop.priority} · {item.catalogItemStatus}</span><h3>{item.supplierPartNumber}</h3><small>{item.class?.className||'未分类'} · {item.listings?.map(listing=>listing.listingId).filter(Boolean).join(' / ')||'Listing待映射'}</small></header><div className="sop-evidence"><b>图片 {sop.evidence.imagesComplete?'齐全':'缺失'}</b><b>属性 {sop.evidence.attributesComplete?'齐全':'缺失'}</b><b>近30天 {sop.evidence.units30d} 件</b></div><ol>{sop.steps.map(step=><li key={step.action}><span>{step.order}</span><p><b>{step.label}</b>{step.instruction}</p></li>)}</ol><footer>{sop.automaticExecution?'允许自动执行':'建议推送，不自动送测或投广告'}</footer></article>})}{!loading&&!ready.length?<p className="empty-state">当前没有满足全部 Gate 的新品候选。</p>:null}</div>
    </section>
    <section className="sop-lane blocked">
      <div className="section-head"><div><span>BLOCKED BY GATES</span><h2>待补条件</h2></div><b>{blocked.length} 个候选</b></div>
      <div className="sop-blocked-list">{blocked.map(item=>{const sop=item.newProductSop!;return <article className="card" key={`${item.supplierPartNumber}:${item.marketContext?.country||''}:blocked`}><div><span>{item.catalogItemStatus||'状态未知'}</span><h3>{item.supplierPartNumber}</h3><small>{item.class?.className||'未分类'} · {item.marketContext?.country||'-'}</small></div><ul>{sop.blockers.map(blocker=><li key={blocker}>{blocker}</li>)}</ul></article>})}{!loading&&!blocked.length?<p className="empty-state">没有被 Gate 阻断的新品候选。</p>:null}</div>
    </section>
  </div>;
}

function SkuOperatingPerformance() {
  const retained=readClientCache<ProductOperatingAudit>('product-operating-audit:2026-07-27.v2',CLIENT_CACHE_RETENTION_MS);
  const [audit,setAudit]=useState<ProductOperatingAudit|null>(retained);
  const [auditError,setAuditError]=useState('');
  const [query,setQuery]=useState('');
  const [tier,setTier]=useState('ALL');
  const [category,setCategory]=useState('ALL');
  const [sort,setSort]=useState<SortState>({key:'revenue',direction:'desc'});
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/products/operating-audit',{signal:controller.signal})
      .then(async response=>{const body=await response.json() as ProductOperatingAudit&{error?:string};if(!response.ok)throw new Error(body.error||'产品运营审计读取失败');return body;})
      .then(body=>{setAudit(body);writeClientCache('product-operating-audit:2026-07-27.v2',body);})
      .catch(reason=>{if(reason.name!=='AbortError')setAuditError(reason.message||'产品运营审计读取失败');});
    return()=>controller.abort();
  },[]);
  const categories=Array.from(new Set(LEGACY_OPERATING_DATA.skus.map(item=>item["Class Name"]).filter(Boolean))).sort();
  const needle=query.trim().toLowerCase();
  const roleRows=(audit?.roles||[]).filter(row=>(tier==='ALL'||row.tier===tier)&&(!needle||[row.listing,row.tier,row.role,...row.parts,...row.conflictParts].some(value=>String(value||'').toLowerCase().includes(needle))));
  const legacyRows=sortRows(LEGACY_OPERATING_DATA.skus.filter(item=>(category==='ALL'||item["Class Name"]===category)&&(!needle||[item["Wayfair Sku"],item["Supplier Part Number"],item["Product Name"],item.cn_name].some(value=>String(value||'').toLowerCase().includes(needle)))),sort,{sku:(item:LegacySku)=>item["Wayfair Sku"],name:(item:LegacySku)=>item.cn_name||item["Product Name"],category:(item:LegacySku)=>item["Class Name"],grade:(item:LegacySku)=>item.grade,revenue:(item:LegacySku)=>item["Total Revenue"],cvr:(item:LegacySku)=>item.CVR,sessions:(item:LegacySku)=>item.Sessions,rating:(item:LegacySku)=>item.rating,tag:(item:LegacySku)=>item.tag_pct,wsc:(item:LegacySku)=>item.wsc,cogs:(item:LegacySku)=>item.cogs,margin:(item:LegacySku)=>item.my_margin,space:(item:LegacySku)=>item.wf_space}) as LegacySku[];
  const onSort=(field:string)=>setSort(value=>nextSort(value,field) as SortState);
  const june=audit?.account.find(row=>row.period==='Jun');
  const july=audit?.account.find(row=>row.period==='Jul26');
  const dailyRevenueDelta=june&&july?july.revenuePerDay/june.revenuePerDay-1:null;
  const dailyContributionDelta=june&&july?july.contributionPerDay/june.contributionPerDay-1:null;
  return <div className="product-audit-workspace">
    <section className="card product-audit-summary">
      <div className="section-head"><div><span>父体 LISTING 运营角色 · 不授权动作</span><h2>当前运营角色与利润审计</h2></div><b>{audit?.version||'读取中'}</b></div>
      {auditError?<p className="inventory-message bad">{auditError}</p>:null}
      <div className="product-audit-meta">
        <span><b>指标完整截止</b>{audit?.performanceThrough||'—'}</span>
        <span><b>角色证据截止</b>{audit?.roleEvidenceThrough||'—'}</span>
        <span><b>角色版本</b>{audit?.version||'—'}</span>
        <span><b>成本更新时间</b>{audit?.costUpdatedAt?new Date(audit.costUpdatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'—'}</span>
        <span><b>审核负责人</b>{audit?.review.owner||'—'}</span>
      </div>
      <div className="product-audit-account">
        <article><small>采购价差毛利率</small><b>{july?`${(july.procurementMargin*100).toFixed(2)}%`:'—'}</b><span>6月 {june?`${(june.procurementMargin*100).toFixed(2)}%`:'—'}</span></article>
        <article><small>日均收入</small><b>{july?money(july.revenuePerDay):'—'}</b><span>{dailyRevenueDelta==null?'—':`${(dailyRevenueDelta*100).toFixed(1)}% vs 6月`}</span></article>
        <article><small>日均已知费用后贡献代理</small><b>{july?money(july.contributionPerDay):'—'}</b><span>{dailyContributionDelta==null?'—':`${(dailyContributionDelta*100).toFixed(1)}% vs 6月`}</span></article>
        <article><small>成熟广告覆盖缺口</small><b>{audit?money(audit.adCoverage.unallocatedSpend):'—'}</b><span>{audit?`${(audit.adCoverage.listingCoverageRate*100).toFixed(1)}% 已分到 Listing`:'—'}</span></article>
      </div>
      <div className="product-audit-contract"><b>只读动作约束</b><p>{audit?.executionRule||'G4 默认 HOLD；审计视图不生成任何执行动作。'}</p><small>{audit?.profitDefinition||'采购价差毛利及已知费用后贡献上限不是净利润。'}</small></div>
    </section>
    <section className="card product-audit-card">
      <div className="legacy-filters"><label>搜索<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Listing、Part 或运营角色"/></label><label>角色层级<select value={tier} onChange={event=>setTier(event.target.value)}><option value="ALL">全部角色</option>{['G1','G2','G3','G4-D','G4-R','GX'].map(value=><option value={value} key={value}>{value}</option>)}</select></label></div>
      <div className="product-audit-table"><div className="product-audit-row head"><span>Listing / Part</span><span>运营角色</span><span>动作约束</span><span>成熟证据</span><span>采购价差毛利</span><span>Listing广告</span><span>已知费用后贡献上限</span><span>运营说明</span></div>
        {roleRows.map(row=><article className={`product-audit-row ${row.tier==='GX'?'isolated':''}`} key={row.listing}>
          <span><b>{row.listing}</b><small>{row.parts.length?row.parts.join(' / '):'未绑定 Part（隔离）'}</small>{row.conflictParts.length?<em>冲突候选，不归属：{row.conflictParts.join(' / ')}</em>:null}</span>
          <span><i className={`product-audit-tier tier-${row.tier.replace(/[^a-z0-9]/gi,'').toLowerCase()}`}>{row.tier}</i><b>{row.role}</b><small>置信度 {row.confidence}</small></span>
          <span><strong className={row.actionGuardrail==='HARD_STOP_REQUIRED'?'bad':'neutral'}>{row.actionGuardrail}</strong><small>平台状态 {row.platformStatus}</small><small>最近执行结果 {row.lastExecutionResult||'无'}</small></span>
          <span><b>{row.mature56Units} 件 / 56日</b><small>{row.julyVsJuneDaily==null?'动量 N/A':`7月日销 ${(row.julyVsJuneDaily*100).toFixed(1)}%`}</small><small>{audit?.matureWindow.start} → {audit?.matureWindow.end} · T-14成熟</small></span>
          <span><b>{row.matureMargin==null?'N/A':`${(row.matureMargin*100).toFixed(1)}%`}</b><small>未扣退货/物流/扣款/活动费</small></span>
          <span><b>{row.listingAdSpend>0&&row.listingRoas!=null?`${row.listingRoas.toFixed(2)}×`:'N/A'}</b><small>保本 {row.breakEvenRoas==null?'N/A':`${row.breakEvenRoas.toFixed(2)}×`}</small><em>广告覆盖缺口 {audit?money(audit.adCoverage.unallocatedSpend):'—'}</em></span>
          <span className={row.knownContributionUpperBound<0?'bad':'good'}><b>{money(row.knownContributionUpperBound)}</b><small>非净利润 · 非广告增量利润</small></span>
          <span><p>{row.operatorNote}</p><small>角色证据截止 {audit?.roleEvidenceThrough||'—'} · 成本 {audit?.costUpdatedAt?.slice(0,10)||'—'}</small></span>
        </article>)}
        {!audit&&!auditError?<p className="empty-state">正在读取产品运营审计…</p>:null}
        {audit&&!roleRows.length?<p className="empty-state">没有符合筛选条件的父体 Listing。</p>:null}
      </div>
    </section>
    <details className="card legacy-data-card">
      <summary><span>历史基线 · 仅作证据</span><b>2026-06旧收入层级 · 旧 A/B/C/D 不用于当前动作</b><small>DRCI1007 曾为 A 级，但因平台合并仍属于永久剔除，证明旧收入层级不能作为动作授权。</small></summary>
      <div className="section-head"><div><span>2026-06旧收入层级</span><h2>历史 Part 经营表现</h2></div><b>{legacyRows.length} / {LEGACY_OPERATING_DATA.skus.length} 个 Part</b></div>
      <div className="legacy-filters"><label>类目<select value={category} onChange={event=>setCategory(event.target.value)}><option value="ALL">全部类目</option>{categories.map(item=><option value={item} key={item}>{item}</option>)}</select></label></div>
      <div className="legacy-table-scroll"><div className="legacy-table sku-economics-table"><div className="legacy-row head"><SortHeader label="产品 / Part" field="sku" sort={sort} onSort={onSort}/><SortHeader label="中文名" field="name" sort={sort} onSort={onSort}/><SortHeader label="类目" field="category" sort={sort} onSort={onSort}/><SortHeader label="旧收入层级" field="grade" sort={sort} onSort={onSort}/><SortHeader label="营收" field="revenue" sort={sort} onSort={onSort}/><SortHeader label="CVR · 访问" field="cvr" sort={sort} onSort={onSort}/><SortHeader label="评分 · 评论" field="rating" sort={sort} onSort={onSort}/><SortHeader label="Tag%" field="tag" sort={sort} onSort={onSort}/><SortHeader label="WSC" field="wsc" sort={sort} onSort={onSort}/><SortHeader label="旧拿货成本" field="cogs" sort={sort} onSort={onSort}/><SortHeader label="旧毛利率" field="margin" sort={sort} onSort={onSort}/><SortHeader label="空间" field="space" sort={sort} onSort={onSort}/></div>{legacyRows.map((item,index)=><article className="legacy-row" key={`${item["Supplier Part Number"]}:${index}`}><span><b>{item["Wayfair Sku"]}</b><small>{item["Supplier Part Number"]}</small></span><span><b>{item.cn_name||'—'}</b><small>{item["Product Name"]}</small></span><span>{item["Class Name"]}</span><em>{item.grade||'—'}</em><b>{money(item["Total Revenue"])}</b><span><b>{(item.CVR*100).toFixed(2)}%</b><small>{item.Sessions} 访</small></span><span><b>{item.rating||'—'}</b><small>{item.review_count||0} 条</small></span><b>{item.tag_pct.toFixed(0)}%</b><b>{money2(item.wsc)}</b><b>{money2(item.cogs)}</b><span><b>{(item.my_margin*100).toFixed(1)}%</b><small>{money2(item.my_profit)}</small></span><b>{(item.wf_space*100).toFixed(0)}%</b></article>)}</div></div>
    </details>
  </div>;
}

function MonthlyOperatingHistory() {
  const monthlyByNumber=new Map(LEGACY_OPERATING_DATA.acct_monthly.map(item=>[item.m,item]));
  const rows=LEGACY_OPERATING_DATA.trend.months.map((month,index)=>{const revenue=LEGACY_OPERATING_DATA.trend.revenue[index];const orders=LEGACY_OPERATING_DATA.trend.orders[index];const sessions=LEGACY_OPERATING_DATA.trend.sessions[index];const cvr=LEGACY_OPERATING_DATA.trend.cvr[index];const spend=LEGACY_OPERATING_DATA.trend.sp_spend[index];return{month:month.replace('_','-'),revenue,orders,sessions,cvr,spend,aov:revenue&&orders?revenue/orders:null,tacos:revenue&&spend?spend/revenue:null};});
  return <div className="history-workspace"><section className="card legacy-data-card"><div className="section-head"><div><span>2025-06 → 2026-06</span><h2>13 个月账户全景</h2></div><b>{LEGACY_OPERATING_DATA.meta.store}</b></div><div className="legacy-table-scroll"><div className="legacy-table monthly-table"><div className="legacy-row head"><span>月份</span><span>营收</span><span>订单</span><span>Sessions</span><span>CVR</span><span>AOV</span><span>广告花费</span><span>TACoS</span></div>{rows.map(row=><article className="legacy-row" key={row.month}><b>{row.month}</b><b>{row.revenue==null?'—':money(row.revenue)}</b><b>{row.orders??'—'}</b><b>{row.sessions??'—'}</b><b>{row.cvr==null?'—':`${(row.cvr*100).toFixed(1)}%`}</b><b>{row.aov==null?'—':money(row.aov)}</b><b>{row.spend==null?'—':money(row.spend)}</b><b className={(row.tacos||0)>.2?'bad':'good'}>{row.tacos==null?'—':`${(row.tacos*100).toFixed(1)}%`}</b></article>)}</div></div></section><section className="card legacy-data-card"><div className="section-head"><div><span>广告归因订单 / 总订单</span><h2>广告依赖度 · 2026年1–6月</h2></div><b>健康区 25–40%</b></div><div className="legacy-table-scroll"><div className="legacy-table dependency-table"><div className="legacy-row head"><span>月份</span><span>总订单</span><span>广告归因单</span><span>依赖度（上限）</span><span>广告花费</span><span>TACoS</span></div>{Array.from(monthlyByNumber.values()).map(row=>{const dependency=row.orders?row.ad_orders/row.orders:0;const tacos=row.rev?row.spend/row.rev:0;return <article className="legacy-row" key={row.m}><b>2026-{String(row.m).padStart(2,'0')}</b><b>{row.orders}</b><b>{row.ad_orders}</b><b className={dependency>.4?'bad':'good'}>{(dependency*100).toFixed(0)}%</b><b>{money(row.spend)}</b><b className={tacos>.2?'bad':'good'}>{(tacos*100).toFixed(1)}%</b></article>})}</div></div></section></div>;
}

function PlanningWorkspace({ tab, onTabChange }: { tab: PlanningTab; onTabChange: (tab: PlanningTab) => void }) {
  const [planSection,setPlanSection]=useState<PlanSection>('july');
  function openPlanSection(section:PlanSection){setPlanSection(section);onTabChange(section==='august'?'august':'plan');}
  return <><Hero eyebrow="" title={tab==='august'?'8月推广计划':tab==='plan'?'运营计划':tab==='history'?'历史月度':'复盘资料'} text="" />
    {tab==='august'?<Plan embedded tab="august" onTabChange={openPlanSection} onOpenReview={()=>onTabChange('review')}/>:tab==='plan'?<Plan embedded tab={planSection} onTabChange={openPlanSection} onOpenReview={()=>onTabChange('review')}/>:tab==='history'?<MonthlyOperatingHistory/>:<Review embedded onOpenPlan={openPlanSection}/>}
  </>;
}

function ProductWorkspace({ tab }: { tab: ProductTab }) {
  return <><Hero eyebrow="" title={tab==='inventory'?'库存更新':tab==='launch'?'推新 SOP':tab==='performance'?'SKU 经营':'商品数据'} text="" />
    {tab==='inventory'?<Inventory embedded/>:tab==='launch'?<NewProductSopWorkspace/>:tab==='performance'?<SkuOperatingPerformance/>:<Catalog embedded/>}
  </>;
}

const OPERATION_STATUS_LABELS:Record<string,string>={
  DISCOVERED:'待分派',ASSIGNED:'已分派',PENDING_APPROVAL:'待审批',PREFLIGHTED:'已预检',
  EXECUTING:'执行中',PENDING_ACCEPTANCE:'待验收',VERIFIED:'已验证',
  PENDING_REVIEW:'待复盘',CLOSED:'已闭环',FAILED:'失败',ROLLED_BACK:'已回滚',REOPENED:'已重开',
};

function TaskCenter() {
  const [records,setRecords]=useState<OperationRecord[]>([]);
  const [status,setStatus]=useState('ACTIVE');
  const [query,setQuery]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/operations/',{signal:controller.signal})
      .then(async response=>{const body=await response.json() as {records?:OperationRecord[];error?:string};if(!response.ok)throw new Error(body.error||'闭环任务读取失败');return body.records||[];})
      .then(setRecords)
      .catch(reason=>{if(reason.name!=='AbortError')setError(reason.message||'闭环任务读取失败');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[]);
  const needle=query.trim().toLowerCase();
  const visible=records.filter(record=>(status==='ALL'||(status==='ACTIVE'?!['CLOSED','ROLLED_BACK'].includes(record.status):record.status===status))&&(!needle||[record.title,record.objectId,record.owner,record.sourceType].some(value=>String(value||'').toLowerCase().includes(needle))));
  const pendingAcceptance=records.filter(record=>record.status==='PENDING_ACCEPTANCE').length;
  const pendingReview=records.filter(record=>record.status==='PENDING_REVIEW').length;
  const closed=records.filter(record=>record.status==='CLOSED').length;
  return <><Hero eyebrow="" title="闭环任务" text="" />
    <section className="card task-center-summary"><div><span>统一任务账本</span><h2>从发现到验收与复盘</h2><p>所有新动作都通过 operation ID 关联业务对象、负责人、证据、验收和复盘；复选框不再代表完成。</p></div><article><small>待验收</small><b>{pendingAcceptance}</b></article><article><small>待复盘</small><b>{pendingReview}</b></article><article><small>已闭环</small><b>{closed}</b></article></section>
    <section className="card task-center-board">
      <div className="task-center-tools"><label>搜索<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="对象、负责人或任务"/></label><label>状态<select value={status} onChange={event=>setStatus(event.target.value)}><option value="ACTIVE">全部未闭环</option><option value="ALL">全部</option>{Object.entries(OPERATION_STATUS_LABELS).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><b>{visible.length} 条</b></div>
      {error?<p className="inventory-message bad">{error}</p>:null}
      <div className="task-center-list">{visible.map(record=><article className="task-card" key={record.operationId}><header><span className={`operation-status status-${record.status.toLowerCase()}`}>{OPERATION_STATUS_LABELS[record.status]||record.status}</span><b>{record.title}</b><time>{new Date(record.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</time></header><div className="task-card-grid"><span><small>业务对象</small><b>{record.objectType} · {record.objectId}</b></span><span><small>负责人</small><b>{record.owner}</b></span><span><small>来源</small><b>{record.sourceType}</b></span><span><small>Operation ID</small><b>{record.operationId}</b></span></div><p><b>下一动作：</b>{record.proposedAction}</p>{record.executionResult?<p><b>执行结果：</b>{record.executionResult}</p>:null}<footer><span>证据 {record.evidence?.length||0} 项</span><span>验收人 {record.acceptedBy||'待补充'}</span><span>复盘 {record.reviewVerdict||record.reviewDueAt||'待安排'}</span></footer></article>)}{!loading&&!visible.length?<p className="empty-state">当前筛选没有任务。执行或记录第一项动作后会进入统一账本。</p>:null}{loading?<p className="empty-state">正在读取统一任务账本…</p>:null}</div>
    </section>
  </>;
}

function Sources() {
  const retained=readClientCache<SystemReadiness>('system:readiness',CLIENT_CACHE_RETENTION_MS);
  const [data,setData]=useState<SystemReadiness|null>(retained);
  const [error,setError]=useState('');
  useEffect(()=>{const fresh=readClientCache<SystemReadiness>('system:readiness');const controller=new AbortController();if(fresh){queueMicrotask(()=>setData(fresh));return()=>controller.abort();}fetch('/api/system/readiness',{signal:controller.signal}).then(async response=>{const body=await response.json() as SystemReadiness&{error?:string};if(!response.ok)throw new Error(body.error||'数据就绪状态读取失败');return body;}).then(body=>{setData(body);writeClientCache('system:readiness',body);}).catch(reason=>{if(reason.name!=='AbortError')setError(reason.message||'数据就绪状态读取失败');});return()=>controller.abort();},[]);
  return <><Hero eyebrow="DATA SOURCES · PERMISSION CONTROL" title="数据源" text="连接状态来自当前运行环境；未验证时不会显示为生产可用" />
    <section className="card readiness-banner"><div><span>运行环境</span><b>{data?`${data.environment.platform} / ${data.environment.name}`:'检查中'}</b><small>{data?.environment.verified?'生产环境已验证':'未通过生产环境验证'}</small></div><div><span>Supplier 身份</span><b>{data?.identity.verified?'已核对':'未核对'}</b><small>{data?.identity.expectedSupplierIds.length?data.identity.expectedSupplierIds.join(' / '):'未配置允许清单'}</small></div><div><span>正式写入</span><b>{data?.live.ads.allowed&&data?.live.inventory.allowed?'已解锁':'默认锁定'}</b><small>广告与库存分别受独立开关保护</small></div><div><span>Scope Health</span><b>{data?.scopeHealth?`${data.scopeHealth.summary.healthy} 正常 · ${data.scopeHealth.summary.failed} 失败`:'等待新证据'}</b><small>依据最近真实 API 调用，不展示密钥</small></div></section>
    <section className="production-lock-grid"><article className={`card production-lock ${data?.live.ads.allowed?'unlocked':'locked'}`}><span>广告生产锁</span><b>{data?.live.ads.allowed?'生产锁已解除':'保持锁定'}</b>{data?.live.ads.allowed?<p>身份、凭证、环境与正式写入开关均已通过。</p>:<ul>{(data?.live.ads.blockers||['正在读取锁定原因']).map(item=><li key={item}>{item}</li>)}</ul>}</article><article className={`card production-lock ${data?.live.inventory.allowed?'unlocked':'locked'}`}><span>库存生产锁</span><b>{data?.live.inventory.allowed?'生产锁已解除':'保持锁定'}</b>{data?.live.inventory.allowed?<p>身份、凭证、环境与正式写入开关均已通过。</p>:<ul>{(data?.live.inventory.blockers||['正在读取锁定原因']).map(item=><li key={item}>{item}</li>)}</ul>}</article></section>
    {error?<p className="inventory-message bad">{error}</p>:null}<div className="source-grid">{(data?.sources||[]).map(source=><article className="card source-card" key={source.id}><span className={source.status==='ready'?'connected':'waiting'}>{source.status==='ready'?'已就绪':'已阻止'}</span><h2>{source.name}</h2><p>{source.detail}</p><small>{source.scope}</small></article>)}</div>
    <section className="card metric-registry"><div className="section-head"><div><span>API SCOPE REGISTRY</span><h2>权限调用健康</h2></div><b>{data?.scopeHealth?.sources.filter(source=>source.status==='healthy').length||0} / {data?.scopeHealth?.sources.length||0} 项有新鲜证据</b></div><div>{(data?.scopeHealth?.sources||[]).map(source=><article key={source.id}><span><b>{source.app}</b><small>{source.permission}</small></span><p>{source.detail}</p><em>{source.lastSuccessAt?`最近成功 ${new Date(source.lastSuccessAt).toLocaleString('zh-CN')}`:source.status}</em></article>)}</div></section>
    <section className="card metric-registry"><div className="section-head"><div><span>METRIC CONTRACT</span><h2>指标口径与来源</h2></div><b>{data?.metrics.length||0} 项已登记</b></div><div>{(data?.metrics||[]).map(metric=><article key={metric.id}><span><b>{metric.label}</b><small>{metric.unit} · {metric.grain}</small></span><p>{metric.definition}</p><em>{metric.source}</em></article>)}</div></section></>;
}

function Help() {
  return <><Hero eyebrow="" title="帮助" text="" />
    <div className="help-grid">
      <section className="card help-section"><h2>广告优化</h2><dl><div><dt>双窗口</dt><dd>T-14 成熟周负责效果评估；最近4个完整日负责高花费零单止损，最近7日盈利信号防止误停。</dd></div><div><dt>建议依据</dt><dd>历史表现、SKU 利润、链接质量、库存覆盖和月度计划共同判断。</dd></div><div><dt>执行范围</dt><dd>只有 Bid 与 Listing 启停进入受控 API 批次；Campaign Cap、tROAS、关键词和否词仍由人工执行。</dd></div></dl></section>
      <section className="card help-section"><h2>数据与缓存</h2><dl><div><dt>订单与库存</dt><dd>共用 Ops 应用。订单只读，库存经过校验和预检后写入。</dd></div><div><dt>广告数据</dt><dd>日级报表和每周决策快照保存到数据库，切换页面不会重复拉取。</dd></div><div><dt>复盘资料</dt><dd>原始 HTML、PDF 和 XLSX 保存在资料库，页面提供完整阅读与下载。</dd></div></dl></section>
      <section className="card help-section"><h2>写入安全</h2><dl><div><dt>人工确认</dt><dd>广告和库存的生产写入都需要明确确认。</dd></div><div><dt>预检</dt><dd>正式写入前先执行 Dry-run，校验载荷、权限和当前值。</dd></div><div><dt>审计与重试</dt><dd>保存修改前值、建议值、结果和失败原因。失败项可重新确认和执行。</dd></div></dl></section>
      <section className="card help-section"><h2>口径</h2><dl><div><dt>广告后贡献</dt><dd>广告前商品毛利扣除已同步的广告花费。广告数据未覆盖时不显示为实际利润。</dd></div><div><dt>成熟归因</dt><dd>最近 7 天和 14 天可用于观察。只有成熟周期用于自动调整建议。</dd></div><div><dt>计划联动</dt><dd>7 月目标、活动节奏和 8 月计划分别保存，不跨月混用目标口径。</dd></div></dl></section>
    </div>
  </>;
}

export default function OpsCenter() {
  const [view,setView]=useState<View>('dashboard');
  const [adsTab,setAdsTab]=useState<AdsTab>('manager');
  const [planningTab,setPlanningTab]=useState<PlanningTab>('plan');
  const [productTab,setProductTab]=useState<ProductTab>('inventory');
  useEffect(()=>{
    function restoreNavigation(){
      const state=navigationStateFromSearch(window.location.search);
      setView(state.view as View);
      if(state.view==='planning'&&state.tab)setPlanningTab(state.tab as PlanningTab);
      if(state.view==='ads'&&state.tab)setAdsTab(state.tab as AdsTab);
      if(state.view==='products'&&state.tab)setProductTab(state.tab as ProductTab);
    }
    restoreNavigation();
    window.addEventListener('popstate',restoreNavigation);
    return()=>window.removeEventListener('popstate',restoreNavigation);
  },[]);
  useEffect(()=>{window.scrollTo(0,0);const frame=requestAnimationFrame(()=>window.scrollTo(0,0));return()=>cancelAnimationFrame(frame);},[view]);
  const activeSub: SubView | null=view==='ads'?adsTab:view==='planning'?planningTab:view==='products'?productTab:null;
  function updateLocation(nextView:View,nextTab:SubView|null=null){window.history.pushState({},'',navigationSearch({view:nextView,tab:nextTab}));}
  function navigateView(next:View){setView(next);const nextTab=next==='ads'?adsTab:next==='planning'?planningTab:next==='products'?productTab:null;updateLocation(next,nextTab);}
  function navigateSub(next:SubView){
    if(view==='ads'&&(next==='manager'||next==='listings'||next==='ai'||next==='manual'||next==='review'))setAdsTab(next);
    if(view==='planning'&&(next==='plan'||next==='august'||next==='review'||next==='history'))setPlanningTab(next);
    if(view==='products'&&(next==='inventory'||next==='catalog'||next==='launch'||next==='performance'))setProductTab(next);
    updateLocation(view,next);
  }
  const page=({dashboard:<Dashboard/>,tasks:<TaskCenter/>,daily:<Daily/>,ads:<Ads tab={adsTab}/>,planning:<PlanningWorkspace tab={planningTab} onTabChange={navigateSub}/>,products:<ProductWorkspace tab={productTab}/>,sources:<Sources/>,help:<Help/>})[view];
  return <div className="app app-shell"><ShellHeader active={view} activeSub={activeSub} onNavigate={navigateView} onSubNavigate={navigateSub}/><div className="content-shell"><main>{page}</main><footer><span>Wayfair AI 运营中台</span><span>个人测试阶段</span></footer></div></div>;
}
