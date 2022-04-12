const { Datastore } = require('@google-cloud/datastore');

const datastore = new Datastore();
// Purchase table
//  key: ${source}_${orderId}
//  columns: source, orderId, productId, userId, purchaseDT, expiryDT, status


const addVerification = () => {

};

const addNotification = () => {

};

const addAcknowledgement = () => {

};

const updatePurchase = (purchaseData) => {
  const purchaseId = `${purchaseData.iapSource}_${purchaseData.orderId}`;
};

const getExpiredSubscriptions = () => new Promise((resolve, reject) => {
  const query = datastore.createQuery(DATASTORE_KIND);
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

};
