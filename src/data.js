import { Datastore } from '@google-cloud/datastore';

import {
  VERIFY_LOG, NOTIFY_LOG, ACKNOWLEDGE_LOG, PURCHASE, PURCHASE_EXTRA, PURCHASE_USER,
  APPSTORE, PLAYSTORE, MANUAL, ACTIVE, NO_RENEW, GRACE, ON_HOLD, PAUSED, EXPIRED,
  UNKNOWN,
} from './const';
import { getAppId } from './utils';

const datastore = new Datastore();

const saveVerifyLog = async (
  logKey, source, userId, productId, token, verifyResult,
) => {
  const logData = [
    { name: 'logKey', value: logKey },
    { name: 'source', value: source },
    { name: 'userId', value: userId },
    { name: 'productId', value: productId },
    { name: 'token', value: token, excludeFromIndexes: true },
    {
      name: 'verifyResult',
      value: JSON.stringify(verifyResult),
      excludeFromIndexes: true,
    },
    { name: 'updateDate', value: new Date() },
  ];
  await datastore.save({ key: datastore.key([VERIFY_LOG]), data: logData });
};

const saveNotifyLog = async (logKey, source, token, originalOrderId, notifyResult) => {
  const logData = [
    { name: 'logKey', value: logKey },
    { name: 'source', value: source },
    { name: 'token', value: token, excludeFromIndexes: true },
    { name: 'originalOrderId', value: originalOrderId },
    {
      name: 'notifyResult',
      value: JSON.stringify(notifyResult),
      excludeFromIndexes: true,
    },
    { name: 'updateDate', value: new Date() },
  ];
  await datastore.save({ key: datastore.key([NOTIFY_LOG]), data: logData });
};

const saveAcknowledgeLog = async (
  logKey, userId, productId, token, acknowledgeState, paymentState, acknowledgeResult,
) => {
  const logData = [
    { name: 'logKey', value: logKey },
    { name: 'userId', value: userId },
    { name: 'productId', value: productId },
    { name: 'token', value: token, excludeFromIndexes: true },
    { name: 'acknowledgeState', value: acknowledgeState },
    { name: 'paymentState', value: paymentState },
    { name: 'acknowledgeResult', value: acknowledgeResult },
    { name: 'updateDate', value: new Date() },
  ];
  await datastore.save({ key: datastore.key([ACKNOWLEDGE_LOG]), data: logData });
};

/*const saveAskLog = async () => {
  // Columns: userId, purchaseId, status, askId, responseId, updateDate
};*/

const addPurchase = async (logKey, source, userId, productId, token, parsedData) => {
  // Purchase's columns: source, productId, orderId, token, status, expiryDate, endDate, updateDate
  // User's columns: purchaseId, userId
  // Not now columns: purchaseDate, startDate, trialPeriod, gracePeriod
  const date = new Date();

  const purchaseId = getPurchaseId(logKey, source, token, parsedData.originalOrderId);
  const purchaseKey = datastore.key([PURCHASE, purchaseId]);
  const purchaseEntity = {
    key: purchaseKey,
    data: derivePurchaseEntityData(
      source, productId, parsedData.orderId, token, parsedData.originalOrderId,
      parsedData.status, parsedData.expiryDate, parsedData.endDate, new Date()
    ),
  }

  const purchaseExtraKey = datastore.key([PURCHASE_EXTRA, purchaseId]);
  const purchaseExtraEntity = {
    key: purchaseExtraKey,
    data: [
      { name: 'createDate', value: date },
    ],
  };

  const purchaseUserId = `${purchaseId}_${userId}`;
  const purchaseUserKey = datastore.key([PURCHASE_USER, purchaseUserId]);
  const purchaseUserEntity = {
    key: purchaseUserKey,
    data: [
      { name: 'purchaseId', value: purchaseId },
      { name: 'userId', value: userId },
      { name: 'updateDate', value: date },
    ],
  };

  const transaction = datastore.transaction();
  try {
    await transaction.run();

    const [oldPurchaseExtraEntity] = await transaction.get(purchaseExtraKey);
    if (oldPurchaseExtraEntity) {
      transaction.save([purchaseEntity, purchaseUserEntity]);
    } else {
      transaction.save([purchaseEntity, purchaseExtraEntity, purchaseUserEntity]);
    }

    await transaction.commit();
  } catch (e) {
    await transaction.rollback();
    throw e;
  }

  return derivePurchaseDataFromRaw(purchaseEntity);
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
    if (oldPurchaseEntity && oldPurchaseEntity.token) {
      const el = purchaseEntity.data.find(el => el.name === 'token');
      if (!el.value) el.value = oldPurchaseEntity.token;
    } else {
      console.log(`(${logKey}) Update purchase without existing purchase for purchaseId: ${purchaseId}`);
    }

    transaction.save(purchaseEntity);
    await transaction.commit();
  } catch (e) {
    await transaction.rollback();
    throw e;
  }

  return derivePurchaseDataFromRaw(purchaseEntity);
};

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

  return derivePurchaseDataFromRaw(purchaseEntity);
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

