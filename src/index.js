// Inpired by https://codelabs.developers.google.com/codelabs/flutter-in-app-purchases#8

import express from 'express';
import cors from 'cors';
import appleReceiptVerify from "node-apple-receipt-verify";

import appstore from './appstore';
import playstore from './playstore';
import {
  ALLOWED_ORIGINS, SOURCES, APPSTORE, PLAYSTORE, PRODUCT_IDS,
  VALID, INVALID, UNKNOWN,
} from './const';
import {
  runAsyncWrapper, randomString, removeTailingSlash, isObject, isString,
} from './utils';

const app = express();
app.use(express.json());

const corsOptions = {
  'origin': ALLOWED_ORIGINS,
}

app.get('/', (_req, res) => {
  res.status(200).send('Welcome to <a href="https://www.stxapps.com">STX Apps</a>\'s server!').end();
});

app.options('/verify', cors(corsOptions));
app.post('/verify', cors(corsOptions), runAsyncWrapper(async (req, res) => {
  const logKey = randomString(12);
  console.log(`(${logKey}) /appstore/verify receives a post request`);

  const results = { status: VALID };

  const referrer = req.get('Referrer');
  console.log(`(${logKey}) Referrer: ${referrer}`);
  if (!referrer || !ALLOWED_ORIGINS.includes(removeTailingSlash(referrer))) {
    console.log(`(${logKey}) Invalid referrer, throw error`);
    throw new Error('Invalid referrer');
  }

  const reqBody = req.body;
  console.log(`(${logKey}) Request body: ${JSON.stringify(reqBody)}`);
  if (!isObject(reqBody)) {
    console.log(`(${logKey}) Invalid req.body, throw error`);
    throw new Error('Invalid request body');
  }

  const { source, userId, productId, token } = reqBody;
  if (!SOURCES.includes(source)) {
    console.log(`(${logKey}) Invalid source, throw error`);
    throw new Error('Invalid source');
  }
  if (!isString(userId)) {
    console.log(`(${logKey}) Invalid userId, throw error`);
    throw new Error('Invalid userId');
  }
  if (!PRODUCT_IDS.includes(productId)) {
    console.log(`(${logKey}) Invalid productId, throw error`);
    throw new Error('Invalid productId');
  }
  if (!isString(token)) {
    console.log(`(${logKey}) Invalid token, throw error`);
    throw new Error('Invalid token');
  }

  if (source === APPSTORE) {
    try {
      const purchasedProducts = await appstore.verifySubscription(productId, token);

      // Acknowledge

    } catch (e) {
      if (e instanceof appleReceiptVerify.EmptyError) {
        // Receipt is valid but it is now empty.
        console.log(`(${logKey}) Invalid verifiedResult's orderId, return INVALID`);
        results.status = INVALID;
        res.send(JSON.stringify(results));
        return;
      }

      // i.e. ServiceUnavailableError
      console.log(`(${logKey}) appstore.verifySubscription errors, return UNKNOWN`);
      results.status = UNKNOWN;
      res.send(JSON.stringify(results));
      return;
    }
  }

  if (source === PLAYSTORE) {
    const verifiedResult = await playstore.verifySubscription(productId, token);
    if (!verifiedResult || !verifiedResult.data || !verifiedResult.data.orderId) {
      if (verifiedResult.code) {

      }

      console.log(`(${logKey}) Invalid verifiedResult's orderId, return INVALID`);
      results.status = INVALID;
      res.send(JSON.stringify(results));
      return;
    }

    const purchasedProducts = verifiedResult.data;
    console.log(`(${logKey}) purchasedProducts: ${JSON.stringify(purchasedProducts)}`);

    // Acknowledge

  }

  addVerification();
  updatePurchase(source, userId, productId, token, purchasedProducts);
  console.log(`(${logKey}) Saved to Datastore`);

  console.log(`(${logKey}) /verify finished: ${JSON.stringify(results)}`);
  res.send(JSON.stringify(results));
}));

app.options('/appstore/notify', cors(corsOptions));
app.post('/appstore/notify', cors(corsOptions), runAsyncWrapper(async (req, res) => {

  // 1. check whether the noti really from the appstore



}));

app.options('/playstore/notify', cors(corsOptions));
app.post('/playstore/notify', cors(corsOptions), runAsyncWrapper(async (req, res) => {

  // 1. check whether the noti really from the appstore

}));

app.options('/status', cors(corsOptions));
app.post('/status', cors(corsOptions), runAsyncWrapper(async (req, res) => {

  // 1. check whether the user making the function call is authenticated
  // request from real user?

  // 

}));

// Listen to the App Engine-specified port, or 8088 otherwise
const PORT = process.env.PORT || 8088;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
  console.log('Press Ctrl+C to quit.');
});
