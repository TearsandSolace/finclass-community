import React from "react";
import { useNavigate } from "react-router-dom";
import { BankIcon, HouseLineIcon, ReceiptIcon, CaretRightIcon } from "@phosphor-icons/react";

import { useNotifications } from "../../../contexts/NotificationContext";

// 학생이 직접 처리해야 하는 일. 수는 사이드바 빨간 점과 같은 알림 집계를 쓴다.
const ACTION_ALERTS = [
  {
    key: "realestate",
    path: "/realestate",
    icon: HouseLineIcon,
    title: "임대료·보증금을 내야 해요!",
    describe: (count) => `내야 할 임대료나 보증금이 ${count}건 있어요. 늦으면 연체돼요.`,
    tone: "bg-rose-50 text-rose-900 ring-rose-200",
    iconTone: "bg-rose-100 text-rose-600",
  },
  {
    key: "tax",
    path: "/tax",
    icon: ReceiptIcon,
    title: "세금 고지서가 있어요!",
    describe: (count) => `아직 내지 않은 고지서가 ${count}건 있어요.`,
    tone: "bg-amber-50 text-amber-900 ring-amber-200",
    iconTone: "bg-amber-100 text-amber-600",
  },
  {
    key: "bank",
    path: "/bank",
    icon: BankIcon,
    title: "은행에서 확인할 일이 있어요",
    describe: (count) => `만기된 예금이나 곧 갚을 대출이 ${count}건 있어요.`,
    tone: "bg-blue-50 text-blue-900 ring-blue-200",
    iconTone: "bg-blue-100 text-blue-600",
  },
];

/**
 * 학생 대시보드 상단 알림. 처리할 일이 있을 때만 보인다.
 */
const HomeActionAlerts = () => {
  const navigate = useNavigate();
  const { actionBadges } = useNotifications() || {};

  const activeAlerts = ACTION_ALERTS.map((alert) => ({
    ...alert,
    count: Number(actionBadges?.[alert.key] || 0),
  })).filter((alert) => alert.count > 0);

  if (activeAlerts.length === 0) return null;

  return (
    <section className="space-y-2 px-1 pb-4 sm:px-2" aria-label="내가 처리할 일">
      {activeAlerts.map(({ key, path, icon: Icon, title, describe, count, tone, iconTone }) => (
        <button
          key={key}
          type="button"
          role="alert"
          onClick={() => navigate(path)}
          className={`flex w-full items-center gap-3 rounded-[1.25rem] px-4 py-3 text-left ring-1 transition hover:brightness-[0.98] sm:px-5 ${tone}`}
        >
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconTone}`}>
            <Icon size={22} weight="bold" />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block text-base font-black">{title}</strong>
            <small className="block text-xs font-semibold opacity-80">{describe(count)}</small>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs font-black opacity-80">
            바로 가기
            <CaretRightIcon size={16} weight="bold" />
          </span>
        </button>
      ))}
    </section>
  );
};

export default HomeActionAlerts;
