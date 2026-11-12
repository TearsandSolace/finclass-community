"use strict";

const { calculateCumulativeRentAmount, calculateUnusedPrepaidRent } = require("./rentContractPolicy");

// 이만큼(4주) 이상 임대료를 낸 임차인은 자리를 바꿀 때 남은 자투리 미납을 소멸시킨다.
const SEAT_CHANGE_FORGIVE_MIN_PAID_DAYS = 28;

const toWholeNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
};

/**
 * 자리를 바꿀 때 기존 임대 계약을 자동으로 정산하는 금액을 계산한다.
 *
 * 규칙
 * - 임대료를 4주치(28일) 이상 냈으면 남은 미납은 소멸한다.
 * - 4주치 미만이면 미납만큼 보증금에서 빼서 임대인 몫으로 두고, 그래도 모자란 미납은 소멸한다.
 * - 미리 냈는데 아직 안 지난 기간의 임대료는 임대인이 임차인에게 돌려준다.
 * - 남은 보증금은 임대인이 돌려준다. 임대인 현금이 모자라면 모자란 만큼 반환 대기로 남긴다.
 * - 국가 소유 자리(ownerCash === null)는 국가가 전액 돌려준다.
 */
const computeSeatChangeSettlement = ({
    weeklyRent = 0,
    paidDays = 0,
    paidAmount = 0,
    accruedDays = 0,
    depositOutstanding = 0,
    totalPaidTaxAmount = 0,
    ownerCash = null,
}) => {
    const rent = toWholeNumber(weeklyRent);
    const safePaidDays = toWholeNumber(paidDays);
    const safePaidAmount = toWholeNumber(paidAmount);
    const safeAccruedDays = toWholeNumber(accruedDays);
    const deposit = toWholeNumber(depositOutstanding);

    const accruedAmount = calculateCumulativeRentAmount(rent, safeAccruedDays);
    const unpaidAmount = Math.max(0, accruedAmount - safePaidAmount);
    const isLongTenancy = safePaidDays >= SEAT_CHANGE_FORGIVE_MIN_PAID_DAYS;
    const depositDeduction = isLongTenancy ? 0 : Math.min(unpaidAmount, deposit);
    const forgivenRentAmount = unpaidAmount - depositDeduction;

    const unusedRentAmount = calculateUnusedPrepaidRent({
        weeklyRent: rent,
        paidDays: safePaidDays,
        paidAmount: safePaidAmount,
        accruedDays: safeAccruedDays,
    });
    const isStateOwned = ownerCash === null || ownerCash === undefined;
    const paidTax = isStateOwned ? 0 : toWholeNumber(totalPaidTaxAmount);
    const unusedRentTaxAmount = safePaidAmount > 0
        ? Math.min(paidTax, Math.floor(paidTax * (unusedRentAmount / safePaidAmount)))
        : 0;
    // 임대인은 세금을 뺀 금액만 받았으므로 그만큼만 돌려주고, 세금 몫은 국고가 돌려준다.
    const ownerRentRefund = isStateOwned ? 0 : Math.max(0, unusedRentAmount - unusedRentTaxAmount);
    const depositRefundDue = deposit - depositDeduction;

    if (isStateOwned) {
        const tenantReceives = depositRefundDue + unusedRentAmount;
        return {
            accruedAmount, unpaidAmount, isLongTenancy, depositDeduction, forgivenRentAmount,
            unusedRentAmount, unusedRentTaxAmount, depositRefundDue,
            ownerDue: 0, ownerDebit: 0, tenantReceives,
            pendingDepositAmount: 0, stateCoveredAmount: tenantReceives,
        };
    }

    const ownerDue = depositRefundDue + ownerRentRefund;
    const ownerDebit = Math.min(toWholeNumber(ownerCash), ownerDue);
    const pendingDepositAmount = ownerDue - ownerDebit;
    const tenantReceives = ownerDebit + unusedRentTaxAmount;
    return {
        accruedAmount, unpaidAmount, isLongTenancy, depositDeduction, forgivenRentAmount,
        unusedRentAmount, unusedRentTaxAmount, depositRefundDue,
        ownerDue, ownerDebit, tenantReceives, pendingDepositAmount, stateCoveredAmount: 0,
    };
};


const DAY_MS = 24 * 60 * 60 * 1000;

// clearDeskRentContract(realestate.js)와 같은 필드를 비운다.
const CLEARED_RENT_FIELDS = Object.freeze({
    weeklyRent: 0,
    rentType: null,
    rentOpenEnded: null,
    rentContractId: null,
    rentStartAt: null,
    rentLastDateAt: null,
    rentTenantId: null,
    rentTenantName: null,
    rentPaidUntil: null,
    rentPaidDays: 0,
    rentPaidAmount: 0,
    rentPaidWithheldTaxAmount: 0,
    rentDepositAmount: 0,
    rentDepositStatus: "not_required",
    rentDepositPaidAmount: 0,
    rentDepositReturnedAmount: 0,
    rentDepositDeductedAmount: 0,
    rentDepositPaidAt: null,
    rentDepositReturnedAt: null,
    rentDepositSettlementReason: null,
    rentContractStatus: null,
    rentActivatedAt: null,
    rentInitialPaymentDays: 0,
    rentInitialPaymentAmount: 0,
});

