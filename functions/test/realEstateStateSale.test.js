"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createCallableHarness } = require("./helpers/callableMemoryHarness");

const ROOT = "classes/c1/real_estate/";
const seed = (deskOverrides = {}) => ({
    "classes/c1": { planType: "FREE", className: "4-4" },
    [`${ROOT}config`]: { enabled: true },
    [`${ROOT}layout`]: {
        groups: [{ id: "g1", desks: [{
            id: "d1", permanentId: "p1", number: 1, isActive: true, price: 700,
            ownerId: "owner", ownerName: "이서준", lastPurchasePrice: 1000,
            ...deskOverrides,
        }] }],
    },
    "classes/c1/students/owner": { name: "이서준", assets: { cash: 50 } },
    "classes/c1/students/other": { name: "김가람", assets: { cash: 0 } },
    "classes/c1/students/teacher": { name: "교사", role: "teacher" },
    "classes/c1/dashboardSummary/taxSummary": { totalIncome: 5000, totalExpense: 0 },
});
const call = (uid, role, data) => ({ auth: { uid, token: { role, classId: "c1" } }, data: { classId: "c1", deskId: "d1", ...data } });
const getDesk = (h) => h.data.get(`${ROOT}layout`).groups[0].desks[0];

test("owner sells desk to state, gets paid from treasury, and the desk can go to public auction", async () => {
    const h = createCallableHarness(seed(), { retryTransaction: true });
    const api = h.load("functions/src/realestate.js");
    const result = await api.sellRealEstateToState(call("owner", "student"));
    assert.equal(result.price, 1000);
    assert.equal(h.data.get("classes/c1/students/owner").assets.cash, 1050);
    const desk = getDesk(h);
    assert.equal(desk.ownerId, null);
    assert.equal(desk.ownerSource, "state_buyback");
    assert.equal(desk.isForSale, false);

    await assert.rejects(api.sellRealEstateToState(call("owner", "student")), /국가 소유/);

    const auctionApi = h.load("functions/src/realestateAuction.js");
    const endAt = new Date(Date.now() + 86400000).toISOString();
    const auction = await auctionApi.updateRealEstateAuctionState({
        auth: { uid: "teacher", token: { role: "teacher", classId: "c1" } },
        data: { classId: "c1", action: "create_public", payload: { deskId: "d1", endAt } },
    });
    assert.equal(auction.source, "public");
});

test("another student cannot sell someone else's desk but a teacher can", async () => {
    const h = createCallableHarness(seed());
    const api = h.load("functions/src/realestate.js");
    await assert.rejects(api.sellRealEstateToState(call("other", "student")), /본인 소유/);
    assert.equal(getDesk(h).ownerId, "owner");
    await api.sellRealEstateToState(call("teacher", "teacher"));
    assert.equal(getDesk(h).ownerId, null);
    assert.equal(h.data.get("classes/c1/students/owner").assets.cash, 1050);
});

test("sale is refused without enough treasury or during an active contract", async () => {
    const poor = createCallableHarness({ ...seed(), "classes/c1/dashboardSummary/taxSummary": { totalIncome: 500, totalExpense: 0 } });
    await assert.rejects(poor.load("functions/src/realestate.js").sellRealEstateToState(call("owner", "student")), /국고 잔액/);
    assert.equal(poor.data.get("classes/c1/students/owner").assets.cash, 50);

    const busy = createCallableHarness(seed({ tradeStatus: "contracting", buyerId: "other" }));
    await assert.rejects(busy.load("functions/src/realestate.js").sellRealEstateToState(call("owner", "student")), /진행 중인 계약/);
});
