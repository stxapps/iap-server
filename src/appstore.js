// Inspired by https://github.com/ladeiko/node-apple-receipt-verify
//   and https://github.com/levibostian/dollabill-apple
import dollabillApple from 'dollabill-apple';
import { AppleVerifyReceiptErrorCode } from 'types-apple-iap';

import dataApi from './data';
import { APPSTORE, VALID, INVALID, UNKNOWN } from './const';
import { getAppstoreSecretKey } from './utils';

const verifySubscription = async (logKey, userId, productId, token) => {
  const verifyResult = await dollabillApple.verifyReceipt({
    receipt: token, sharedSecret: getAppstoreSecretKey(productId)
  });
  if (dollabillApple.isFailure(verifyResult)) {
    // @ts-ignore
    const appleErrorCode = verifyResult.appleErrorCode;
    if (!appleErrorCode) {
      console.log(`(${logKey}) appstore.verifySubscription error, return UNKNOWN`);
      return { status: UNKNOWN, latestReceipt: null, verifyData: null };
    }

    if (![
      AppleVerifyReceiptErrorCode.INVALID_RECEIPT_OR_DOWN,
      AppleVerifyReceiptErrorCode.UNAUTHORIZED,
      AppleVerifyReceiptErrorCode.CUSTOMER_NOT_FOUND,
    ].includes(appleErrorCode)) {
      // i.e. ServiceUnavailableError
      console.log(`(${logKey}) appstore.verifySubscription error: ${appleErrorCode}, return UNKNOWN`);
      return { status: UNKNOWN, latestReceipt: null, verifyData: null };
    }

    console.log(`(${logKey}) appstore.verifySubscription error: ${appleErrorCode}, return INVALID`);
    return { status: INVALID, latestReceipt: null, verifyData: null };
  }

  await dataApi.saveVerifyLog(logKey, APPSTORE, userId, productId, token, verifyResult);

  const latestReceipt = verifyResult.latestReceipt;
  console.log(`(${logKey}) latestReceipt: ${latestReceipt}`);
  if (!latestReceipt) {
    console.log(`(${logKey}) No latestReceipt, return INVALID`);
    return { status: INVALID, latestReceipt: null, notifyData: null };
  }

  const subscriptions = verifyResult.autoRenewableSubscriptions;
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    console.log(`(${logKey}) No subscription found, return INVALID`);
    return { status: INVALID, latestReceipt: null, verifyData: null };
  }
  if (subscriptions.length !== 1) {
    console.log(`(${logKey}) Found ${subscriptions.length} subscriptions, use only the first`);
  }

  const verifyData = subscriptions[0];
  console.log(`(${logKey}) verifyData: ${JSON.stringify(verifyData)}`);

  return { status: VALID, latestReceipt, verifyData };
};

const verifyNotification = async (logKey, reqBody) => {
  const notifyResult = dollabillApple.parseServerToServerNotification({
    responseBody: reqBody, sharedSecret: reqBody.password,
  })
  if (dollabillApple.isFailure(notifyResult)) {
    // i.e. NotValidNotification
    console.log(`(${logKey}) Not valid notification, just end`);
    return { status: INVALID, latestReceipt: null, notifyData: null };
  }

  const latestReceipt = notifyResult.latestReceipt;
  console.log(`(${logKey}) latestReceipt: ${latestReceipt}`);
  if (!latestReceipt) {
    console.log(`(${logKey}) No latestReceipt, just end`);
    return { status: INVALID, latestReceipt: null, notifyData: null };
  }

  const subscriptions = notifyResult.autoRenewableSubscriptions;
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    console.log(`(${logKey}) No subscription found, just end`);
    return { status: INVALID, latestReceipt: null, notifyData: null };
  }
  if (subscriptions.length !== 1) {
    console.log(`(${logKey}) Found ${subscriptions.length} subscriptions, use only the first`);
  }

  const notifyData = subscriptions[0];
  console.log(`(${logKey}) notifyData: ${JSON.stringify(notifyData)}`);

  await dataApi.saveNotifyLog(
    logKey, APPSTORE, null, notifyData.originalTransactionId, notifyResult
  );

  return { status: VALID, latestReceipt, notifyData };
};

const appstore = { verifySubscription, verifyNotification };
export default appstore;
