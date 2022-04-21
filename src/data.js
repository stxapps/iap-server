import { Datastore } from '@google-cloud/datastore';

import { VERIFY_LOG, NOTIFY_LOG, ACKNOWLEDGE_LOG, PURCHASE, USER } from './const';

const datastore = new Datastore();

const saveVerifyLog = async (logKey, source, userId, productId, token, verifyData) => {
  const logData = [
    { name: 'logKey', value: logKey },
    { name: 'source', value: source },
    { name: 'userId', value: userId },
    { name: 'productId', value: productId },
    { name: 'token', value: token },
    { name: 'verifyData', value: JSON.stringify(verifyData), excludeFromIndexes: true },
    { name: 'updateDT', value: Date.now() },
  ];
  await datastore.save({ key: datastore.key([VERIFY_LOG]), data: logData });
};

const saveNotifyLog = async (logKey, source, token, notifyData) => {
  const logData = [
    { name: 'logKey', value: logKey },
    { name: 'source', value: source },
    { name: 'token', value: token },
    { name: 'notifyData', value: notifyData, excludeFromIndexes: true },
    { name: 'updateDT', value: Date.now() },
  ];
  await datastore.save({ key: datastore.key([NOTIFY_LOG]), data: logData });
};

const saveAcknowledgeLog = () => {

};

/*const saveAskLog = async () => {
  // Columns: userId, purchaseId, status, askId, responseId, updateDT
};*/

const addPurchase = async (logKey, source, userId, productId, token, verifyData) => {
  // Purchase's key: ${source}_${orderId}?
  // Purchase's key: auto-generated id from allocateIds?
  // Purchase's columns: productId, source, token, status, purchaseDate, expiryDate, trialPeriod, gracePeriod, startDate, endDate, updateDT
  // User's columns: purchaseId, userId
  // status: active, active and cancel auto, grace period, active and charge fail

  const purchaseId = `${source}_${verifyData.orderId}`;
  const purchaseEntity = {
    key: datastore.key([PURCHASE, purchaseId]),
    data: [
      { name: 'source', value: source },
      { name: 'productId', value: productId },
      { name: 'token', value: token },
      { name: 'status', value: verifyData.status },

      { name: 'updateDT', value: Date.now() },
    ]
  }
  const userEntity = {
    key: datastore.key([USER]),
    data: [
      { name: 'purchaseId', value: purchaseId },
      { name: 'userId', value: userId },
    ],
  };

  const transaction = datastore.transaction();
  try {
    await transaction.run();
    transaction.save([purchaseEntity, userEntity]);
    await transaction.commit();
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
};

/*const addUser = async () => {

};*/

const updatePurchase = async (logKey, source, verifyData) => {
  const purchaseId = `${source}_${verifyData.orderId}`;
  const [purchaseEntity] = await datastore.get(datastore.key([PURCHASE, purchaseId]));

  const purchaseData = [
    { name: 'source', value: purchaseEntity.source },
    { name: 'productId', value: purchaseEntity.productId },
    { name: 'token', value: purchaseEntity.token },
    { name: 'status', value: verifyData.status },

    { name: 'updateDT', value: Date.now() },
  ];

  await datastore.save({ key: purchaseEntity[datastore.KEY], data: purchaseData });
};

/*const deletePurchase = async (purchaseId) => {

};*/

const invalidatePurchase = async (
  oldSource, oldOrderId, source, productId, token, verifyData
) => {
  const oldPurchaseId = `${oldSource}_${oldOrderId}`;
  const oldPurchaseKey = datastore.key([PURCHASE, oldPurchaseId]);

  const purchaseId = `${source}_${verifyData.orderId}`;
  const purchaseEntity = {
    key: datastore.key([PURCHASE, purchaseId]),
    data: [
      { name: 'source', value: source },
      { name: 'productId', value: productId },
      { name: 'token', value: token },
      { name: 'status', value: verifyData.status },

      { name: 'updateDT', value: Date.now() },
    ]
  }

  const transaction = datastore.transaction();
  try {
    await transaction.run();

    const query = datastore.createQuery(USER);
    query.filter('purchaseId', oldPurchaseId);
    const [oldUserEntities] = await transaction.runQuery(query);

    const oldUserKeys = oldUserEntities.map(entity => entity[datastore.KEY]);
    const userEntities = oldUserEntities.map(entity => {
      return {
        key: datastore.key([USER]),
        data: [
          { name: 'purchaseId', value: purchaseId },
          { name: 'userId', value: entity.userId },
        ],
      };
    });

    transaction.delete([oldPurchaseKey, ...oldUserKeys]);
    transaction.save([purchaseEntity, ...userEntities]);

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

    const query = datastore.createQuery(USER);
    query.filter('purchaseId', purchaseId);
    const [userEntities] = await transaction.runQuery(query);

    await transaction.commit();

    return {
      ...derivePurchaseData(purchaseEntity),
      userIds: userEntities.map(entity => entity.userId),
    }
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
};

const getPurchases = async (userId) => {
  const transaction = datastore.transaction({ readOnly: true });
  try {
    await transaction.run();

    const query = datastore.createQuery(USER);
    query.filter('userId', userId);
    const [userEntities] = await transaction.runQuery(query);

    const purchaseIds = [];
    for (const userEntity of userEntities) {
      if (purchaseIds.includes(userEntity.purchaseId)) continue;
      purchaseIds.push(userEntity.purchaseId);
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

const derivePurchaseData = (purchaseEntity) => {
  return {
    source: purchaseEntity.source,
    productId: purchaseEntity.productId,
    token: purchaseEntity.token,
    status: purchaseEntity.status,
    updateDT: purchaseEntity.updateDT,
  };
};

const data = {
  saveVerifyLog, saveNotifyLog, saveAcknowledgeLog,
  addPurchase, updatePurchase, invalidatePurchase, getPurchase, getPurchases,
};

export default data;
