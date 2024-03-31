import * as fs from 'fs';

import dataApi from './data';
import { APPSTORE, PLAYSTORE, PADDLE, EXPIRED, GRACE, ON_HOLD } from './const';
import { isObject } from './utils';
import {
  IGNORED_PURCHASE_IDS, IGNORED_USER_IDS, IGNORED_PADDLE_USER_IDS,
} from './ignore';

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

  if (isObject(createDate)) {
    const dateDiff = endDate.getTime() - createDate.getTime();
    if (status === EXPIRED && dateDiff <= 2 * 24 * 60 * 60 * 1000) return true;
  }

  return false;
};

export const isObsoletePurchase = (purchase) => {
  const { status, endDate } = purchase;
  if (status === EXPIRED) {
    throw new Error(`Not support status: ${status}`);
  }

  const [now, endDT] = [(new Date()).getTime(), endDate.getTime()];
  if (status === GRACE) {
    if (now - endDT > 14 * 24 * 60 * 60 * 1000) return true;
  } else if (status === ON_HOLD) {
    if (now - endDT > 45 * 24 * 60 * 60 * 1000) return true;
  } else {
    if (now > endDT) return true;
  }

  return false;
};
