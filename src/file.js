import * as fs from 'fs';

import dataApi from './data';
import { APPSTORE, PLAYSTORE, PADDLE, EXPIRED } from './const';

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

const IGNORED_PADDLE_USER_IDS = [
  '69489070', '69490728', '69488637', '450547', '450564', '445219',
];

const _getPurchases = async (purchaseFpath, doSync) => {
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

  if (doSync) {
    const updatedPurchases = await dataApi.getUpdatedPurchases(lastUpdateDate);
    if (updatedPurchases.length > 0) {
      for (const purchase of updatedPurchases) {
        const { source, token, originalOrderId } = purchase;
        const purchaseId = dataApi.getPurchaseId('', source, token, originalOrderId);
        purchases[purchaseId] = { ...purchases[purchaseId], ...purchase };
      }

      fs.writeFileSync(purchaseFpath, JSON.stringify(purchases, null, 2));
    }
  }

  return purchases;
};

const _getPurchaseUsers = async (purchaseUserFpath, doSync) => {
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

  if (doSync) {
    const updatedUsers = await dataApi.getUpdatedPurchaseUsers(lastUpdateDate);
    if (updatedUsers.length > 0) {
      for (const user of updatedUsers) {
        const { purchaseId, userId } = user;
        const purchaseUserId = `${purchaseId}_${userId}`;
        users[purchaseUserId] = { ...users[purchaseUserId], ...user };
      }

      fs.writeFileSync(purchaseUserFpath, JSON.stringify(users, null, 2));
    }
  }

  return users;
};

export const getPurchases = async (purchaseFpath, purchaseUserFpath, doSync = true) => {
  const purchases = await _getPurchases(purchaseFpath, doSync);
  const users = await _getPurchaseUsers(purchaseUserFpath, doSync);

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

export const doIgnorePurchase = (purchase) => {
  const {
    source, token, originalOrderId, status, endDate, createDate, userIds, paddleUserId,
  } = purchase;

  if (![APPSTORE, PLAYSTORE, PADDLE].includes(source)) return true;

  const purchaseId = dataApi.getPurchaseId('', source, token, originalOrderId);
  if (IGNORED_PURCHASE_IDS.includes(purchaseId)) return true;

  if (userIds && userIds.every(userId => IGNORED_USER_IDS.includes(userId))) return true;
  if (paddleUserId && IGNORED_PADDLE_USER_IDS.includes(paddleUserId)) return true;

  const dateDiff = endDate.getTime() - createDate.getTime();
  if (status === EXPIRED && dateDiff <= 2 * 24 * 60 * 60 * 1000) return true;

  return false;
};