const isClosedPendingReturnDesk = (desk = {}) => desk?.rentContractStatus === "closed";

const hasMovingTenantContract = (desk = {}) =>
    Boolean(desk?.rentContractId && desk?.rentTenantId && !isClosedPendingReturnDesk(desk));

/**
 * 자리 배치 저장 트랜잭션 안에서, 앉은 학생이 바뀌는 자리의 임대 계약을 자동 정산한다.
 * 모든 읽기를 먼저 한 뒤 쓰기를 하므로 다른 쓰기보다 먼저 호출해야 한다.
 * 반환값의 groups를 기존 배치 대신 mergeAssignments에 넘긴다.
 */
const stageSeatChangeRentSettlements = async ({
    transaction,
    db,
    classId,
    currentGroups,
    proposedGroups,
    actorUid,
    now = new Date(),
    deps,
}) => {
    const { FieldValue, Timestamp, startOfDayInKST, toDate, stageActivityLog, stageTaxExpense, logContext } = deps;
    const proposedStudentByDesk = new Map(
        (Array.isArray(proposedGroups) ? proposedGroups : [])
            .flatMap((group) => (Array.isArray(group?.desks) ? group.desks : []))
            .map((desk) => [desk?.id, desk?.studentId || null]),
    );
    const moving = [];
    (currentGroups || []).forEach((group, groupIndex) => {
        (group?.desks || []).forEach((desk, deskIndex) => {
            if (!proposedStudentByDesk.has(desk?.id)) return;
            const nextStudentId = proposedStudentByDesk.get(desk.id);
            if ((desk.studentId || null) === nextStudentId) return;
            if (!hasMovingTenantContract(desk)) return;
            moving.push({ groupIndex, deskIndex, desk });
        });
    });
    if (moving.length === 0) return { groups: currentGroups, settlements: [] };

    // 1) 읽기: 임차인·임대인 학생 문서
    const studentIds = new Set();
    moving.forEach(({ desk }) => {
        studentIds.add(String(desk.rentTenantId));
        if (desk.ownerId && desk.ownerType !== "classFund") studentIds.add(String(desk.ownerId));
    });
    const studentRefs = new Map([...studentIds].map((uid) => [uid, db.doc(`classes/${classId}/students/${uid}`)]));
    const snaps = await Promise.all([...studentRefs.values()].map((ref) => transaction.get(ref)));
    const cashByUid = new Map();
    [...studentRefs.keys()].forEach((uid, index) => {
        const snap = snaps[index];
        cashByUid.set(uid, snap.exists ? Math.max(0, Number(snap.data()?.assets?.cash || 0)) : null);
    });

    // 2) 계산과 쓰기
    const today = startOfDayInKST(now);
    const yesterday = new Date(today.getTime() - DAY_MS);
    const cashDelta = new Map();
    const addCash = (uid, amount) => {
        if (!uid || !amount) return;
        cashDelta.set(uid, (cashDelta.get(uid) || 0) + amount);
        cashByUid.set(uid, (cashByUid.get(uid) || 0) + amount);
    };
    const groups = currentGroups.map((group) => ({ ...group, desks: [...(group.desks || [])] }));
    const settlements = [];

    moving.forEach(({ groupIndex, deskIndex, desk }) => {
        const tenantUid = String(desk.rentTenantId);
        const deskLabel = desk.label || `${desk.number ?? "-"}번 자리`;
        const tenantExists = cashByUid.get(tenantUid) !== null;
        const paidDeposit = toWholeNumber(desk.rentDepositPaidAmount);
        const depositOutstanding = Math.max(
            0,
            paidDeposit - toWholeNumber(desk.rentDepositReturnedAmount) - toWholeNumber(desk.rentDepositDeductedAmount),
        );
        const isActive = desk.rentContractStatus === "active" || (!desk.rentContractStatus && depositOutstanding > 0);

        // 보증금을 아직 안 냈거나 임차인 계정이 없으면 돈 이동 없이 계약만 비운다.
        if (!isActive || !tenantExists) {
            groups[groupIndex].desks[deskIndex] = { ...desk, ...CLEARED_RENT_FIELDS };
            settlements.push({ deskId: desk.id, cleared: true });
            return;
        }

        const ownerUid = desk.ownerId && desk.ownerType !== "classFund" ? String(desk.ownerId) : null;
        const ownerCash = ownerUid ? (cashByUid.get(ownerUid) ?? 0) : null;
        const start = startOfDayInKST(toDate(desk.rentStartAt));
        const last = startOfDayInKST(toDate(desk.rentLastDateAt));
        const accrualEnd = last && last.getTime() < yesterday.getTime() ? last : yesterday;
        const accruedDays = start && accrualEnd.getTime() >= start.getTime()
            ? Math.floor((accrualEnd.getTime() - start.getTime()) / DAY_MS) + 1
            : 0;
        const result = computeSeatChangeSettlement({
            weeklyRent: desk.rentType === "jeonse" ? 0 : desk.weeklyRent || desk.rentPrice,
            paidDays: desk.rentPaidDays,
            paidAmount: desk.rentPaidAmount,
            accruedDays,
            depositOutstanding,
            totalPaidTaxAmount: desk.rentPaidWithheldTaxAmount,
            ownerCash,
        });

        addCash(tenantUid, result.tenantReceives);
        if (ownerUid) addCash(ownerUid, -result.ownerDebit);

        if (result.tenantReceives > 0) {
            stageActivityLog(transaction, classId, {
                studentUid: tenantUid,
                type: "income",
                category: "real_estate",
                subCategory: "rent_deposit_refund",
                amount: result.tenantReceives,
                description: `${deskLabel} 자리 변경 정산 반환 (보증금${result.unusedRentAmount > 0 ? "·미사용 임대료" : ""})`,
                currency: "class_currency",
            }, logContext);
        }
        if (ownerUid && result.ownerDebit > 0) {
            stageActivityLog(transaction, classId, {
                studentUid: ownerUid,
                type: "expense",
                category: "real_estate",
                subCategory: "rent_deposit_refund",
                amount: result.ownerDebit,
                description: `${deskLabel} 자리 변경 정산 (임차인에게 반환)`,
                currency: "class_currency",
            }, logContext);
        }
        if (result.unusedRentTaxAmount > 0) {
            stageTaxExpense(transaction, classId, {
                amount: result.unusedRentTaxAmount,
                expenseType: "rental_income_tax_refund",
                category: "tax_refund",
                description: `${deskLabel} 자리 변경 임대소득세 환급 조정`,
                studentUid: ownerUid,
                studentName: desk.ownerName || null,
                source: "real_estate_seat_change",
            }, actorUid, {
                ...logContext,
                customId: `realestate_seatchange_tax_${String(desk.rentContractId).replace(/[^A-Za-z0-9_-]/g, "_")}`,
                skipFeatureGate: true,
            });
        }

        transaction.set(
            db.doc(`classes/${classId}/real_estate/rent_deposits/records/seatchange_${String(desk.rentContractId).replace(/[^A-Za-z0-9_-]/g, "_")}`),
            {
                type: "seat_change_settlement",
                contractId: desk.rentContractId,
                deskId: desk.id,
                deskLabel,
                tenantId: tenantUid,
                tenantName: desk.rentTenantName || desk.studentName || "이름 없음",
                ownerId: ownerUid || "STATE",
                ownerName: ownerUid ? (desk.ownerName || "이름 없음") : "국유지",
                accruedDays,
                unpaidRentAmount: result.unpaidAmount,
                depositDeductionAmount: result.depositDeduction,
                forgivenRentAmount: result.forgivenRentAmount,
                unusedRentRefundAmount: result.unusedRentAmount,
                refundAmount: result.tenantReceives,
                ownerDebitAmount: result.ownerDebit,
                stateCoveredAmount: result.stateCoveredAmount,
                remainingAmount: result.pendingDepositAmount,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: actorUid,
            },
        );

        if (result.pendingDepositAmount > 0) {
            // 임대인 현금이 모자라 다 못 돌려준 금액은 이 자리에 반환 대기로 남긴다(새 학생 배정은 막지 않음).
            const deducted = toWholeNumber(desk.rentDepositDeductedAmount) + result.depositDeduction;
            groups[groupIndex].desks[deskIndex] = {
                ...desk,
                weeklyRent: 0,
                rentType: null,
                rentOpenEnded: null,
                rentContractStatus: "closed",
                rentDepositStatus: "return_pending",
                rentDepositDeductedAmount: deducted,
                rentDepositReturnedAmount: Math.max(0, paidDeposit - deducted - result.pendingDepositAmount),
                rentDepositReturnedAt: Timestamp.fromDate(now),
                rentDepositSettlementReason: "자리 변경 자동 정산 (임대인 잔액 부족)",
            };
        } else {
            groups[groupIndex].desks[deskIndex] = { ...desk, ...CLEARED_RENT_FIELDS };
        }
        settlements.push({ deskId: desk.id, ...result });
    });

    cashDelta.forEach((amount, uid) => {
        if (amount) transaction.update(studentRefs.get(uid), { "assets.cash": FieldValue.increment(amount) });
    });
    return { groups, settlements };
};

module.exports = {
    CLEARED_RENT_FIELDS,
    SEAT_CHANGE_FORGIVE_MIN_PAID_DAYS,
    computeSeatChangeSettlement,
    isClosedPendingReturnDesk,
    stageSeatChangeRentSettlements,
};
