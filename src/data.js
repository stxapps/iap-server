import { Datastore } from '@google-cloud/datastore';

import {
  VERIFY_LOG, NOTIFY_LOG, ACKNOWLEDGE_LOG, PURCHASE, PURCHASE_USER,
  APPSTORE, PLAYSTORE,
  ACTIVE, NO_RENEW, GRACE, ON_HOLD, PAUSED, EXPIRED, UNKNOWN,
} from './const';

const datastore = new Datastore();

const saveVerifyLog = async (logKey, source, userId, productId, token, verifyResult) => {
  const logData = [
    { name: 'logKey', value: logKey },
    { name: 'source', value: source },
    { name: 'userId', value: userId },
    { name: 'productId', value: productId },
    { name: 'token', value: token },
    {
      name: 'verifyResult',
      value: JSON.stringify(verifyResult),
      excludeFromIndexes: true,
    },
    { name: 'updateDate', value: new Date() },
  ];
  await datastore.save({ key: datastore.key([VERIFY_LOG]), data: logData });
};

const saveNotifyLog = async (logKey, source, token, notifyResult) => {
  const logData = [
    { name: 'logKey', value: logKey },
    { name: 'source', value: source },
    { name: 'token', value: token },
    {
      name: 'notifyResult',
      value: JSON.stringify(notifyResult),
      excludeFromIndexes: true,
    },
    { name: 'updateDate', value: new Date() },
  ];
  await datastore.save({ key: datastore.key([NOTIFY_LOG]), data: logData });
};

const saveAcknowledgeLog = () => {

};

/*const saveAskLog = async () => {
  // Columns: userId, purchaseId, status, askId, responseId, updateDate
};*/

