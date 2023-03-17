import { Datastore } from '@google-cloud/datastore';

import {
  VERIFY_LOG, NOTIFY_LOG, ACKNOWLEDGE_LOG, PADDLE_PRE, PADDLE, PURCHASE, PURCHASE_EXTRA,
  PURCHASE_PADDLE, PURCHASE_USER, APPSTORE, PLAYSTORE, MANUAL, ACTIVE, NO_RENEW, GRACE,
  ON_HOLD, PAUSED, EXPIRED, UNKNOWN,
} from './const';
import { getAppId, isObject } from './utils';

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

const addPaddlePre = async (logKey, userId, randomId) => {
  const preData = [
    { name: 'userId', value: userId },
    { name: 'randomId', value: randomId },
  ];
  await datastore.save({ key: datastore.key([PADDLE_PRE]), data: preData });
};

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
      parsedData.status, parsedData.expiryDate, parsedData.endDate, date
    ),
  }

  const extraKey = datastore.key([PURCHASE_EXTRA, purchaseId]);
  const extraEntity = {
    key: extraKey, data: derivePurchaseExtraEntityData(date),
  };

  let paddleEntity = null;
  if (source === PADDLE) {
    const paddleKey = datastore.key([PURCHASE_PADDLE, purchaseId]);
    paddleEntity = {
      key: paddleKey,
      data: derivePurchasePaddleEntityData(
        parsedData.paddleUserId, parsedData.passthrough, parsedData.receiptUrl,
        parsedData.updateUrl, parsedData.cancelUrl
      ),
    };
  }

  const purchaseUserId = `${purchaseId}_${userId}`;
  const purchaseUserKey = datastore.key([PURCHASE_USER, purchaseUserId]);
  const purchaseUserEntity = {
    key: purchaseUserKey,
    data: derivePurchaseUserEntitiyData(purchaseId, userId, date),
  };

  const transaction = datastore.transaction();
  try {
    await transaction.run();

    const entities = [purchaseEntity, purchaseUserEntity];

    const [oldExtraEntity] = await transaction.get(extraKey);
    if (!oldExtraEntity) entities.push(extraEntity);

    if (source === PADDLE) entities.push(paddleEntity);

    transaction.save(entities);
    await transaction.commit();
  } catch (e) {
    await transaction.rollback();
    throw e;
  }

  return derivePurchaseDataFromRaw(purchaseEntity, null, paddleEntity);
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

  let paddleEntity = null;
  if (source === PADDLE) {
    const paddleKey = datastore.key([PURCHASE_PADDLE, purchaseId]);
    paddleEntity = {
      key: paddleKey,
      data: derivePurchasePaddleEntityData(
        parsedData.paddleUserId, parsedData.passthrough, parsedData.receiptUrl,
        parsedData.updateUrl, parsedData.cancelUrl
      ),
    };
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

    const entities = [purchaseEntity];
    if (source === PADDLE) entities.push(paddleEntity);

    transaction.save(entities);
    await transaction.commit();
  } catch (e) {
    await transaction.rollback();
    throw e;
  }

  return derivePurchaseDataFromRaw(purchaseEntity, null, paddleEntity);
};

