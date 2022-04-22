// Inpired by https://codelabs.developers.google.com/codelabs/flutter-in-app-purchases#8
import express from 'express';
import cors from 'cors';
import dollabillApple from 'dollabill-apple';
import { AppleVerifyReceiptErrorCode } from 'types-apple-iap';

import appstore from './appstore';
import playstore from './playstore';
import dataApi from './data';
import {
  ALLOWED_ORIGINS, SOURCES, APPSTORE, PLAYSTORE, PRODUCT_IDS, APP_IDS,
  VALID, INVALID, UNKNOWN, ERROR,
} from './const';
import {
  runAsyncWrapper, randomString, removeTailingSlash, isObject, isString,
  getAppId,
} from './utils';
import appstoreKeys from './appstore-keys.json';

const app = express();
app.use(express.json());

const cCorsOptions = {
  'origin': ALLOWED_ORIGINS,
}
const sCorsOptions = {
  'origin': '*',
}

app.get('/', (_req, res) => {
  res.send('Welcome to <a href="https://www.stxapps.com">STX Apps</a>\'s server!');
});

app.options('/verify', cors(cCorsOptions));
app.post('/verify', cors(cCorsOptions), runAsyncWrapper(async (req, res) => {
  const logKey = randomString(12);
  console.log(`(${logKey}) /appstore/verify receives a post request`);

  const results = { status: VALID };

  const referrer = req.get('Referrer');
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

  const { source, userId, productId, token } = reqBody;
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

  let verifyData = null;

  if (source === APPSTORE) {
    const verifyResult = await appstore.verifySubscription(productId, token);
    if (dollabillApple.isFailure(verifyResult)) {
      // @ts-ignore
      const appleErrorCode = verifyResult.appleErrorCode;
      if (!appleErrorCode || ![
        AppleVerifyReceiptErrorCode.INVALID_RECEIPT_OR_DOWN,
        AppleVerifyReceiptErrorCode.CUSTOMER_NOT_FOUND,
      ].includes(appleErrorCode)) {
        // i.e. ServiceUnavailableError
        console.log(`(${logKey}) appstore.verifySubscription errors, return UNKNOWN`);
        results.status = UNKNOWN;
        res.send(JSON.stringify(results));
        return;
      }

      console.log(`(${logKey}) verifyResult is failure, return INVALID`);
      results.status = INVALID;
      res.send(JSON.stringify(results));
      return;
    }
    await dataApi.saveVerifyLog(logKey, source, userId, productId, token, verifyResult);

    const subscriptions = verifyResult.autoRenewableSubscriptions;
    if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
      console.log(`(${logKey}) No subscription found, return INVALID`);
      results.status = INVALID;
      res.send(JSON.stringify(results));
      return;
    }
    if (subscriptions.length !== 1) {
      console.log(`(${logKey}) Found too many subscriptions, use only the first`);
    }

    verifyData = subscriptions[0];
    console.log(`(${logKey}) verifyData: ${JSON.stringify(verifyData)}`);

    // Acknowledge

  }

  if (source === PLAYSTORE) {
    const verifyResult = await playstore.verifySubscription(productId, token);
    if (!verifyResult || !verifyResult.data || !verifyResult.data.orderId) {
      if (verifyResult.status < 200 || verifyResult.status > 299) {
        // i.e. ServiceUnavailableError
        console.log(`(${logKey}) Server responses ${verifyResult.status}, return UNKNOWN`);
        results.status = UNKNOWN;
        res.send(JSON.stringify(results));
        return;
      }

      console.log(`(${logKey}) No orderId in verifyResult, return INVALID`);
      results.status = INVALID;
      res.send(JSON.stringify(results));
      return;
    }
    await dataApi.saveVerifyLog(logKey, source, userId, productId, token, verifyResult);

    verifyData = verifyResult.data;
    console.log(`(${logKey}) verifyData: ${JSON.stringify(verifyData)}`);

    // Acknowledge
    if (verifyData.acknowledgementState === 0) {

    }
  }

  await dataApi.addPurchase(
    logKey, source, userId, productId, token,
    dataApi.parseData(logKey, source, verifyData)
  );
  console.log(`(${logKey}) Saved to Datastore`);

  console.log(`(${logKey}) /verify finished`);
  res.send(JSON.stringify(results));
}));

