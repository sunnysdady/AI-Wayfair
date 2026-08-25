const AMAZON_OPS_METHODOLOGY = [
  "先说明结论，再列出支撑结论的数据证据与仍缺失的数据。",
  "按紧急程度排序：优先处理会扩大损失、影响履约或阻塞销售的问题；再处理增长机会。",
  "一次只调整一个关键变量，并为每项建议写明观察期，避免把相关性误判为因果。",
  "将已执行动作的结果记录为有效、无效或待观察，供后续相同问题复盘使用。",
  "没有数据支撑时，明确说明不能确认，并提出下一步需要查询的字段或时间范围。",
];

export function assistantExperienceContext() {
  return [
    "跨平台运营方法论（源自本地 Amazon Ops 项目的通用经验）：",
    ...AMAZON_OPS_METHODOLOGY.map((item, index) => `${index + 1}. ${item}`),
    "这些方法论仅用于组织分析和建议，不能当作 Wayfair 业务事实或阈值；Wayfair 的结论必须以本次数据库上下文为准。",
  ].join("\n");
}