const getPurchases = async (logKey, userId) => {
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

    let purchaseEntities = [];
    if (purchaseKeys.length > 0) {
      [purchaseEntities] = await transaction.get(purchaseKeys);
    }

    await transaction.commit();

    return purchaseEntities.map(purchaseEntity => derivePurchaseData(purchaseEntity));
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
};

const getUpdatedPurchases = async (updateDate) => {
  const transaction = datastore.transaction({ readOnly: true });
  try {
    await transaction.run();

    const query = datastore.createQuery(PURCHASE);
    query.filter('updateDate', '>=', updateDate);
    query.limit(800);
    const [purchaseEntities] = await transaction.runQuery(query);

    await transaction.commit();

    return purchaseEntities.map(purchaseEntity => derivePurchaseData(purchaseEntity));
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
};

const getPurchaseExtras = async (ids) => {
  const transaction = datastore.transaction({ readOnly: true });
  try {
    await transaction.run();

    const keys = ids.map(id => datastore.key([PURCHASE_EXTRA, id]));

    let entities = [];
    if (keys.length > 0) {
      [entities] = await transaction.get(keys);
    }

    await transaction.commit();

    return entities.map(entity => derivePurchaseExtraData(entity));
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
};

// Error because no DataStore index found! Use purchases.json locally instead.
/*const getReverifiedPurchases = async () => {
  const transaction = datastore.transaction({ readOnly: true });
  try {
    await transaction.run();

    const purchaseEntities = [];
    for (const status of [ACTIVE, NO_RENEW, GRACE, ON_HOLD, PAUSED, UNKNOWN]) {
      const query = datastore.createQuery(PURCHASE);
      query.filter('status', '=', status);
      query.filter('endDate', '<', new Date());
      query.limit(800);
      const [_purchaseEntities] = await transaction.runQuery(query);
      purchaseEntities.push(..._purchaseEntities);
    }

    await transaction.commit();

    return purchaseEntities.map(purchaseEntity => derivePurchaseData(purchaseEntity));
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
};*/

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

const deleteVerifyLogs = async (logKey, userId, appId) => {
  const transaction = datastore.transaction();
  try {
    await transaction.run();

    const query = datastore.createQuery(VERIFY_LOG);
    query.filter('userId', '=', userId);
    const [verifyLogEntities] = await transaction.runQuery(query);

    const keys = [];
    for (const entity of verifyLogEntities) {
      if (getAppId(entity.productId) === appId) keys.push(entity[datastore.KEY]);
    }

    if (keys.length > 0) transaction.delete(keys);
    await transaction.commit();
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
};

const deleteAcknowledgeLogs = async (logKey, userId, appId) => {
  const transaction = datastore.transaction();
  try {
    await transaction.run();

    const query = datastore.createQuery(ACKNOWLEDGE_LOG);
    query.filter('userId', '=', userId);
    const [ackLogEntities] = await transaction.runQuery(query);

    const keys = [];
    for (const entity of ackLogEntities) {
      if (getAppId(entity.productId) === appId) keys.push(entity[datastore.KEY]);
    }

    if (keys.length > 0) transaction.delete(keys);
    await transaction.commit();
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
};

const deletePurchaseUsers = async (logKey, userId, appId) => {
  const transaction = datastore.transaction();
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

    let purchaseEntities = [];
    if (purchaseKeys.length > 0) {
      [purchaseEntities] = await transaction.get(purchaseKeys);
    }

    const keys = [];
    for (const entity of purchaseUserEntities) {
      const _purchaseEntities = [];
      for (const purchaseEntity of purchaseEntities) {
        const purchaseId = getPurchaseId(
          logKey, purchaseEntity.source, purchaseEntity.token,
          purchaseEntity.originalOrderId,
        );
        if (purchaseId === entity.purchaseId) _purchaseEntities.push(purchaseEntity);
      }

      if (_purchaseEntities.length === 0) {
        console.log(`(${logKey}) Found empty purchases for purchaseId: ${entity.purchaseId} and userId: ${entity.userId}`);
        continue;
      }

      let isSameAppId = true;
      for (const purchaseEntity of _purchaseEntities) {
        if (getAppId(purchaseEntity.productId) !== appId) {
          isSameAppId = false;
          break;
        }
      }
      if (isSameAppId) keys.push(entity[datastore.KEY]);
    }

    if (keys.length > 0) transaction.delete(keys);
    await transaction.commit();
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
};

const deleteAll = async (logKey, userId, appId) => {
  // No delete NotifyLogs as no userId
  // No delete Purchase in case of multiple users
  await deleteVerifyLogs(logKey, userId, appId);
  await deleteAcknowledgeLogs(logKey, userId, appId);
  await deletePurchaseUsers(logKey, userId, appId);
};

const derivePurchaseEntityData = (
  source, productId, orderId, token, originalOrderId, status,
  expiryDate, endDate, updateDate,
) => {
  return [
    { name: 'source', value: source },
    { name: 'productId', value: productId },
    { name: 'orderId', value: orderId },
    { name: 'token', value: token, excludeFromIndexes: true },
    { name: 'originalOrderId', value: originalOrderId },
    { name: 'status', value: status },
    { name: 'expiryDate', value: expiryDate },
    { name: 'endDate', value: endDate },
    { name: 'updateDate', value: updateDate },
  ];
};

const derivePurchaseData = (purchaseEntity) => {
  // Derive purchase data from queried purchase entity
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

const derivePurchaseDataFromRaw = (purchaseEntity) => {
  // Derive purchase data from raw purchase entity
  const data = purchaseEntity.data;
  return {
    source: data[0].value,
    productId: data[1].value,
    orderId: data[2].value,
    token: data[3].value,
    originalOrderId: data[4].value,
    status: data[5].value,
    expiryDate: data[6].value,
    endDate: data[7].value,
    updateDate: data[8].value,
  };
};

const derivePurchaseExtraData = (purchaseExtraEntity) => {
  return {
    keyName: purchaseExtraEntity[datastore.KEY].name,
    createDate: purchaseExtraEntity.createDate,
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
    console.log(`(${logKey}) Found future endDate with inconsistent status: ${parsedData.status}`);
  }
  if (now > endDT && ![ON_HOLD, PAUSED, EXPIRED].includes(parsedData.status)) {
    console.log(`(${logKey}) Found past endDate with inconsistent status: ${parsedData.status}`);
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
    } else if (now <= endDT && data.status === 'grace_period') {
      return GRACE
    } else if (now > endDT && data.status === 'grace_period') {
      return ON_HOLD;
    } else if (now <= endDT && data.status === 'billing_retry_period') {
      return GRACE
    } else if (now > endDT && data.status === 'billing_retry_period') {
      return ON_HOLD;
    } else if (now > endDT && (
      data.status === 'voluntary_cancel' ||
      data.status === 'involuntary_cancel' ||
      data.status === 'refunded' ||
      data.status === 'upgraded' ||
      data.status === 'other_not_active'
    )) {
      return EXPIRED;
    }

    console.log(`(${logKey}) Unknown status`);
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

    console.log(`(${logKey}) Unknown status`);
    return UNKNOWN;
  } else throw new Error(`(${logKey}) Invalid source: ${source}`);
};

const getPurchaseId = (logKey, source, token, originalOrderId) => {
  if (source === APPSTORE) return `${source}_${originalOrderId}`;
  if (source === PLAYSTORE) return `${source}_${token}`;
  if (source === MANUAL) return `${source}_${originalOrderId}`;
  throw new Error(`(${logKey}) Invalid source: ${source}`);
};

const filterPurchases = (logKey, purchases, appId) => {
  // Possible values:
  //   Different apps
  //   Same app with different products
  //   Same products - some expires and some not
  //   Too old products (expire > 60 days), if verify, will get error
  const oldest = Date.now() - (45 * 24 * 60 * 60 * 1000);

  let _purchases = purchases.filter(purchase => {
    return (
      getAppId(purchase.productId) === appId &&
      purchase.endDate.getTime() >= oldest
    );
  });
  _purchases = _purchases.sort((a, b) => {
    return b.endDate.getTime() - a.endDate.getTime();
  });

  const filteredPurchases = [], _productIds = [];
  for (const purchase of _purchases) {
    if (_productIds.includes(purchase.productId)) continue;
    _productIds.push(purchase.productId);
    filteredPurchases.push(purchase);
  }

  return filteredPurchases;
};

const data = {
  saveVerifyLog, saveNotifyLog, saveAcknowledgeLog,
  addPurchase, updatePurchase, invalidatePurchase, getPurchase, getPurchases,
  getUpdatedPurchases, getPurchaseExtras, deleteAll,
  parseData, getPurchaseId, filterPurchases,
};

export default data;
