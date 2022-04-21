import { Datastore } from '@google-cloud/datastore';

import {
  VERIFY_LOG, NOTIFY_LOG, ACKNOWLEDGE_LOG, PURCHASE, PURCHASE_USER, APPSTORE, PLAYSTORE,
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
    { name: 'updateDT', value: Date.now() },
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
    { name: 'updateDT', value: Date.now() },
  ];
  await datastore.save({ key: datastore.key([NOTIFY_LOG]), data: logData });
};

const saveAcknowledgeLog = () => {

};

/*const saveAskLog = async () => {
  // Columns: userId, purchaseId, status, askId, responseId, updateDT
};*/

const addPurchase = async (logKey, source, userId, productId, token, parsedData) => {
  // Purchase's columns: source, orderId, productId, token, status, expiryDate, endDate, updateDT
  // User's columns: purchaseId, userId
  // Not now columns: purchaseDate, startDate, trialPeriod, gracePeriod
  // status: pending, active, active and cancel auto, grace period, active and charge fail

  const purchaseId = `${source}_${parsedData.orderId}`;
  const purchaseKey = datastore.key([PURCHASE, purchaseId]);
  const purchaseEntity = {
    key: purchaseKey,
    data: derivePurchaseEntityData(
      source, parsedData.orderId, productId, token, parsedData.status,
      parsedData.expiryDate, parsedData.endDate, Date.now()
    ),
  }
  const purchaseUserId = `${purchaseId}_${userId}`;
  const purchaseUserEntity = {
    key: datastore.key([PURCHASE_USER, purchaseUserId]),
    data: [
      { name: 'purchaseId', value: purchaseId },
      { name: 'userId', value: userId },
      { name: 'updateDT', value: Date.now() },
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
  if (!productId) throw new Error(`Invalid productId: ${productId}`);

  const purchaseId = `${source}_${parsedData.orderId}`;
  const purchaseKey = datastore.key([PURCHASE, purchaseId]);
  const purchaseEntity = {
    key: purchaseKey,
    data: derivePurchaseEntityData(
      source, parsedData.orderId, productId, token, parsedData.status,
      parsedData.expiryDate, parsedData.endDate, Date.now()
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
  logKey, oldSource, oldOrderId, source, productId, token, parsedData
) => {
  const oldPurchaseId = `${oldSource}_${oldOrderId}`;
  const oldPurchaseKey = datastore.key([PURCHASE, oldPurchaseId]);

  const purchaseId = `${source}_${parsedData.orderId}`;
  const purchaseKey = datastore.key([PURCHASE, purchaseId]);
  const purchaseEntity = {
    key: purchaseKey,
    data: derivePurchaseEntityData(
      source, parsedData.orderId, productId, token, parsedData.status,
      parsedData.expiryDate, parsedData.endDate, Date.now()
    ),
  }

  const transaction = datastore.transaction();
  try {
    await transaction.run();

    const query = datastore.createQuery(PURCHASE_USER);
    query.filter('purchaseId', oldPurchaseId);
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
          { name: 'updateDT', value: Date.now() },
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

const getPurchase = async (source, orderId) => {
  const purchaseId = `${source}_${orderId}`;
  const purchaseKey = datastore.key([PURCHASE, purchaseId]);

  const transaction = datastore.transaction({ readOnly: true });
  try {
    await transaction.run();

    const [purchaseEntity] = await transaction.get(purchaseKey);

    const query = datastore.createQuery(PURCHASE_USER);
    query.filter('purchaseId', purchaseId);
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
    query.filter('userId', userId);
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
  query.filter('expiryDT<', Date.now());
  query.filter('status', ACTIVE);
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
  source, orderId, productId, token, status, expiryDate, endDate, updateDT,
) => {
  return [
    { name: 'source', value: source },
    { name: 'orderId', value: orderId },
    { name: 'productId', value: productId },
    { name: 'token', value: token },
    { name: 'status', value: status },
    { name: 'expiryDate', value: expiryDate },
    { name: 'endDate', value: endDate },
    { name: 'updateDT', value: updateDT },
  ];
};

const derivePurchaseData = (purchaseEntity) => {
  return {
    source: purchaseEntity.source,
    orderId: purchaseEntity.orderId,
    productId: purchaseEntity.productId,
    token: purchaseEntity.token,
    status: purchaseEntity.status,
    expiryDate: purchaseEntity.expiryDate,
    endDate: purchaseEntity.endDate,
    updateDT: purchaseEntity.updateDT,
  };
};

const parseData = (logKey, source, data) => {
  // Parse verifyData or notifyData to parsedData
  const parsedData = {};
  if (source === APPSTORE) {
    parsedData.productId = data.currentProductId;
    parsedData.orderId = data.originalTransactionId;


    parsedData.status = data.status;



    parsedData.expiryDate = data.expireDate;
    parsedData.endData = data.currentEndDate;
  } else if (source === PLAYSTORE) {
    // If a subscription suffix is present (..#) extract the orderId.
    let orderId = data.orderId;
    const orderIdMatch = /^(.+)?[.]{2}[0-9]+$/g.exec(orderId);
    if (orderIdMatch) orderId = orderIdMatch[1];
    console.log(`(logKey) Order id: ${data.orderId} has a suffix, new order id: ${orderId}`);

    parsedData.productId = null;
    parsedData.orderId = orderId;


    parsedData.status = data.paymentState;


    parsedData.expiryDate = parseInt(data.expiryTimeMillis ?? "0", 10);

  } else throw new Error(`Invalid source: ${source}`);

  return parsedData;
};

const parseStatus = (logKey, source, data) => {
  if (source === APPSTORE) {

  } else if (source === PLAYSTORE) {

  } else throw new Error(`Invalid source: ${source}`);
};

const data = {
  saveVerifyLog, saveNotifyLog, saveAcknowledgeLog,
  addPurchase, updatePurchase, invalidatePurchase, getPurchase, getPurchases,
  parseData,
};

export default data;
