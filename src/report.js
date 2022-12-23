import * as fs from 'fs';

const purchaseFpath = process.argv[2];

import dataApi from './data';
import {
  APPSTORE, PLAYSTORE, COM_BRACEDOTTO_SUPPORTER, COM_JUSTNOTECC_SUPPORTER,
  ACTIVE, NO_RENEW, GRACE, ON_HOLD, PAUSED, EXPIRED, UNKNOWN,
} from './const';
import { isObject } from './utils';

const IGNORED_PURCHASE_IDS = [
  'AppStore_260001175454351',
  'PlayStore_micjlfkfpnlmgabcaifaldho.AO-J1Oz8M4iv77hC7zf7hp3YHmks7Y-BM1Lgj9zZp2TD3KMbDsNxuHiwwHoIkmNDUrXysFejR7-UoJLPNWwRJfGQXUx4CFBZOQ',
];

const getPurchases = async () => {
  let purchases = {}, lastUpdateDate = new Date(0);
  if (fs.existsSync(purchaseFpath)) {
    const text = fs.readFileSync(purchaseFpath, 'utf-8');
    purchases = JSON.parse(text, (key, value) => {
      if (['expiryDate', 'endDate', 'updateDate', 'createDate'].includes(key)) {
        return new Date(value);
      }
      return value;
    });

    for (const purchase of Object.values(purchases)) {
      if (purchase.updateDate > lastUpdateDate) lastUpdateDate = purchase.updateDate;
    }
  }

  const updatedPurchases = await dataApi.getUpdatedPurchases(lastUpdateDate);
  if (updatedPurchases.length > 0) {
    const purchaseIds = [];
    for (const purchase of updatedPurchases) {
      const { source, token, originalOrderId } = purchase;
      const purchaseId = dataApi.getPurchaseId('', source, token, originalOrderId);
      if (purchaseId in purchases) continue;
      purchaseIds.push(purchaseId);
    }

    // For now, get extras only newly added purchases as there is only createDate.
    const purchaseExtras = {};
    const _purchaseExtras = await dataApi.getPurchaseExtras(purchaseIds);
    for (const _purchaseExtra of _purchaseExtras) {
      const purchaseExtra = {};
      for (const key in _purchaseExtra) {
        if (key === 'keyName') continue;
        purchaseExtra[key] = _purchaseExtra[key];
      }
      purchaseExtras[_purchaseExtra.keyName] = purchaseExtra;
    }

    for (const purchase of updatedPurchases) {
      const { source, token, originalOrderId } = purchase;
      const purchaseId = dataApi.getPurchaseId('', source, token, originalOrderId);

      if (purchaseId in purchases) {
        purchases[purchaseId] = { ...purchases[purchaseId], ...purchase };
        continue;
      }

      const purchaseExtra = purchaseExtras[purchaseId];
      if (!isObject(purchaseExtra)) {
        console.log('Invalid purchaseExtra:', purchase, purchaseId, purchaseExtra);
        continue;
      }

      purchases[purchaseId] = { ...purchase, ...purchaseExtra };
    }

    fs.writeFileSync(purchaseFpath, JSON.stringify(purchases, null, 2));
  }

  return Object.values(purchases);
};

const printAppReport = (appName, productId, sums, nACommitted, nPCommitted) => {
  console.log('');
  console.log(appName);
  console.log(
    ''.padStart(8, ' '),
    '|', 'Committed'.padStart(10, ' '),
    '|', 'Tried'.padStart(8, ' '),
    '|', 'Trying'.padStart(8, ' '),
    '|', 'Active'.padStart(8, ' '),
    '|', 'No renew'.padStart(8, ' '),
    '|', 'Others'.padStart(8, ' '),
  );
  console.log(
    'Apple'.padEnd(8, ' '),
    '|', `${nACommitted}`.padStart(10, ' '),
    '|', `${sums[productId][APPSTORE].tried}`.padStart(8, ' '),
    '|', `${sums[productId][APPSTORE].trying}`.padStart(8, ' '),
    '|', `${sums[productId][APPSTORE].active}`.padStart(8, ' '),
    '|', `${sums[productId][APPSTORE].activeNoRenew}`.padStart(8, ' '),
    '|', `${sums[productId][APPSTORE].others}`.padStart(8, ' '),
  );
  console.log(
    'Google'.padEnd(8, ' '),
    '|', `${nPCommitted}`.padStart(10, ' '),
    '|', `${sums[productId][PLAYSTORE].tried}`.padStart(8, ' '),
    '|', `${sums[productId][PLAYSTORE].trying}`.padStart(8, ' '),
    '|', `${sums[productId][PLAYSTORE].active}`.padStart(8, ' '),
    '|', `${sums[productId][PLAYSTORE].activeNoRenew}`.padStart(8, ' '),
    '|', `${sums[productId][PLAYSTORE].others}`.padStart(8, ' '),
  );
  console.log('');
};

