"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createCallableHarness } = require("./helpers/callableMemoryHarness");

const ROOT = "classes/c1/real_estate/";
const kstDateKey = (offsetDays = 0) => {
    const date = new Date(Date.now() + 9 * 3600000 + offsetDays * 86400000);
    return date.toISOString().slice(0, 10);
};
const seed = () => ({
    "classes/c1": { planType: "FREE" },
    [`${ROOT}config`]: { enabled: true, rentTaxEnabled: false },
    [`${ROOT}layout`]: {
        groups: [{ id: "g1", desks: [{
            id: "d1", permanentId: "p1", number: 1, isActive: true, price: 700, lastPurchasePrice: 1000,
            ownerId: "owner", ownerName: "이서준", studentId: "tenant", studentName: "김가람",
        }] }],
    },
    "classes/c1/students/owner": { name: "이서준", assets: { cash: 100 } },
    "classes/c1/students/tenant": { name: "김가람", assets: { cash: 1000 } },
    "classes/c1/students/teacher": { name: "교사", role: "teacher" },
});
const teacher = (data) => ({ auth: { uid: "teacher", token: { role: "teacher", classId: "c1" } }, data: { classId: "c1", deskId: "d1", ...data } });
const tenant = (data = {}) => ({ auth: { uid: "tenant", token: { role: "student", classId: "c1" } }, data: { classId: "c1", deskId: "d1", ...data } });
const getDesk = (h) => h.data.get(`${ROOT}layout`).groups[0].desks[0];
const jeonsePayload = (extra = {}) => ({
    action: "update_rent_fee",
    payload: { rentType: "jeonse", weeklyRent: 999, depositAmount: 600, rentStartDateKey: kstDateKey(0), rentLastDateKey: kstDateKey(13), ...extra },
});

test("jeonse contract has no weekly rent, deposit goes to landlord, rent payment is refused", async () => {
    const h = createCallableHarness(seed(), { retryTransaction: true });
    const api = h.load("functions/src/realestate.js");

    await api.updateRealEstateDeskState(teacher(jeonsePayload()));
    let desk = getDesk(h);
    assert.equal(desk.rentType, "jeonse");
    assert.equal(desk.weeklyRent, 0, "jeonse ignores any weekly rent sent");
    assert.equal(desk.rentDepositAmount, 600);
    assert.equal(desk.rentContractStatus, "pending_payment");

    await api.payRentDeposit(tenant({ clientRequestId: "jeonse-deposit-1" }));
    desk = getDesk(h);
    assert.equal(desk.rentContractStatus, "active");
    assert.equal(h.data.get("classes/c1/students/tenant").assets.cash, 400, "tenant pays only the deposit");
    assert.equal(h.data.get("classes/c1/students/owner").assets.cash, 700, "landlord receives the deposit to use");

    await assert.rejects(api.payRent(tenant({ days: 7, clientRequestId: "jeonse-rent-1" })), /전세/);

    await api.settleRentDeposit(teacher({ deductionAmount: 0 }));
    assert.equal(h.data.get("classes/c1/students/tenant").assets.cash, 1000, "deposit fully returned");
    assert.equal(h.data.get("classes/c1/students/owner").assets.cash, 100);
});

test("jeonse requires a deposit and monthly zero rent still clears the contract", async () => {
    const h = createCallableHarness(seed());
    const api = h.load("functions/src/realestate.js");
    await assert.rejects(api.updateRealEstateDeskState(teacher(jeonsePayload({ depositAmount: 0 }))), /보증금/);

    await api.updateRealEstateDeskState(teacher(jeonsePayload()));
    await api.updateRealEstateDeskState(teacher({ action: "update_rent_fee", payload: { weeklyRent: 0, depositAmount: 0 } }));
    const desk = getDesk(h);
    assert.equal(desk.rentContractId, null);
    assert.equal(desk.rentType, null);
});

test("monthly contract moves in with the deposit only and rent is paid weekly afterwards", async () => {
    const h = createCallableHarness(seed(), { retryTransaction: true });
    const api = h.load("functions/src/realestate.js");
    const monthly = (deposit) => ({
        action: "update_rent_fee",
        payload: { rentType: "monthly", weeklyRent: 70, depositAmount: deposit, rentStartDateKey: kstDateKey(0), rentLastDateKey: kstDateKey(27) },
    });

    await api.updateRealEstateDeskState(teacher(monthly(300)));
    assert.equal(getDesk(h).rentContractStatus, "pending_payment");
    await api.payRentDeposit(tenant({ clientRequestId: "monthly-deposit-1" }));
    let desk = getDesk(h);
    assert.equal(desk.rentContractStatus, "active");
    assert.equal(desk.rentPaidDays, 0, "no rent is prepaid at move-in");
    assert.equal(h.data.get("classes/c1/students/tenant").assets.cash, 700, "tenant pays only the deposit");

    await api.payRent(tenant({ days: 7, clientRequestId: "monthly-rent-1" }));
    desk = getDesk(h);
    assert.equal(desk.rentPaidDays, 7);
    assert.equal(h.data.get("classes/c1/students/tenant").assets.cash, 630);
});

test("monthly contract without a deposit starts right away", async () => {
    const h = createCallableHarness(seed());
    const api = h.load("functions/src/realestate.js");
    await api.updateRealEstateDeskState(teacher({
        action: "update_rent_fee",
        payload: { rentType: "monthly", weeklyRent: 70, depositAmount: 0, rentStartDateKey: kstDateKey(0), rentLastDateKey: kstDateKey(27) },
    }));
    assert.equal(getDesk(h).rentContractStatus, "active");
    await api.payRent(tenant({ days: 7, clientRequestId: "nodeposit-rent-1" }));
    assert.equal(getDesk(h).rentPaidDays, 7);
});
