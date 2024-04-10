import appstore from './appstore';
import playstore from './playstore';
import paddle from './paddle';
import dataApi from './data';
import { getPurchases, doIgnorePurchase } from './file';
import { APPSTORE, PLAYSTORE, PADDLE, VALID, EXPIRED, UNKNOWN } from './const';
import { randomString } from './utils';

const _reverify = async (logKey, purchase) => {
  const { source, productId, token, paddleUserId, originalOrderId } = purchase;

  if (source === APPSTORE) {
    if (!token) {
      console.log(`(${logKey}) Found no token for purchase: ${purchase}`);
      return;
    }

    const verifyResult = await appstore.verifySubscription(
      logKey, null, productId, token,
    );

    const { status, latestReceipt, verifyData } = verifyResult;
    if (status !== VALID) {
      console.log(`(${logKey}) Found invalid status: ${status} for purchase: ${purchase}`);
      return;
    }

    const parsedData = dataApi.parseData(logKey, APPSTORE, verifyData);
    await dataApi.updatePurchase(
      logKey, APPSTORE, productId, latestReceipt, parsedData,
    );
    console.log(`(${logKey}) Saved to Datastore`);
  } else if (source === PLAYSTORE) {
    const verifyResult = await playstore.verifySubscription(
      logKey, null, productId, token,
    );

    const { status, verifyData } = verifyResult;
    if (status !== VALID) {
      console.log(`(${logKey}) Found invalid status: ${status} for purchase: ${purchase}`);
      return;
    }

    const parsedData = dataApi.parseData(logKey, PLAYSTORE, verifyData);
    if (verifyData.linkedPurchaseToken) {
      await dataApi.invalidatePurchase(
        logKey, PLAYSTORE, productId, token, verifyData.linkedPurchaseToken, parsedData,
      );
      console.log(`(${logKey}) Called invalidatePurchase instead of updatePurchase`);
    } else {
      await dataApi.updatePurchase(
        logKey, PLAYSTORE, productId, token, parsedData,
      );
    }
    console.log(`(${logKey}) Saved to Datastore`);
  } else if (source === PADDLE) {
    // We want to reverify a specific purchase,
    //   but paddle.verifySubscription needs to start with paddleUserId
    //   and return the latest subscription
    //   so we speicify the subscription id (originalOrderId) we want to reverify here.
    const specificSubscriptionId = parseInt(originalOrderId, 10);
    const verifyResult = await paddle.verifySubscription(
      logKey, null, productId, token, paddleUserId, [specificSubscriptionId],
    );

    const { status, verifyData } = verifyResult;
    if (status !== VALID) {
      console.log(`(${logKey}) Found invalid status: ${status} for purchase: ${purchase}`);
      return;
    }

    const parsedData = dataApi.parsePartialData(logKey, source, verifyData);
    await dataApi.updatePartialPurchase(
      logKey, PADDLE, null, null, null, parsedData
    );
    console.log(`(${logKey}) Saved to Datastore`);
  } else {
    console.log(`(${logKey}) Found invalid source: ${source}`);
  }
};

const reverify = async () => {
  const logKey = randomString(12);
  console.log(`(${logKey}) reverify starts`);

  const purchaseFpath = process.argv[2];
  const purchaseUserFpath = process.argv[3];

  const purchases = await getPurchases(purchaseFpath, purchaseUserFpath, false);

  const date = new Date();
  for (const purchase of purchases) {
    const { status, endDate } = purchase;

    if (doIgnorePurchase(purchase) || status === EXPIRED) continue;

    if (endDate.getTime() < date.getTime() || status === UNKNOWN) {
      console.log('Found obsolete status:', purchase);
      await _reverify(logKey, purchase);
    }
  }
};

reverify();
