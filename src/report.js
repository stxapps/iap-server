import * as fs from 'fs';

const purchaseFpath = process.argv[2];
const purchaseUserFpath = process.argv[3];

import dataApi from './data';
import {
  APPSTORE, PLAYSTORE, COM_BRACEDOTTO_SUPPORTER, COM_JUSTNOTECC_SUPPORTER,
  ACTIVE, NO_RENEW, GRACE, ON_HOLD, PAUSED, EXPIRED, UNKNOWN,
} from './const';
import { isObject } from './utils';

const IGNORED_PURCHASE_IDS = [
  'AppStore_260001175454351',
  'PlayStore_micjlfkfpnlmgabcaifaldho.AO-J1Oz8M4iv77hC7zf7hp3YHmks7Y-BM1Lgj9zZp2TD3KMbDsNxuHiwwHoIkmNDUrXysFejR7-UoJLPNWwRJfGQXUx4CFBZOQ',
  'AppStore_2000000066277813', // test originalOrderId
  'AppStore_2000000111446584', // test originalOrderId
];

const IGNORED_USER_IDS = [
  '02a0f1cc7ea19c560b345e4eb921181210114ce0d658681cd9a8161964b21bafda',
  '02740f2e81ba14cf4ac4fd1e9d97a39916d882fe2372f3b47cc935ed574af34509',
  '02b9de8deec441e43cc83c5eb49125eb04c33897a201f35edfd22bcce6492f9650',
  '0219200d7190e43e9101c76734ed9131356fb0a32ac8078bff74647cffd00d4048',
  '03205cc929b43f64458c5e32dbb9a847fa132ed2115c6dff6a5284b62fdf6b94f8',
  '0328e312a03aeb91462da80e5cba07fd871f31a63b2c744a2cf28002c78a53be95',
  '0301a2e8152009bd46cb8a424e6f66f46cf9e538d40e0c9893912eebd2a014dce5',
  '02d4bcea7320a06c04026de2e063e7356bf46c54b34a691b839c3da53a60553fb9',
  '02e08c84b7eeeb56f75a2db58f2fbf8fa1be95c614364b44a9d6a53cc7fad4da1b',
  '039938a5a54d72e8e3368a57c8d1333a41dd984a965d447139db12256d626589e7',
  '0225754a4de9fd7300b3d5f266377d5672efb2fecbc0d33a7a7cee8560feff6f90',
  '026063b5f8926dd0ce0d246c8dd36940d53733de3165f802491a1ec48e4fb31d56',
  '03ea8be8b0872812a764d42d4f4a87507aca8f3048b89cfc21ceda7a55aa8004df',
  '022fa1ad24f0691c480445f4377adb0a1f5598624d5cd4c5be834b8a04d908b093',
  '0201b4dc30ce875f91b736139e581f963c1d3d316ac9c58da211ce43f12f4440ac',
  '02941b2a7e376a7c52ff86c853b235f4b069462a9b65a91717a5c72385a652e027',
  '03b593a360dfd7ebbeaa5ea6cf267cec5293bbe90bd8906a1b256443a2f6ae3f93',
  '037ec84b9713d52cb114b4c40671eb3bde03b30971f4d6d827f329b9980c5f810d',
  '039e1147743960013504e188199ff910b11f32ce06a14e7b4857238e94935dc22a',
  '037405c8a4bc620446f1dd259caf7be597a8f2b2192b96e1e898ba0483e81cdc1e',
  '03b1898033856d142a73718a4b652947698df9342498afd299a453dae153febc0a',
  '023f1f35fb9774423ff3f976a765669ff5c6d599bb4081533b3e2bbd117cf9c9cb',
  '0374a1ac42a1d717e31a84af78997ecc358e8f992b91f8adf08cafa43d69f6545c',
  '030443a8210bca008abb49461006aa2ffda8568a3d5204585055f7bb33eb4ec8f3',
];

const _getPurchases = async () => {
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

  return purchases;
};

const _getPurchaseUsers = async () => {
  let users = {}, lastUpdateDate = new Date(0);
  if (fs.existsSync(purchaseUserFpath)) {
    const text = fs.readFileSync(purchaseUserFpath, 'utf-8');
    users = JSON.parse(text, (key, value) => {
      if (['updateDate'].includes(key)) {
        return new Date(value);
      }
      return value;
    });

    for (const user of Object.values(users)) {
      if (user.updateDate > lastUpdateDate) lastUpdateDate = user.updateDate;
    }
  }

  const updatedUsers = await dataApi.getUpdatedPurchaseUsers(lastUpdateDate);
  if (updatedUsers.length > 0) {
    for (const user of updatedUsers) {
      const { purchaseId, userId } = user;
      const purchaseUserId = `${purchaseId}_${userId}`;
      users[purchaseUserId] = { ...users[purchaseUserId], ...user };
    }

    fs.writeFileSync(purchaseUserFpath, JSON.stringify(users, null, 2));
  }

  return users;
};

const getPurchases = async () => {
  const purchases = await _getPurchases();
  const users = await _getPurchaseUsers();

  const toUserIds = {};
  for (const user of Object.values(users)) {
    const { purchaseId, userId } = user;
    if (!(purchaseId in toUserIds)) toUserIds[purchaseId] = [];
    toUserIds[purchaseId].push(userId);
  }

  for (const purchaseId in purchases) {
    purchases[purchaseId].userIds = toUserIds[purchaseId];
  }

  return Object.values(purchases);
};

const doIgnorePurchase = (purchase) => {
  const {
    source, token, originalOrderId, status, endDate, createDate, userIds,
  } = purchase;

  if (![APPSTORE, PLAYSTORE].includes(source)) return true;

  const purchaseId = dataApi.getPurchaseId('', source, token, originalOrderId);
  if (IGNORED_PURCHASE_IDS.includes(purchaseId)) return true;

  if (userIds.every(userId => IGNORED_USER_IDS.includes(userId))) return true;

  const dateDiff = endDate.getTime() - createDate.getTime();
  if (status === EXPIRED && dateDiff <= 2 * 24 * 60 * 60 * 1000) return true;

  return false;
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
    if (doIgnorePurchase(purchase)) continue;

    const { source, productId, status, endDate, createDate } = purchase;

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