const updatePartialPurchase = async (logKey, source, parsedData) => {
  if (source !== PADDLE) {
    throw new Error(`(${logKey}) Only support PADDLE for now`);
  }

  const { purchaseId, purchaseData } = parsedData;

  const purchaseKey = datastore.key([PURCHASE, purchaseId]);
  const paddleKey = datastore.key([PURCHASE_PADDLE, purchaseId]);

  let purchaseEntity, paddleEntity;

  const transaction = datastore.transaction();
  try {
    await transaction.run();

    const [oldEntities] = await transaction.get([purchaseKey, paddleKey]);
    const [oldPurchaseEntity, oldPaddleEntity] = oldEntities;
    if (!oldPurchaseEntity || !oldPaddleEntity) {
      // not found just return.
      console.log(`(${logKey}) In updatePartialPurchase, not found entities`);
      return;
    }

    const oldPurchase = derivePurchaseData(oldPurchaseEntity, null, oldPaddleEntity);
    const purchase = { ...oldPurchase, ...purchaseData };

    purchaseEntity = {
      key: purchaseKey,
      data: derivePurchaseEntityData(
        purchase.source, purchase.productId, purchase.orderId, purchase.token,
        purchase.originalOrderId, purchase.status, purchase.expiryDate, purchase.endDate,
        new Date()
      ),
    };
    paddleEntity = {
      key: paddleKey,
      data: derivePurchasePaddleEntityData(
        purchase.paddleUserId, purchase.passthrough, purchase.receiptUrl,
        purchase.updateUrl, purchase.cancelUrl
      ),
    };

    transaction.save([purchaseEntity, paddleEntity]);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  return derivePurchaseDataFromRaw(purchaseEntity, null, paddleEntity);
};

const invalidatePurchase = async (
  logKey, source, productId, token, linkedToken, parsedData
) => {
  if (source !== PLAYSTORE) {
    throw new Error(`(${logKey}) Only support PLAYSTORE for now`);
  }
  if (!productId) throw new Error(`(${logKey}) Invalid productId: ${productId}`);

  // Idempotent!

  const date = new Date();

  const oldPurchaseId = getPurchaseId(
    logKey, source, linkedToken, parsedData.originalOrderId
  );
  const oldPurchaseKey = datastore.key([PURCHASE, oldPurchaseId]);
  const oldExtraKey = datastore.key([PURCHASE_EXTRA, oldPurchaseId]);

  const purchaseId = getPurchaseId(logKey, source, token, parsedData.originalOrderId);
  const purchaseKey = datastore.key([PURCHASE, purchaseId]);
  const extraKey = datastore.key([PURCHASE_EXTRA, purchaseId]);

  const purchaseEntity = {
    key: purchaseKey,
    data: derivePurchaseEntityData(
      source, productId, parsedData.orderId, token, parsedData.originalOrderId,
      parsedData.status, parsedData.expiryDate, parsedData.endDate, date
    ),
  }

  const transaction = datastore.transaction();
  try {
    await transaction.run();

    const oldKeys = [oldPurchaseKey];
    const entities = [purchaseEntity];

    const [oldExtraEntity] = await transaction.get(oldExtraKey);
    if (oldExtraEntity) {
      const extraEntity = {
        key: extraKey, data: derivePurchaseExtraEntityData(oldExtraEntity.createDate),
      }

      oldKeys.push(oldExtraKey);
      entities.push(extraEntity);
    }

    const query = datastore.createQuery(PURCHASE_USER);
    query.filter('purchaseId', '=', oldPurchaseId);
    const [oldPurchaseUserEntities] = await transaction.runQuery(query);

    for (const entity of oldPurchaseUserEntities) {
      oldKeys.push(entity[datastore.KEY]);

      const purchaseUserId = `${purchaseId}_${entity.userId}`;
      const purchaseUserKey = datastore.key([PURCHASE_USER, purchaseUserId]);
      const purchaseUserEntity = {
        key: purchaseUserKey,
        data: derivePurchaseUserEntitiyData(purchaseId, entity.userId, date),
      };
      entities.push(purchaseUserEntity);
    }

    transaction.delete(oldKeys);
    transaction.save(entities);
    await transaction.commit();
  } catch (e) {
    await transaction.rollback();
    throw e;
  }

  return derivePurchaseDataFromRaw(purchaseEntity);
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

    const paddleIds = [];
    for (const entity of purchaseEntities) {
      if (entity.source === PADDLE) {
        const paddleId = entity[datastore.KEY].name;
        if (!paddleIds.includes(paddleId)) paddleIds.push(paddleId);
      }
    }
    const paddleKeys = paddleIds.map(id => datastore.key([PURCHASE_PADDLE, id]));

    let paddleEntities = [];
    if (paddleKeys.length > 0) {
      [paddleEntities] = await transaction.get(paddleKeys);
    }

    await transaction.commit();

    // Bug Alert: No PurchaseExtra, no createDate!
    return formPurchaseData(purchaseEntities, null, paddleEntities);
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

    const purchaseIds = [], paddleIds = [];
    for (const entity of purchaseEntities) {
      const purchaseId = entity[datastore.KEY].name;
      if (!purchaseIds.includes(purchaseId)) purchaseIds.push(purchaseId);
      if (entity.source === PADDLE) {
        if (!paddleIds.includes(purchaseId)) paddleIds.push(purchaseId);
      }
    }
    const extraKeys = purchaseIds.map(id => datastore.key([PURCHASE_EXTRA, id]));
    const paddleKeys = paddleIds.map(id => datastore.key([PURCHASE_PADDLE, id]));

    let extraEntities = [];
    if (extraKeys.length > 0) {
      [extraEntities] = await transaction.get(extraKeys);
    }

    let paddleEntities = [];
    if (paddleKeys.length > 0) {
      [paddleEntities] = await transaction.get(paddleKeys);
    }

    await transaction.commit();

    return formPurchaseData(purchaseEntities, extraEntities, paddleEntities);
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
};

const getUpdatedPurchaseUsers = async (updateDate) => {
  const transaction = datastore.transaction({ readOnly: true });
  try {
    await transaction.run();

    const query = datastore.createQuery(PURCHASE_USER);
    query.filter('updateDate', '>=', updateDate);
    query.limit(800);
    const [entities] = await transaction.runQuery(query);

    await transaction.commit();

    return entities.map(entity => derivePurchaseUserData(entity));
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
};

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

const derivePurchaseExtraEntityData = (createDate) => {
  return [
    { name: 'createDate', value: createDate },
  ];
};

const derivePurchasePaddleEntityData = (
  paddleUserId, passthrough, receiptUrl, updateUrl, cancelUrl
) => {
  return [
    { name: 'paddleUserId', value: paddleUserId },
    { name: 'passthrough', value: passthrough },
    { name: 'receiptUrl', value: receiptUrl },
    { name: 'updateUrl', value: updateUrl },
    { name: 'cancelUrl', value: cancelUrl },
  ];
};

const derivePurchaseUserEntitiyData = (purchaseId, userId, updateDate) => {
  return [
    { name: 'purchaseId', value: purchaseId },
    { name: 'userId', value: userId },
    { name: 'updateDate', value: updateDate },
  ];
};

const derivePurchaseData = (
  purchaseEntity, extraEntity = null, paddleEntity = null
) => {
  // Derive purchase data from queried purchase entity
  const purchase = {
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

  if (isObject(extraEntity)) {
    purchase.createDate = extraEntity.createDate;
  }

  if (isObject(paddleEntity)) {
    purchase.paddleUserId = paddleEntity.paddleUserId;
    purchase.passthrough = paddleEntity.passthrough;
    purchase.receiptUrl = paddleEntity.receiptUrl;
    purchase.updateUrl = paddleEntity.updateUrl;
    purchase.cancelUrl = paddleEntity.cancelUrl;
  }

  return purchase;
};

const derivePurchaseDataFromRaw = (
  purchaseEntity, extraEntity = null, paddleEntity = null
) => {
  // Derive purchase data from raw purchase entity
  const data = purchaseEntity.data;
  const purchase = {
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

  if (isObject(extraEntity)) {
    purchase.createDate = extraEntity.data[0].value;
  }

  if (isObject(paddleEntity)) {
    purchase.paddleUserId = paddleEntity.data[0].value;
    purchase.passthrough = paddleEntity.data[1].value;
    purchase.receiptUrl = paddleEntity.data[2].value;
    purchase.updateUrl = paddleEntity.data[3].value;
    purchase.cancelUrl = paddleEntity.data[4].value;
  }

  return purchase;
};

const formPurchaseData = (purchaseEntities, extraEntities, paddleEntities) => {
  const extraMap = {};
  if (Array.isArray(extraEntities)) {
    for (const entity of extraEntities) {
      extraMap[entity[datastore.KEY].name] = entity;
    }
  }

  const paddleMap = {};
  if (Array.isArray(paddleEntities)) {
    for (const entity of paddleEntities) {
      paddleMap[entity[datastore.KEY].name] = entity;
    }
  }

  const purchases = [];
  for (const entity of purchaseEntities) {
    const purchaseId = entity[datastore.KEY].name;

    let extraEntity = null, paddleEntity = null;
    if (purchaseId in extraMap) extraEntity = extraMap[purchaseId];
    if (purchaseId in paddleMap) paddleEntity = paddleMap[purchaseId];
    purchases.push(derivePurchaseData(entity, extraEntity, paddleEntity));
  }

  return purchases;
};

const derivePurchaseUserData = (purchaseUserEntity) => {
  return {
    purchaseId: purchaseUserEntity.purchaseId,
    userId: purchaseUserEntity.userId,
    updateDate: purchaseUserEntity.updateDate,
  };
};

const _validateStatus = (logKey, endDate, status) => {
  const now = Date.now();
  const endDT = endDate.getTime();
  if (now <= endDT && ![ACTIVE, NO_RENEW, GRACE].includes(status)) {
    console.log(`(${logKey}) Found future endDate with inconsistent status: ${status}`);
  }
  if (now > endDT && ![ON_HOLD, PAUSED, EXPIRED].includes(status)) {
    console.log(`(${logKey}) Found past endDate with inconsistent status: ${status}`);
  }
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
  } else if (source === PADDLE) {
    const expiryDate = new Date(data.payment.payoutDT);

    parsedData.productId = data.productId;
    parsedData.orderId = data.order_id + '';
    parsedData.originalOrderId = data.subscription.subscription_id + '';
    parsedData.status = parseStatus(logKey, source, data);
    parsedData.expiryDate = expiryDate;
    parsedData.endDate = expiryDate;
    parsedData.paddleUserId = data.user.user_id + '';
    parsedData.passthrough = data.passthrough;
    parsedData.receiptUrl = data.receipt_url;
    parsedData.updateUrl = null;
    parsedData.cancelUrl = null;
  } else throw new Error(`(${logKey}) Invalid source: ${source}`);

  _validateStatus(logKey, parsedData.endDate, parsedData.status);

  return parsedData;
};

const parsePartialData = (logKey, source, data) => {
  // Parse verifyData or notifyData to parsedData
  let purchaseId, purchaseData = {};
  if (source === PADDLE) {
    const originalOrderId = data.subscription.subscription_id + '';
    purchaseId = getPurchaseId(logKey, PADDLE, null, originalOrderId);

    const expiryDate = new Date(data.payment.payoutDT);

    purchaseData.productId = data.productId;
    purchaseData.orderId = data.order_id + '';
    purchaseData.originalOrderId = originalOrderId;
    purchaseData.status = parseStatus(logKey, source, data);
    purchaseData.expiryDate = expiryDate;
    purchaseData.endDate = expiryDate;

    purchaseData.paddleUserId = data.user.user_id + '';
    purchaseData.passthrough = data.passthrough;
    purchaseData.receiptUrl = data.receipt_url;
  } else throw new Error(`(${logKey}) Invalid source: ${source}`);

  _validateStatus(logKey, purchaseData.endDate, purchaseData.status);

  return { purchaseId, purchaseData };
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
  } else if (source === PADDLE) {
    if (['active', 'trialing'].includes(data.subscription.status)) {
      if (data.payment.payoutDT < now) return NO_RENEW;
      return ACTIVE;
    } else if (data.subscription.status === 'past_due') {
      return GRACE;
    } else if (data.subscription.status === 'deleted') {
      return EXPIRED;
    }

    console.log(`(${logKey}) Unknown status`);
    return UNKNOWN;
  } else throw new Error(`(${logKey}) Invalid source: ${source}`);
};

const getPurchaseId = (logKey, source, token, originalOrderId) => {
  if (source === APPSTORE) return `${source}_${originalOrderId}`;
  if (source === PLAYSTORE) return `${source}_${token}`;
  if (source === PADDLE) return `${source}_${originalOrderId}`;
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
  saveVerifyLog, saveNotifyLog, saveAcknowledgeLog, addPaddlePre, addPurchase,
  updatePurchase, updatePartialPurchase, invalidatePurchase, getPurchases,
  getUpdatedPurchases, getUpdatedPurchaseUsers, deleteAll, parseData, parsePartialData,
  parseStatus, getPurchaseId, filterPurchases,
};

export default data;
