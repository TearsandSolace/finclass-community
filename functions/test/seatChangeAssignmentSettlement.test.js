"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createCallableHarness } = require("./helpers/callableMemoryHarness");

const ROOT = "classes/c1/real_estate/";
const DAY = 86400000;
const HARNESS_NOW = Date.parse("2026-09-08T01:00:00Z"); // callableMemoryHarness의 고정 시각
const daysAgo = (n) => new Date(HARNESS_NOW - n * DAY).toISOString();
const baseDesk = (id, number, studentId, extra = {}) => ({ id, permanentId: `p-${id}`, number, isActive: true, teamId: "none", studentId, studentName: studentId, ...extra });
const seed = (desks, students) => ({
    "classes/c1": { planType: "FREE" },
    "classes/c1/students/teacher": { name: "교사", role: "teacher" },
    [`${ROOT}config`]: { enabled: true },
    [`${ROOT}layout`]: { editorRevision: 3, groups: [{ id: "g1", desks }] },
    ...Object.fromEntries(Object.entries(students).map(([uid, cash]) => [`classes/c1/students/${uid}`, { name: uid, assets: { cash } }])),
});
const teacher = { auth: { uid: "teacher", token: { role: "teacher", classId: "c1" } } };
const swap = (h, pairs, requestId) => {
    const current = h.data.get(`${ROOT}layout`).groups;
    const groups = current.map((g) => ({ ...g, desks: g.desks.map((d) => ({ ...d, studentId: pairs[d.id] ?? d.studentId, studentName: pairs[d.id] ?? d.studentName })) }));
    return h.load("functions/src/realEstatePlacement.js").saveRealEstateAssignments({ ...teacher, data: { classId: "c1", groups, constraints: { fixedSeats: {}, genderSeatPreferences: {}, avoidGroups: [], genderShuffleMode: "ignore" }, expectedRevision: h.data.get(`${ROOT}layout`).editorRevision, requestId } });
};
const monthly = (extra) => ({ ownerId: "landlord", ownerName: "landlord", rentContractId: "rc1", rentTenantId: "tenantA", rentTenantName: "tenantA",
    rentType: "monthly", weeklyRent: 70, rentContractStatus: "active", rentStartAt: daysAgo(30), rentLastDateAt: daysAgo(-300),
    rentDepositAmount: 300, rentDepositPaidAmount: 300, rentDepositStatus: "paid", ...extra });

test("자리를 바꾸면 4주 이상 낸 월세 계약은 자투리 미납을 소멸하고 보증금을 돌려준다", async () => {
    const h = createCallableHarness(seed([
        baseDesk("d1", 1, "tenantA", monthly({ rentPaidDays: 28, rentPaidAmount: 280 })),
        baseDesk("d2", 2, "tenantB"),
    ], { tenantA: 0, tenantB: 0, landlord: 1000 }));
    const result = await swap(h, { d1: "tenantB", d2: "tenantA" }, "swap-request-0001");
    assert.equal(result.rentSettlements.length, 1);
    assert.equal(result.rentSettlements[0].forgivenRentAmount, 20, "어제까지 30일 살고 28일치 냄 → 2일치 20 소멸");
    assert.equal(h.data.get("classes/c1/students/tenantA").assets.cash, 300);
    assert.equal(h.data.get("classes/c1/students/landlord").assets.cash, 700);
    const d1 = h.data.get(`${ROOT}layout`).groups[0].desks.find((d) => d.id === "d1");
    assert.equal(d1.studentId, "tenantB");
    assert.equal(d1.rentContractId, null, "계약이 비워진다");
});

test("4주 미만으로 낸 미납은 보증금에서 빼고, 임대인 돈이 모자라면 반환 대기로 남긴 채 자리를 바꾼다", async () => {
    const h = createCallableHarness(seed([
        baseDesk("d1", 1, "tenantA", monthly({ rentPaidDays: 7, rentPaidAmount: 70, rentDepositAmount: 600, rentDepositPaidAmount: 600 })),
        baseDesk("d2", 2, "tenantB"),
    ], { tenantA: 0, tenantB: 0, landlord: 100 }));
    // 어제까지 30일 → 미납 300-70=230 → 보증금 600에서 230 차감 → 반환할 370 중 임대인 100만 있음
    const result = await swap(h, { d1: "tenantB", d2: "tenantA" }, "swap-request-0002");
    assert.equal(result.rentSettlements[0].depositDeductionAmount, 230);
    assert.equal(result.rentSettlements[0].pendingAmount, 270);
    assert.equal(h.data.get("classes/c1/students/tenantA").assets.cash, 100);
    assert.equal(h.data.get("classes/c1/students/landlord").assets.cash, 0);
    const d1 = h.data.get(`${ROOT}layout`).groups[0].desks.find((d) => d.id === "d1");
    assert.equal(d1.studentId, "tenantB", "반환 대기가 있어도 새 학생이 앉는다");
    assert.equal(d1.rentContractStatus, "closed");
    assert.equal(d1.rentDepositStatus, "return_pending");
    assert.equal(d1.rentDepositPaidAmount - d1.rentDepositReturnedAmount - d1.rentDepositDeductedAmount, 270);

    // 선생님이 나중에 남은 반환 대기를 강제 정산할 수 있다
    await h.load("functions/src/realestate.js").settleRentDeposit({ ...teacher, data: { classId: "c1", deskId: "d1", deductionAmount: 0, forceSettle: true } });
    assert.equal(h.data.get("classes/c1/students/tenantA").assets.cash, 370);
});

test("전세는 보증금을 전액 돌려주고, 학생이 그대로면 아무 정산도 하지 않는다", async () => {
    const h = createCallableHarness(seed([
        baseDesk("d1", 1, "tenantA", monthly({ rentType: "jeonse", weeklyRent: 0, rentPaidDays: 0, rentPaidAmount: 0, rentDepositAmount: 500, rentDepositPaidAmount: 500 })),
        baseDesk("d2", 2, "tenantB"),
        baseDesk("d3", 3, "tenantC", monthly({ rentContractId: "rc3", rentTenantId: "tenantC", rentPaidDays: 7, rentPaidAmount: 70 })),
    ], { tenantA: 0, tenantB: 0, tenantC: 0, landlord: 1000 }));
    const result = await swap(h, { d1: "tenantB", d2: "tenantA" }, "swap-request-0003");
    assert.equal(result.rentSettlements.length, 1, "d3은 학생이 그대로라 정산하지 않는다");
    assert.equal(h.data.get("classes/c1/students/tenantA").assets.cash, 500);
    const d3 = h.data.get(`${ROOT}layout`).groups[0].desks.find((d) => d.id === "d3");
    assert.equal(d3.rentContractId, "rc3");
});