app.options('/appstore/notify', cors(sCorsOptions));
app.post('/appstore/notify', cors(sCorsOptions), runAsyncWrapper(async (req, res) => {
  const logKey = randomString(12);
  console.log(`(${logKey}) /appstore/notify receives a post request`);

  const reqBody = req.body;
  console.log(`(${logKey}) Request body: ${JSON.stringify(reqBody)}`);
  if (!isObject(reqBody)) {
    console.log(`(${logKey}) Invalid reqBody, just end`);
    res.status(200).end();
    return;
  }

  if (![
    appstoreKeys['secretKeyBracedotto'], appstoreKeys['secretKeyJustnotecc'],
  ].includes(reqBody.password)) {
    console.log(`(${logKey}) Secret key not matched, just end`);
    res.status(200).end();
    return;
  }

  const notifyResult = dollabillApple.parseServerToServerNotification({
    responseBody: reqBody, sharedSecret: reqBody.password,
  })
  if (dollabillApple.isFailure(notifyResult)) {
    // i.e. NotValidNotification
    console.log(`(${logKey}) Not valid notification, just end`);
    res.status(200).end();
    return;
  }
  await dataApi.saveNotifyLog(
    logKey, APPSTORE, notifyResult.latestReceipt, notifyResult,
  );

  const subscriptions = notifyResult.autoRenewableSubscriptions;
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    console.log(`(${logKey}) No subscription found, just end`);
    res.status(200).end();
    return;
  }
  if (subscriptions.length !== 1) {
    console.log(`(${logKey}) Found too many subscriptions, use only the first`);
  }

  const notifyData = subscriptions[0];
  console.log(`(${logKey}) notifyData: ${JSON.stringify(notifyData)}`);

  // Acknowledge




  await dataApi.updatePurchase(
    logKey, APPSTORE, null, notifyResult.latestReceipt,
    dataApi.parseData(logKey, APPSTORE, notifyData)
  );
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
  if (!isObject(reqBody) || !reqBody.subscription || !reqBody.message) {
    console.log(`(${logKey}) Invalid reqBody, just end`);
    res.status(200).end();
    return;
  }

  let data;
  try {
    const _data = Buffer.from(reqBody.message.data, 'base64').toString('ascii');
    data = JSON.parse(_data);
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

  if (!data.subscriptionNotification || !isObject(data.subscriptionNotification)) {
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
  await dataApi.saveNotifyLog(logKey, PLAYSTORE, token, reqBody);

  const verifyResult = await playstore.verifySubscription(productId, token);
  if (!verifyResult || !verifyResult.data || !verifyResult.data.orderId) {
    if (verifyResult.status < 200 || verifyResult.status > 299) {
      // i.e. ServiceUnavailableError
      console.log(`(${logKey}) Server responses ${verifyResult.status}, just end`);
      res.status(200).end();
      return;
    }

    console.log(`(${logKey}) No orderId in verifyResult, just end`);
    res.status(200).end();
    return;
  }
  await dataApi.saveVerifyLog(logKey, PLAYSTORE, null, productId, token, verifyResult);

  const verifyData = verifyResult.data;
  console.log(`(${logKey}) verifyData: ${JSON.stringify(verifyData)}`);

  // Acknowledge
  if (verifyData.acknowledgementState === 0) {

  }

  // Invalidate or update!!!
  if (verifyData.linkedPurchaseToken) {

  } else {
    await dataApi.updatePurchase(
      logKey, PLAYSTORE, productId, token,
      dataApi.parseData(logKey, PLAYSTORE, verifyData)
    );
  }
  console.log(`(${logKey}) Saved to Datastore`);

  console.log(`(${logKey}) /playstore/notify finished`);
  res.status(200).end();
}));

app.options('/status', cors(cCorsOptions));
app.post('/status', cors(cCorsOptions), runAsyncWrapper(async (req, res) => {
  const logKey = randomString(12);
  console.log(`(${logKey}) /status receives a post request`);

  const results = { status: VALID };

  const referrer = req.get('Referrer');
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

  const { source, userId, appId } = reqBody;
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
  if (!APP_IDS.includes(appId)) {
    console.log(`(${logKey}) Invalid appId, return ERROR`);
    results.status = ERROR;
    res.send(JSON.stringify(results));
    return;
  }

  // 1. check whether the user making the function call is authenticated
  // request from real user?


  // 
  const purchases = await dataApi.getPurchases(userId);
  results.purchases = purchases.filter(purchase => {
    return getAppId(purchase.productId) === appId;
  });

  // If isForce,

  res.send(JSON.stringify(results));
}));

// Listen to the App Engine-specified port, or 8088 otherwise
const PORT = process.env.PORT || 8088;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
  console.log('Press Ctrl+C to quit.');
});
