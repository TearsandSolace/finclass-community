"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { computeSeatChangeSettlement } = require("../utils/seatChangeRentSettlement");

test("4주 이상 낸 임차인의 자투리 미납은 소멸하고 보증금은 전액 반환", () => {
    // 주 70, 30일 살고 28일치(280) 냄 → 미납 2일치(20)는 소멸
    const r = computeSeatChangeSettlement({ weeklyRent: 70, paidDays: 28, paidAmount: 280, accruedDays: 30, depositOutstanding: 300, ownerCash: 1000 });
    assert.equal(r.unpaidAmount, 20);
    assert.equal(r.forgivenRentAmount, 20);
    assert.equal(r.depositDeduction, 0);
    assert.equal(r.tenantReceives, 300);
    assert.equal(r.ownerDebit, 300);
    assert.equal(r.pendingDepositAmount, 0);
});

test("4주 미만으로 낸 임차인의 미납은 보증금에서 빼고, 모자라면 나머지는 소멸", () => {
    // 28일 살고 7일치(70)만 냄 → 미납 210, 보증금 100에서 100 차감, 110 소멸
    const r = computeSeatChangeSettlement({ weeklyRent: 70, paidDays: 7, paidAmount: 70, accruedDays: 28, depositOutstanding: 100, ownerCash: 1000 });
    assert.equal(r.unpaidAmount, 210);
    assert.equal(r.depositDeduction, 100);
    assert.equal(r.forgivenRentAmount, 110);
    assert.equal(r.tenantReceives, 0);
    assert.equal(r.ownerDebit, 0);
});

test("미리 낸 임대료 중 안 지난 기간은 임대인이 돌려준다", () => {
    // 14일치(140) 내고 7일 만에 자리 변경 → 70 반환
    const r = computeSeatChangeSettlement({ weeklyRent: 70, paidDays: 14, paidAmount: 140, accruedDays: 7, depositOutstanding: 0, ownerCash: 1000 });
    assert.equal(r.unusedRentAmount, 70);
    assert.equal(r.tenantReceives, 70);
    assert.equal(r.ownerDebit, 70);
});

test("임대인 현금이 모자라면 모자란 만큼 반환 대기", () => {
    const r = computeSeatChangeSettlement({ weeklyRent: 0, paidDays: 0, paidAmount: 0, accruedDays: 20, depositOutstanding: 600, ownerCash: 250 });
    assert.equal(r.ownerDebit, 250);
    assert.equal(r.tenantReceives, 250);
    assert.equal(r.pendingDepositAmount, 350);
});

test("국가 소유 자리는 국가가 전액 돌려준다", () => {
    const r = computeSeatChangeSettlement({ weeklyRent: 70, paidDays: 28, paidAmount: 280, accruedDays: 28, depositOutstanding: 200, ownerCash: null });
    assert.equal(r.tenantReceives, 200);
    assert.equal(r.stateCoveredAmount, 200);
    assert.equal(r.pendingDepositAmount, 0);
});
