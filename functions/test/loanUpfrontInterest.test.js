"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createCallableHarness } = require("./helpers/callableMemoryHarness");

const HARNESS_NOW = Date.parse("2026-09-08T01:00:00Z"); // callableMemoryHarness의 고정 시각
const LOAN = "classes/c1/students/s1/loans/L1";
const student = { auth: { uid: "s1", token: { role: "student", classId: "c1" } } };
const seed = (loan) => ({
    "classes/c1": { planType: "FREE" },
    "classes/c1/students/s1": { name: "s1", role: "student", assets: { cash: 20000, loan: 10000 } },
    [LOAN]: {
        status: "ongoing", amount: 10000, principal: 10000, amountLeft: 10000,
        days: 14, finalRateApplied: 3, rate: 3, normalInterestAmount: 300, interestLeft: 300,
        interestPaid: 0, penaltyPaid: 0, overdueRate: 0,
        startedAt: new Date(HARNESS_NOW), productLabel: "2주 대출",
        interestState: { accruedAmount: 300, paidAmount: 0, waivedAmount: 0, baseDate: new Date(HARNESS_NOW) },
        ...loan,
    },
});
const repay = (h, amount) => h.load("functions/src/bank.js").repayLoan({ ...student, data: { classId: "c1", loanId: "L1", amount } });

test("대출 즉시 방식은 빌린 당일에도 약정 이자 전액을 먼저 갚는다", async () => {
    const h = createCallableHarness(seed({ interestModel: "upfront" }));
    const result = await repay(h, 1000);
    assert.equal(result.paidInterest, 300, "당일에도 이자 300 전액");
    assert.equal(result.paidPrincipal, 700);
    const loan = h.data.get(LOAN);
    assert.equal(loan.interestLeft, 0);
    assert.equal(loan.amountLeft, 9300);
});

test("대출 즉시 방식은 원금+이자를 다 갚으면 끝나고, 이자를 두 번 받지 않는다", async () => {
    const h = createCallableHarness(seed({ interestModel: "upfront" }));
    await repay(h, 300);
    const result = await repay(h, 10000);
    assert.equal(result.paidInterest, 0);
    assert.equal(result.paidPrincipal, 10000);
    assert.equal(result.fullyRepaid, true);
    assert.equal(h.data.get("classes/c1/students/s1").assets.cash, 20000 - 10300);
});

test("예전 일할 방식 대출은 그대로 일수만큼만 이자가 쌓인다", async () => {
    const h = createCallableHarness(seed({ interestModel: "declining_balance", interestState: { accruedAmount: 0, paidAmount: 0, waivedAmount: 0, baseDate: new Date(HARNESS_NOW) } }));
    const result = await repay(h, 1000);
    assert.equal(result.paidInterest, 0, "빌린 당일은 이자 0");
});
