import React, { useEffect, useState } from "react";
import { CaretRightIcon, ReceiptIcon } from "@phosphor-icons/react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";

import { db } from "../../../firebase";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import PaySlipModal from "../modals/PaySlipModal";

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatSlipDate(paySlip) {
  const date = toDate(paySlip?.createdAt || paySlip?.generatedAt);
  if (!date) return "";
  return `${date.getMonth() + 1}월 ${date.getDate()}일 지급`;
}

function getSlipTitle(paySlip) {
  if (paySlip?.slipType === "bonus") return "특별 급여 명세서";
  return paySlip?.paymentPeriodDescription || "급여 명세서";
}

function getSlipAmount(paySlip) {
  return Number(
    paySlip?.totals?.netSalary ??
      paySlip?.totals?.totalBonusAmount ??
      paySlip?.netSalary ??
      0,
  );
}

/**
 * 대시보드 상단에 고정으로 보이는 최근 급여 명세 카드.
 * 가장 최근 명세서 1건을 요약해 보여주고, 누르면 명세서 상세 창을 연다.
 */
const HomePayslipCard = ({ classId, userData, currencyUnit }) => {
  const studentUid = userData?.uid || null;
  const { formatClassCurrency } = useNumberFormat();
  const [latestSlip, setLatestSlip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (!classId || !studentUid) {
      setLatestSlip(null);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);

    const loadLatestSlip = async () => {
      try {
        const paySlipsRef = collection(
          db,
          "classes",
          classId,
          "students",
          studentUid,
          "paySlips",
        );
        const snapshot = await getDocs(
          query(paySlipsRef, orderBy("createdAt", "desc"), limit(1)),
        );
        if (cancelled) return;
        const first = snapshot.docs[0];
        setLatestSlip(first ? { id: first.id, ...first.data() } : null);
      } catch (error) {
        if (cancelled) return;
        console.error("[HomePayslipCard] 급여 명세 조회 오류:", error);
        setLatestSlip(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadLatestSlip();

    return () => {
      cancelled = true;
    };
  }, [classId, studentUid]);

  const hasSlip = Boolean(latestSlip);

  return (
    <>
      <section className="px-1 pb-4 sm:px-2" data-dashboard-card="payslip">
        <button
          type="button"
          disabled={!hasSlip}
          onClick={() => setIsModalOpen(true)}
          className="flex w-full items-center gap-3 rounded-[1.5rem] bg-white px-4 py-4 text-left shadow-sm shadow-slate-200/60 transition-colors enabled:hover:bg-blue-50/60 disabled:cursor-default sm:gap-4 sm:px-6"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
            <ReceiptIcon size={23} />
          </span>

          <span className="min-w-0 flex-1">
            <small className="block text-[11px] font-black tracking-[0.12em] text-blue-500">
              최근 급여 명세
            </small>
            {loading ? (
              <span className="mt-1 block h-5 w-40 animate-pulse rounded-md bg-slate-200/80" />
            ) : hasSlip ? (
              <>
                <strong className="mt-0.5 block truncate text-base font-black text-slate-900">
                  {getSlipTitle(latestSlip)}
                </strong>
                <small className="block truncate text-xs font-medium text-slate-400">
                  {formatSlipDate(latestSlip)}
                </small>
              </>
            ) : (
              <strong className="mt-0.5 block text-sm font-bold text-slate-400">
                아직 받은 급여 명세서가 없습니다.
              </strong>
            )}
          </span>

          {!loading && hasSlip ? (
            <span className="flex shrink-0 items-center gap-1 text-right">
              <span>
                <strong className="block text-lg font-black text-blue-600 sm:text-xl">
                  {formatClassCurrency(getSlipAmount(latestSlip))}
                  <em className="ml-1 text-sm font-bold not-italic text-blue-400">
                    {currencyUnit}
                  </em>
                </strong>
                <small className="block text-[11px] font-bold text-slate-400">
                  실수령액 · 명세서 보기
                </small>
              </span>
              <CaretRightIcon size={18} className="text-slate-300" />
            </span>
          ) : null}
        </button>
      </section>

      <PaySlipModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        employeeData={userData}
        initialPaySlipId={latestSlip?.id || null}
      />
    </>
  );
};

export default HomePayslipCard;
