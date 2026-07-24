import type { Metadata } from "next";
import OpsCenter from "./OpsCenter";

export const metadata: Metadata = {
  title: "Wayfair AI 运营中台",
  description: "连接日报、库存、广告优化与月度复盘的 Wayfair 运营工作台。",
};

export default function Home() {
  return <OpsCenter />;
}
