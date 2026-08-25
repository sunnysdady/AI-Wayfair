import type { Metadata } from "next";

import AssistantWorkspace from "./workspace";

export const metadata: Metadata = {
  title: "AI 助理 · Wayfair AI",
  description: "以对话方式分析已同步的 Wayfair 运营数据。",
};

export default function AssistantPage() {
  return <AssistantWorkspace />;
}
