import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = {
  title: "Ozon 推广定时开关",
  description: "为 Ozon 店铺设置每天的投放时段，到点自动开启和关闭「按订单付款」推广",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
