import type { Metadata } from "next";

import AssistantWorkspace from "./workspace";

export const metadata: Metadata = {
  title: "运营数据助理 · Wayfair AI",
  description: "从已同步的 Wayfair 运营数据中安全检索 SKU、订单、库存、广告和报告。",
};

export default function AssistantPage() {
  return <AssistantWorkspace />;
}