const addPurchase = async (logKey, source, userId, productId, token, parsedData) => {
  // Purchase's columns: source, productId, orderId, token, status, expiryDate, endDate, updateDate
  // User's columns: purchaseId, userId
  // Not now columns: purchaseDate, startDate, trialPeriod, gracePeriod

  const purchaseId = getPurchaseId(logKey, source, token, parsedData.originalOrderId);
  const purchaseKey = datastore.key([PURCHASE, purchaseId]);
  const purchaseEntity = {
    key: purchaseKey,
    data: derivePurchaseEntityData(
      source, productId, parsedData.orderId, token, parsedData.originalOrderId,
      parsedData.status, parsedData.expiryDate, parsedData.endDate, new Date()
    ),
  }
  const purchaseUserId = `${purchaseId}_${userId}`;
  const purchaseUserEntity = {
    key: datastore.key([PURCHASE_USER, purchaseUserId]),
    data: [
      { name: 'purchaseId', value: purchaseId },
      { name: 'userId', value: userId },
      { name: 'updateDate', value: new Date() },
    ],
  };

  const transaction = datastore.transaction();
  try {
    await transaction.run();
    transaction.save([purchaseEntity, purchaseUserEntity]);
    await transaction.commit();
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
};

/*const addUser = async () => {

};*/

const updatePurchase = async (logKey, source, productId, token, parsedData) => {
  if (!productId) productId = parsedData.productId;
  if (!productId) throw new Error(`(${logKey}) Invalid productId: ${productId}`);

  const purchaseId = getPurchaseId(logKey, source, token, parsedData.originalOrderId);
  const purchaseKey = datastore.key([PURCHASE, purchaseId]);
  const purchaseEntity = {
    key: purchaseKey,
    data: derivePurchaseEntityData(
      source, productId, parsedData.orderId, token, parsedData.originalOrderId,
      parsedData.status, parsedData.expiryDate, parsedData.endDate, new Date()
    ),
  }

  const transaction = datastore.transaction();
  try {
    await transaction.run();

    const [oldPurchaseEntity] = await transaction.get(purchaseKey);
    if (!oldPurchaseEntity) {
      console.log(`(logKey) Update purchase without existing purchase for purchaseId: ${purchaseId}`);
    }

    transaction.save(purchaseEntity);
    await transaction.commit();
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
};

/*const deletePurchase = async (purchaseId) => {

};*/

const invalidatePurchase = async (
  logKey, source, productId, token, linkedToken, parsedData
) => {
  if (source !== PLAYSTORE) {
    throw new Error(`(${logKey}) Only support PLAYSTORE for now`);
  }
  if (!productId) throw new Error(`(${logKey}) Invalid productId: ${productId}`);

  // Idempotent!

  const oldPurchaseId = getPurchaseId(
    logKey, source, linkedToken, parsedData.originalOrderId
  );
  const oldPurchaseKey = datastore.key([PURCHASE, oldPurchaseId]);

  const purchaseId = getPurchaseId(logKey, source, token, parsedData.originalOrderId);
  const purchaseKey = datastore.key([PURCHASE, purchaseId]);
  const purchaseEntity = {
    key: purchaseKey,
    data: derivePurchaseEntityData(
      source, productId, parsedData.orderId, token, parsedData.originalOrderId,
      parsedData.status, parsedData.expiryDate, parsedData.endDate, new Date()
    ),
  }

  const transaction = datastore.transaction();
  try {
    await transaction.run();

    const query = datastore.createQuery(PURCHASE_USER);
    query.filter('purchaseId', '=', oldPurchaseId);
    const [oldPurchaseUserEntities] = await transaction.runQuery(query);

    const oldPurchaseUserKeys = [], purchaseUserEntities = [];
    for (const entity of oldPurchaseUserEntities) {
      oldPurchaseUserKeys.push(entity[datastore.KEY]);

      const purchaseUserId = `${purchaseId}_${entity.userId}`;
      const purchaseUserEntity = {
        key: datastore.key([PURCHASE_USER, purchaseUserId]),
        data: [
          { name: 'purchaseId', value: purchaseId },
          { name: 'userId', value: entity.userId },
          { name: 'updateDate', value: new Date() },
        ],
      };
      purchaseUserEntities.push(purchaseUserEntity);
    }

    transaction.delete([oldPurchaseKey, ...oldPurchaseUserKeys]);
    transaction.save([purchaseEntity, ...purchaseUserEntities]);

    await transaction.commit();
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
};

const getPurchase = async (logKey, source, token, originalOrderId) => {
  const purchaseId = getPurchaseId(logKey, source, token, originalOrderId);
  const purchaseKey = datastore.key([PURCHASE, purchaseId]);

  const transaction = datastore.transaction({ readOnly: true });
  try {
    await transaction.run();

    const [purchaseEntity] = await transaction.get(purchaseKey);

    const query = datastore.createQuery(PURCHASE_USER);
    query.filter('purchaseId', '=', purchaseId);
    const [purchaseUserEntities] = await transaction.runQuery(query);

    await transaction.commit();

    if (!purchaseEntity) return null;

    const userIds = [];
    for (const entity of purchaseUserEntities) {
      if (userIds.includes(entity.userId)) continue;
      userIds.push(entity.userId);
    }

    return { ...derivePurchaseData(purchaseEntity), userIds };
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
};

const getPurchases = async (userId) => {
  const transaction = datastore.transaction({ readOnly: true });
  try {
    await transaction.run();

    const query = datastore.createQuery(PURCHASE_USER);
    query.filter('userId', '=', userId);
    const [purchaseUserEntities] = await transaction.runQuery(query);

    const purchaseIds = [];
    for (const entity of purchaseUserEntities) {
      if (purchaseIds.includes(entity.purchaseId)) continue;
      purchaseIds.push(entity.purchaseId);
    }
    const purchaseKeys = purchaseIds.map(id => datastore.key([PURCHASE, id]));
    const [purchaseEntities] = await transaction.get(purchaseKeys);

    await transaction.commit();

    return purchaseEntities.map(purchaseEntity => derivePurchaseData(purchaseEntity));
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
};

/*const getExpiredSubscriptions = () => new Promise((resolve, reject) => {
  const query = datastore.createQuery(PURCHASE);
  query.filter('expiryDate', '<', new Date());
  query.filter('status', '=', ACTIVE);
  query.limit(800);
  datastore.runQuery(query, (err, entities) => {
    if (err) reject(err);
    else resolve(entities)
  });
});

const expireSubscriptions = async () => {
  const expiredSubscription = await getExpiredSubscriptions();

};*/

const derivePurchaseEntityData = (
  source, productId, orderId, token, originalOrderId, status,
  expiryDate, endDate, updateDate,
) => {
  return [
    { name: 'source', value: source },
    { name: 'productId', value: productId },
    { name: 'orderId', value: orderId },
    { name: 'token', value: token },
    { name: 'originalOrderId', value: originalOrderId },
    { name: 'status', value: status },
    { name: 'expiryDate', value: expiryDate },
    { name: 'endDate', value: endDate },
    { name: 'updateDate', value: updateDate },
  ];
};

const derivePurchaseData = (purchaseEntity) => {
  return {
    source: purchaseEntity.source,
    productId: purchaseEntity.productId,
    orderId: purchaseEntity.orderId,
    token: purchaseEntity.token,
    originalOrderId: purchaseEntity.originalOrderId,
    status: purchaseEntity.status,
    expiryDate: purchaseEntity.expiryDate,
    endDate: purchaseEntity.endDate,
    updateDate: purchaseEntity.updateDate,
  };
};

const parseData = (logKey, source, data) => {
  // Parse verifyData or notifyData to parsedData
  const parsedData = {};
  if (source === APPSTORE) {
    // expireDate does not change if the subscription is cancelled or goes into a grace period. It only changes if the subscription gets renewed or restored.
    // currentEndDate is a date that is calculated for you by evaluating the expires date, if there was a cancellation stopping the subscription early, or if the subscription is in a grace period and you should extend access.
    // currentEndDate is expireDate excluding grace period, then in grace period, it'll be changed to gracePeriodExpireDate
    parsedData.productId = data.currentProductId;
    parsedData.orderId = data.latestExpireDateTransaction.transactionId;
    parsedData.originalOrderId = data.originalTransactionId;
    parsedData.status = parseStatus(logKey, source, data);
    parsedData.expiryDate = data.expireDate;
    parsedData.endDate = data.currentEndDate;
  } else if (source === PLAYSTORE) {
    // expiryDate is already included grace period
    const expiryDate = new Date(parseInt(data.expiryTimeMillis || '0', 10));

    parsedData.productId = null;
    parsedData.orderId = data.orderId;
    parsedData.originalOrderId = null;
    parsedData.status = parseStatus(logKey, source, data);
    parsedData.expiryDate = expiryDate;
    parsedData.endDate = expiryDate;
  } else throw new Error(`(${logKey}) Invalid source: ${source}`);

  const now = Date.now();
  const endDT = parsedData.endDate.getTime();
  if (now <= endDT && ![ACTIVE, NO_RENEW, GRACE].includes(parsedData.status)) {
    console.log(`(logKey) Found future endDate with inconsistent status: ${parsedData.status}`);
  }
  if (now > endDT && ![ON_HOLD, PAUSED, EXPIRED].includes(parsedData.status)) {
    console.log(`(logKey) Found past endDate with inconsistent status: ${parsedData.status}`);
  }

  return parsedData;
};

const parseStatus = (logKey, source, data) => {
  const now = Date.now();

  // NO_RENEW or EXPIRED can have several reasons: user cancel, charge back/refund, system/admin revoke, billing issue, payment issue and give up trying, Customer did not agree to price increase, Product not available for purchase, Unknown error
  if (source === APPSTORE) {
    // https://levibostian.github.io/dollabill-apple/api/globals.html#autorenewablesubscriptionstatus
    const endDT = data.currentEndDate.getTime();

    if (data.status === 'active' && data.willAutoRenew) {
      return ACTIVE;
    } else if (data.status === 'active' && !data.willAutoRenew) {
      return NO_RENEW;
    } else if (data.status === 'grace_period') {
      return GRACE
    } else if (now > endDT && data.status === 'billing_retry_period') {
      return ON_HOLD;
    } else if (now > endDT && (
      data.status === 'voluntary_cancel' ||
      data.status === 'involuntary_cancel' ||
      data.status === 'refunded' ||
      data.status === 'upgraded'
    )) {
      return EXPIRED;
    }

    console.log(`(logKey) Unknown status`);
    return UNKNOWN;
  } else if (source === PLAYSTORE) {
    // https://developer.android.com/google/play/billing/subscriptions
    // paymentState: 0. Payment pending 1. Payment received 2. Free trial 3. Pending deferred upgrade/downgrade
    const expiryDT = parseInt(data.expiryTimeMillis || '0', 10);
    const isPaymentState123 = [1, 2, 3].includes(data.paymentState);

    if (now <= expiryDT && isPaymentState123 && data.autoRenewing) {
      return ACTIVE;
    } else if (now <= expiryDT && isPaymentState123 && !data.autoRenewing) {
      return NO_RENEW;
    } else if (now <= expiryDT && data.paymentState === 0 && data.autoRenewing) {
      return GRACE;
    } else if (now > expiryDT && data.paymentState === 0 && data.autoRenewing) {
      return ON_HOLD;
    } else if (now > expiryDT && isPaymentState123 && data.autoRenewing) {
      return PAUSED;
    } else if (now > expiryDT && !data.autoRenewing) {
      return EXPIRED;
    }

    console.log(`(logKey) Unknown status`);
    return UNKNOWN;
  } else throw new Error(`(${logKey}) Invalid source: ${source}`);
};

const getPurchaseId = (logKey, source, token, originalOrderId) => {
  if (source === APPSTORE) return `${source}_${originalOrderId}`;
  if (source === PLAYSTORE) return `${source}_${token}`;
  throw new Error(`(${logKey}) Invalid source: ${source}`);
};

const data = {
  saveVerifyLog, saveNotifyLog, saveAcknowledgeLog,
  addPurchase, updatePurchase, invalidatePurchase, getPurchase, getPurchases,
  parseData,
};

export default data;
