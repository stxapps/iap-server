// Inpired by https://codelabs.developers.google.com/codelabs/flutter-in-app-purchases#8
import express from 'express';
import cors from 'cors';
import dollabillApple from 'dollabill-apple';
import { AppleVerifyReceiptErrorCode } from 'types-apple-iap';

import appstore from './appstore';
import playstore from './playstore';
import {
  ALLOWED_ORIGINS, SOURCES, APPSTORE, PLAYSTORE, PRODUCT_IDS,
  VALID, INVALID, UNKNOWN, ERROR,
} from './const';
import {
  runAsyncWrapper, randomString, removeTailingSlash, isObject, isString,
} from './utils';
import appstoreKeys from './appstore-keys.json';

const app = express();
app.use(express.json());

const corsOptions = {
  'origin': ALLOWED_ORIGINS,
}

app.get('/', (_req, res) => {
  res.send('Welcome to <a href="https://www.stxapps.com">STX Apps</a>\'s server!');
});

app.options('/verify', cors(corsOptions));
app.post('/verify', cors(corsOptions), runAsyncWrapper(async (req, res) => {
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
    console.log(`(${logKey}) Invalid req.body, return ERROR`);
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

  let purchasedProducts = [];

  if (source === APPSTORE) {
    const verifiedResult = await appstore.verifySubscription(productId, token);
    if (dollabillApple.isFailure(verifiedResult)) {
      if (![
        AppleVerifyReceiptErrorCode.INVALID_RECEIPT_OR_DOWN,
        AppleVerifyReceiptErrorCode.CUSTOMER_NOT_FOUND,
      ].includes(verifiedResult.code)) {
        // i.e. ServiceUnavailableError
        console.log(`(${logKey}) appstore.verifySubscription errors, return UNKNOWN`);
        results.status = UNKNOWN;
        res.send(JSON.stringify(results));
        return;
      }

      console.log(`(${logKey}) verifiedResult is failure, return INVALID`);
      results.status = INVALID;
      res.send(JSON.stringify(results));
      return;
    }

    purchasedProducts = [verifiedResult.autoRenewableSubscriptions];
    console.log(`(${logKey}) purchasedProducts: ${JSON.stringify(purchasedProducts)}`);

    // Acknowledge

  }

  if (source === PLAYSTORE) {
    const verifiedResult = await playstore.verifySubscription(productId, token);
    if (!verifiedResult || !verifiedResult.data || !verifiedResult.data.orderId) {
      if (verifiedResult.statusCode < 200 || verifiedResult.statusCode > 299) {
        // i.e. ServiceUnavailableError
        console.log(`(${logKey}) Server responses ${verifiedResult.statusCode}, return UNKNOWN`);
        results.status = UNKNOWN;
        res.send(JSON.stringify(results));
        return;
      }

      console.log(`(${logKey}) No orderId in verifiedResult, return INVALID`);
      results.status = INVALID;
      res.send(JSON.stringify(results));
      return;
    }

    purchasedProducts = [verifiedResult.data];
    console.log(`(${logKey}) purchasedProducts: ${JSON.stringify(purchasedProducts)}`);

    // Acknowledge

  }

  addVerification(logKey,);
  updatePurchase(logKey, source, userId, productId, token, purchasedProducts);
  console.log(`(${logKey}) Saved to Datastore`);

  console.log(`(${logKey}) /verify finished`);
  res.send(JSON.stringify(results));
}));

app.options('/appstore/notify', cors(corsOptions));
app.post('/appstore/notify', cors(corsOptions), runAsyncWrapper(async (req, res) => {
  const logKey = randomString(12);
  console.log(`(${logKey}) /appstore/notify receives a post request`);

  const reqBody = req.body;
  console.log(`(${logKey}) Request body: ${JSON.stringify(reqBody)}`);

  if (![
    appstoreKeys['secretKeyBracedotto'], appstoreKeys['secretKeyJustnotecc'],
  ].includes(reqBody.password)) {
    console.log(`(${logKey}) Secret key not matched, just end`);
    res.status(200).end();
    return;
  }

  const parsedResult = dollabillApple.parseServerToServerNotification({
    responseBody: reqBody, sharedSecret: reqBody.password,
  })
  if (isFailure(parsedResult)) {

  }

  res.status(200).end();
}));

app.options('/playstore/notify', cors(corsOptions));
app.post('/playstore/notify', cors(corsOptions), runAsyncWrapper(async (req, res) => {
  const logKey = randomString(12);
  console.log(`(${logKey}) /playstore/notify receives a post request`);

  const reqBody = req.body;
  console.log(`(${logKey}) Request body: ${JSON.stringify(reqBody)}`);
  if (!reqBody.subscription || !reqBody.message) {
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

  if (!data.subscriptionNotification) {
    console.log(`(${logKey}) No subscriptionNotification, just end`);
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

  addNotification(logKey, reqBody, data);

  const verifiedResult = await playstore.verifySubscription(productId, token);
  if (!verifiedResult || !verifiedResult.data || !verifiedResult.data.orderId) {
    if (verifiedResult.statusCode < 200 || verifiedResult.statusCode > 299) {
      // i.e. ServiceUnavailableError
      console.log(`(${logKey}) Server responses ${verifiedResult.statusCode}, just end`);
      res.status(200).end();
      return;
    }

    console.log(`(${logKey}) No orderId in verifiedResult, just end`);
    res.status(200).end();
    return;
  }

  const purchasedProducts = [verifiedResult.data];
  console.log(`(${logKey}) purchasedProducts: ${JSON.stringify(purchasedProducts)}`);

  // Acknowledge


  addVerification(logKey,);
  updatePurchase(logKey, source, userId, productId, token, purchasedProducts);
  console.log(`(${logKey}) Saved to Datastore`);

  console.log(`(${logKey}) /playstore/notify finished`);
  res.status(200).end();
}));

app.options('/status', cors(corsOptions));
app.post('/status', cors(corsOptions), runAsyncWrapper(async (req, res) => {

  // 1. check whether the user making the function call is authenticated
  // request from real user?

  // 

  res.status(200).end();
}));

// Listen to the App Engine-specified port, or 8088 otherwise
const PORT = process.env.PORT || 8088;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
  console.log('Press Ctrl+C to quit.');
});