const report = async () => {
  const purchases = await getPurchases();

  const date = new Date();
  const sums = {
    [COM_BRACEDOTTO_SUPPORTER]: {
      [APPSTORE]: { trying: 0, tried: 0, active: 0, activeNoRenew: 0, others: 0 },
      [PLAYSTORE]: { trying: 0, tried: 0, active: 0, activeNoRenew: 0, others: 0 },
    },
    [COM_JUSTNOTECC_SUPPORTER]: {
      [APPSTORE]: { trying: 0, tried: 0, active: 0, activeNoRenew: 0, others: 0 },
      [PLAYSTORE]: { trying: 0, tried: 0, active: 0, activeNoRenew: 0, others: 0 },
    }
  }

  for (const purchase of purchases) {
    const {
      source, productId, token, originalOrderId, status, endDate, createDate,
    } = purchase;
    const purchaseId = dataApi.getPurchaseId('', source, token, originalOrderId);

    if (![APPSTORE, PLAYSTORE].includes(source)) continue;
    if (IGNORED_PURCHASE_IDS.includes(purchaseId)) continue;

    const dateDiff = endDate.getTime() - createDate.getTime();
    const isTrying = dateDiff <= 28 * 24 * 60 * 60 * 1000;

    if (status === EXPIRED) {
      if (isTrying) sums[productId][source].tried += 1;
      else sums[productId][source].others += 1;
      continue;
    }

    if (endDate.getTime() < date.getTime()) {
      // If not expired and endDate is behind today, status is obsolete,
      //   should call reverify.
      console.log('Found obsolete status:', purchase);
    }

    if (status === UNKNOWN) {
      console.log('Found unknown status:', purchase);
      continue;
    }

    if ([GRACE, ON_HOLD, PAUSED].includes(status)) {
      if (isTrying) sums[productId][source].tried += 1;
      else sums[productId][source].others += 1;
      continue;
    }

    if (status === NO_RENEW) {
      if (isTrying) sums[productId][source].tried += 1;
      else sums[productId][source].activeNoRenew += 1;
      continue;
    }

    if (status === ACTIVE) {
      if (isTrying) sums[productId][source].trying += 1;
      else sums[productId][source].active += 1;
      continue;
    }

    console.log('Invalid purchase:', purchase);
  }

  const nBACommitted = (
    sums[COM_BRACEDOTTO_SUPPORTER][APPSTORE].active +
    sums[COM_BRACEDOTTO_SUPPORTER][APPSTORE].activeNoRenew
  );
  const nBPCommitted = (
    sums[COM_BRACEDOTTO_SUPPORTER][PLAYSTORE].active +
    sums[COM_BRACEDOTTO_SUPPORTER][PLAYSTORE].activeNoRenew
  );
  const nJACommitted = (
    sums[COM_JUSTNOTECC_SUPPORTER][APPSTORE].active +
    sums[COM_JUSTNOTECC_SUPPORTER][APPSTORE].activeNoRenew
  );
  const nJPCommitted = (
    sums[COM_JUSTNOTECC_SUPPORTER][PLAYSTORE].active +
    sums[COM_JUSTNOTECC_SUPPORTER][PLAYSTORE].activeNoRenew
  );
  const nCommitted = nBACommitted + nBPCommitted + nJACommitted + nJPCommitted;

  printAppReport('Brace.to', COM_BRACEDOTTO_SUPPORTER, sums, nBACommitted, nBPCommitted);
  printAppReport('Justnote', COM_JUSTNOTECC_SUPPORTER, sums, nJACommitted, nJPCommitted);

  console.log('Total committed:', nCommitted);
  console.log('');
};

report();
