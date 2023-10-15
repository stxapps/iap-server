// Inpired by https://codelabs.developers.google.com/codelabs/flutter-in-app-purchases#8
import express from 'express';
import cors from 'cors';
import { verifyECDSA } from '@stacks/encryption';

import appstore from './appstore';
import playstore from './playstore';
import paddle from './paddle';
import dataApi from './data';
import {
  ALLOWED_ORIGINS, SOURCES, APPSTORE, PLAYSTORE, PADDLE, MANUAL, PRODUCT_IDS, APP_IDS,
  VALID, UNKNOWN, ERROR, SIGNED_TEST_STRING,
} from './const';
import {
  runAsyncWrapper, getReferrer, randomString, removeTailingSlash, isObject, isString,
} from './utils';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const cCorsOptions = {
  'origin': ALLOWED_ORIGINS,
};
const sCorsOptions = {
  'origin': '*',
};

app.get('/', (_req, res) => {
  res.send('Welcome to <a href="https://www.stxapps.com">STX Apps</a>\'s server!');
});

app.options('/verify', cors(cCorsOptions));
app.post('/verify', cors(cCorsOptions), runAsyncWrapper(async (req, res) => {
  const logKey = randomString(12);
  console.log(`(${logKey}) /verify receives a post request`);

  const results = { status: VALID };

  const referrer = getReferrer(req);
  console.log(`(${logKey}) Referrer: ${referrer}`);
  if (!referrer || !ALLOWED_ORIGINS.includes(removeTailingSlash(referrer))) {
    console.log(`(${logKey}) Invalid referrer, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }

  const reqBody = req.body;
  console.log(`(${logKey}) Request body: ${JSON.stringify(reqBody)}`);
  if (!isObject(reqBody)) {
    console.log(`(${logKey}) Invalid reqBody, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }

  const { source, userId, productId, token, paddleUserId } = reqBody;
  if (!SOURCES.includes(source)) {
    console.log(`(${logKey}) Invalid source, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }
  if (!isString(userId)) {
    console.log(`(${logKey}) Invalid userId, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }
  if (!PRODUCT_IDS.includes(productId)) {
    console.log(`(${logKey}) Invalid productId, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }
  if (!isString(token)) {
    console.log(`(${logKey}) Invalid token, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }

  let purchase;
  if (source === APPSTORE) {
    const verifyResult = await appstore.verifySubscription(
      logKey, userId, productId, token,
    );

    const { status, latestReceipt, verifyData } = verifyResult;
    results.status = status;
    if (results.status !== VALID) {
      res.send(JSON.stringify(results));
      return;
    }

    const parsedData = dataApi.parseData(logKey, source, verifyData);
    purchase = await dataApi.addPurchase(
      logKey, source, userId, productId, latestReceipt, parsedData,
    );
    console.log(`(${logKey}) Saved to Datastore`);
  } else if (source === PLAYSTORE) {
    const verifyResult = await playstore.verifySubscription(
      logKey, userId, productId, token,
    );

    const { status, verifyData } = verifyResult;
    results.status = status;
    if (results.status !== VALID) {
      res.send(JSON.stringify(results));
      return;
    }

    const parsedData = dataApi.parseData(logKey, source, verifyData);
    if (verifyData.linkedPurchaseToken) {
      await dataApi.invalidatePurchase(
        logKey, source, productId, token, verifyData.linkedPurchaseToken, parsedData,
      );
      console.log(`(${logKey}) Called invalidatePurchase before addPurchase`);
    }
    purchase = await dataApi.addPurchase(
      logKey, source, userId, productId, token, parsedData,
    );
    console.log(`(${logKey}) Saved to Datastore`);
  } else if (source === PADDLE) {
    if (!isString(paddleUserId)) {
      console.log(`(${logKey}) Invalid paddleUserId, return ERROR`);
      results.status = ERROR;
      res.send(JSON.stringify(results));
      return;
    }

    const verifyResult = await paddle.verifySubscription(
      logKey, userId, productId, token, paddleUserId,
    );

    const { status, verifyData } = verifyResult;
    results.status = status;
    if (results.status !== VALID) {
      res.send(JSON.stringify(results));
      return;
    }

    const parsedData = dataApi.parsePartialData(logKey, source, verifyData);
    purchase = await dataApi.updatePartialPurchase(
      logKey, source, userId, productId, token, parsedData,
    );
    console.log(`(${logKey}) Saved to Datastore`);
  } else throw new Error(`(${logKey}) Invalid source: ${source}`);

  results.purchase = dataApi.getNormalizedPurchase(purchase);

  console.log(`(${logKey}) /verify finished`);
  res.send(JSON.stringify(results));
}));

app.options('/appstore/notify', cors(sCorsOptions));
app.post('/appstore/notify', cors(sCorsOptions), runAsyncWrapper(async (req, res) => {
  const logKey = randomString(12);
  console.log(`(${logKey}) /appstore/notify receives a post request`);

  const reqBody = req.body;
  console.log(`(${logKey}) Request body: ${JSON.stringify(reqBody)}`);
  if (!isObject(reqBody) || !isString(reqBody.signedPayload)) {
    console.log(`(${logKey}) Invalid reqBody, just end`);
    res.status(200).end();
    return;
  }

  let payloadV1;
  try {
    const payloadV2 = await appstore.verifyNotification(logKey, reqBody.signedPayload);
    payloadV1 = appstore.derivePayloadV1(payloadV2);
  } catch (e) {
    console.log(`(${logKey}) Could not verify signedPayload, just end`);
    res.status(200).end();
    return;
  }

  const notifyResult = await appstore.parseNotification(logKey, payloadV1);

  const { status, notifyData } = notifyResult;
  if (status !== VALID) {
    res.status(200).end();
    return;
  }

  const parsedData = dataApi.parseData(logKey, APPSTORE, notifyData);
  await dataApi.updatePurchase(logKey, APPSTORE, null, null, parsedData);
  console.log(`(${logKey}) Saved to Datastore`);

  console.log(`(${logKey}) /appstore/notify finished`);
  res.status(200).end();
}));

app.options('/playstore/notify', cors(sCorsOptions));
app.post('/playstore/notify', cors(sCorsOptions), runAsyncWrapper(async (req, res) => {
  const logKey = randomString(12);
  console.log(`(${logKey}) /playstore/notify receives a post request`);

  const reqBody = req.body;
  console.log(`(${logKey}) Request body: ${JSON.stringify(reqBody)}`);
  if (!isObject(reqBody) || !reqBody.subscription || !isObject(reqBody.message)) {
    console.log(`(${logKey}) Invalid reqBody, just end`);
    res.status(200).end();
    return;
  }

  let data;
  try {
    data = Buffer.from(reqBody.message.data, 'base64').toString('ascii');
    data = JSON.parse(data);
    console.log(`(${logKey}) Notification data: ${JSON.stringify(data)}`);
  } catch (e) {
    console.log(`(${logKey}) Could not parse notification data, just end`);
    res.status(200).end();
    return;
  }

  if (data.testNotification) {
    console.log(`(${logKey}) Found test notification, just end`);
    res.status(200).end();
    return;
  }

  if (!isObject(data.subscriptionNotification)) {
    console.log(`(${logKey}) No or invalid subscriptionNotification, just end`);
    res.status(200).end();
    return;
  }

  const {
    subscriptionId: productId, purchaseToken: token,
  } = data.subscriptionNotification;
  if (!PRODUCT_IDS.includes(productId)) {
    console.log(`(${logKey}) Invalid productId, just end`);
    res.status(200).end();
    return;
  }
  if (!isString(token)) {
    console.log(`(${logKey}) Invalid token, just end`);
    res.status(200).end();
    return;
  }

  reqBody.message.data = data;
  await dataApi.saveNotifyLog(logKey, PLAYSTORE, token, null, reqBody);

  const verifyResult = await playstore.verifySubscription(
    logKey, null, productId, token,
  );

  const { status, verifyData } = verifyResult;
  if (status !== VALID) {
    res.status(200).end();
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

  console.log(`(${logKey}) /playstore/notify finished`);
  res.status(200).end();
}));

app.options('/paddle/notify', cors(sCorsOptions));
app.post('/paddle/notify', cors(sCorsOptions), runAsyncWrapper(async (req, res) => {
  const logKey = randomString(12);
  console.log(`(${logKey}) /paddle/notify receives a post request`);

  const reqBody = req.body;
  console.log(`(${logKey}) Request body: ${JSON.stringify(reqBody)}`);
  if (!isObject(reqBody) || !reqBody.subscription_id || !reqBody.p_signature) {
    console.log(`(${logKey}) Invalid reqBody, just end`);
    res.status(200).end();
    return;
  }

  const verifyResult = await paddle.verifyNotification(logKey, reqBody);
  if (!verifyResult) {
    console.log(`(${logKey}) verifyResult is false, just end`);
    res.status(200).end();
    return;
  }

  const parsedData = await paddle.parseNotification(logKey, reqBody);
  await dataApi.updatePartialPurchase(
    logKey, PADDLE, null, null, null, parsedData
  );
  console.log(`(${logKey}) Saved to Datastore`);

  console.log(`(${logKey}) /paddle/notify finished`);
  res.status(200).end();
}));

app.options('/paddle/pre', cors(cCorsOptions));
app.post('/paddle/pre', cors(cCorsOptions), runAsyncWrapper(async (req, res) => {
  const logKey = randomString(12);
  console.log(`(${logKey}) /paddle/pre receives a post request`);

  const results = { status: VALID };

  const referrer = getReferrer(req);
  console.log(`(${logKey}) Referrer: ${referrer}`);
  if (!referrer || !ALLOWED_ORIGINS.includes(removeTailingSlash(referrer))) {
    console.log(`(${logKey}) Invalid referrer, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }

  const reqBody = req.body;
  console.log(`(${logKey}) Request body: ${JSON.stringify(reqBody)}`);
  if (!isObject(reqBody)) {
    console.log(`(${logKey}) Invalid reqBody, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }

  const { userId, randomId } = reqBody;
  if (!isString(userId)) {
    console.log(`(${logKey}) Invalid userId, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }
  if (!isString(randomId)) {
    console.log(`(${logKey}) Invalid randomId, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }

  await dataApi.addPaddlePre(logKey, userId, randomId);
  console.log(`(${logKey}) Saved to Datastore`);

  console.log(`(${logKey}) /paddle/pre finished`);
  res.status(200).end();
}));

app.options('/status', cors(cCorsOptions));
app.post('/status', cors(cCorsOptions), runAsyncWrapper(async (req, res) => {
  const logKey = randomString(12);
  console.log(`(${logKey}) /status receives a post request`);

  const results = { status: VALID };

  const referrer = getReferrer(req);
  console.log(`(${logKey}) Referrer: ${referrer}`);
  if (!referrer || !ALLOWED_ORIGINS.includes(removeTailingSlash(referrer))) {
    console.log(`(${logKey}) Invalid referrer, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }

  const reqBody = req.body;
  console.log(`(${logKey}) Request body: ${JSON.stringify(reqBody)}`);
  if (!isObject(reqBody)) {
    console.log(`(${logKey}) Invalid reqBody, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }

  // source and randomId are optional i.e. only from web.
  const { source, userId, signature, appId, doForce, randomId } = reqBody;
  if (!isString(userId)) {
    console.log(`(${logKey}) Invalid userId, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }
  if (!isString(signature)) {
    console.log(`(${logKey}) Invalid signature, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }
  if (!APP_IDS.includes(appId)) {
    console.log(`(${logKey}) Invalid appId, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }

  const verifyResult = verifyECDSA(SIGNED_TEST_STRING, userId, signature);
  if (!verifyResult) {
    console.log(`(${logKey}) Wrong signature, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }

  let purchases = await dataApi.getPurchases(logKey, userId);
  if (source === PADDLE && isString(randomId)) {
    let found = purchases.some(purchase => purchase.randomId === randomId);
    if (!found) {
      const purchasePaddles = await dataApi.getPurchasePaddles(logKey, randomId);
      if (purchasePaddles.length > 0) {
        for (const purchasePaddle of purchasePaddles) {
          await dataApi.addPurchaseUser(logKey, purchasePaddle.purchaseId, userId);
        }

        purchases = await dataApi.getPurchases(logKey, userId);
      }
    }
  }
  purchases = dataApi.filterPurchases(logKey, purchases, appId);

  if (!doForce || purchases.length === 0) {
    results.purchases = dataApi.getNormalizedPurchases(purchases);

    console.log(`(${logKey}) /status finished`);
    res.send(JSON.stringify(results));
    return;
  }

  const statuses = [], updatedPurchases = [];
  for (const purchase of purchases) {
    const { source, productId, token, paddleUserId } = purchase;

    let updatedPurchase;
    if (source === APPSTORE) {
      // token can be null i.e. no verify but notification arrived.
      // should be happen only on App Store
      //   as in notification V2, there's no latestReceipt.
      if (!token) continue;

      const verifyResult = await appstore.verifySubscription(
        logKey, userId, productId, token,
      );

      const { status, latestReceipt, verifyData } = verifyResult;
      if (status !== VALID) {
        statuses.push(status);
        updatedPurchases.push(null);
        continue;
      }

      const parsedData = dataApi.parseData(logKey, APPSTORE, verifyData);
      updatedPurchase = await dataApi.updatePurchase(
        logKey, APPSTORE, null, latestReceipt, parsedData,
      );
      console.log(`(${logKey}) Saved to Datastore`);
    } else if (source === PLAYSTORE) {
      const verifyResult = await playstore.verifySubscription(
        logKey, userId, productId, token,
      );

      const { status, verifyData } = verifyResult;
      if (status !== VALID) {
        statuses.push(status);
        updatedPurchases.push(null);
        continue;
      }

      const parsedData = dataApi.parseData(logKey, PLAYSTORE, verifyData);
      if (verifyData.linkedPurchaseToken) {
        updatedPurchase = await dataApi.invalidatePurchase(
          logKey, PLAYSTORE, productId, token, verifyData.linkedPurchaseToken,
          parsedData,
        );
        console.log(`(${logKey}) Called invalidatePurchase instead of updatePurchase`);
      } else {
        updatedPurchase = await dataApi.updatePurchase(
          logKey, PLAYSTORE, productId, token, parsedData,
        );
      }
      console.log(`(${logKey}) Saved to Datastore`);
    } else if (source === PADDLE) {
      const verifyResult = await paddle.verifySubscription(
        logKey, userId, productId, token, paddleUserId,
      );

      const { status, verifyData } = verifyResult;
      if (status !== VALID) {
        statuses.push(status);
        updatedPurchases.push(null);
        continue;
      }

      const parsedData = dataApi.parsePartialData(logKey, source, verifyData);
      updatedPurchase = await dataApi.updatePartialPurchase(
        logKey, PADDLE, null, null, null, parsedData
      );
      console.log(`(${logKey}) Saved to Datastore`);
    } else if (source === MANUAL) {
      updatedPurchase = purchase;
    } else throw new Error(`(${logKey}) Invalid source: ${source}`);

    statuses.push(VALID);
    updatedPurchases.push(updatedPurchase);
  }

  if (statuses.some(el => el === VALID)) {
    const filteredPurchases = updatedPurchases.filter(el => el !== null);
    results.purchases = dataApi.getNormalizedPurchases(filteredPurchases);
  } else if (statuses.some(el => el === UNKNOWN)) {
    results.status = UNKNOWN;
  } else {
    results.purchases = [];
  }

  console.log(`(${logKey}) /status finished`);
  res.send(JSON.stringify(results));
}));

app.options('/delete-all', cors(cCorsOptions));
app.post('/delete-all', cors(cCorsOptions), runAsyncWrapper(async (req, res) => {
  const logKey = randomString(12);
  console.log(`(${logKey}) /delete-all receives a post request`);

  const results = { status: VALID };

  const referrer = getReferrer(req);
  console.log(`(${logKey}) Referrer: ${referrer}`);
  if (!referrer || !ALLOWED_ORIGINS.includes(removeTailingSlash(referrer))) {
    console.log(`(${logKey}) Invalid referrer, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }

  const reqBody = req.body;
  console.log(`(${logKey}) Request body: ${JSON.stringify(reqBody)}`);
  if (!isObject(reqBody)) {
    console.log(`(${logKey}) Invalid reqBody, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }

  const { userId, signature, appId } = reqBody;
  if (!isString(userId)) {
    console.log(`(${logKey}) Invalid userId, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }
  if (!isString(signature)) {
    console.log(`(${logKey}) Invalid signature, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }
  if (!APP_IDS.includes(appId)) {
    console.log(`(${logKey}) Invalid appId, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }

  const verifyResult = verifyECDSA(SIGNED_TEST_STRING, userId, signature);
  if (!verifyResult) {
    console.log(`(${logKey}) Wrong signature, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }

  await dataApi.deleteAll(logKey, userId, appId);

  console.log(`(${logKey}) /delete-all finished`);
  res.send(JSON.stringify(results));
}));

// Listen to the App Engine-specified port, or 8088 otherwise
const PORT = process.env.PORT || 8088;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
  console.log('Press Ctrl+C to quit.');
});
