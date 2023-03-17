import axios from 'axios';
import crypto from 'crypto';
import { serialize } from 'php-serialize';

import dataApi from './data';
import {
  PADDLE, VALID, INVALID, UNKNOWN, ACTIVE, NO_RENEW, COM_BRACEDOTTO_SUPPORTER,
  COM_JUSTNOTECC_SUPPORTER,
} from './const';
import { isObject } from './utils';
import paddleKeys from './paddle-keys.json' assert { type: 'json' };

const getVendor = (doSandbox) => {
  return doSandbox ? 11185 : 163987;
};

const getAuthCode = (doSandbox) => {
  return doSandbox ? paddleKeys.sandboxAuthCode : paddleKeys.authCode;
};

const getProductId = (product) => {
  if ([46920, 811082].includes(parseInt(product, 10))) {
    return COM_BRACEDOTTO_SUPPORTER;
  }
  if ([].includes(parseInt(product, 10))) {
    return COM_JUSTNOTECC_SUPPORTER;
  }
  return null;
};

const getTransactionsUrl = (doSandbox, userId) => {
  const prefix = doSandbox ? 'sandbox-' : '';
  return `https://${prefix}vendors.paddle.com/api/2.0/user/${userId}/transactions`;
};

const getPaymentsUrl = (doSandbox) => {
  const prefix = doSandbox ? 'sandbox-' : '';
  return `https://${prefix}vendors.paddle.com/api/2.0/subscription/payments`;
};

const getPubKey = (doSandbox) => {
  return doSandbox ? paddleKeys.sandboxPubKey : paddleKeys.pubKey;
}

const getSubscription = (subscriptions, payments) => {
  // a subscription = {
  //   order_id, checkout_id, status, passthrough, product_id, ...
  //   subscription: { ... },
  //   user: { ... },
  //   payment: { ... },
  // };
  // ref: https://developer.paddle.com/api-reference/89c1805d821c2-list-transactions
  //      https://developer.paddle.com/api-reference/80462f27b2011-list-payments

  const subs = [];
  for (const sub of subscriptions) {
    let paymentList = payments[sub.subscription.subscription_id];
    if (!Array.isArray(paymentList) || paymentList.length === 0) continue;

    paymentList = paymentList.map(payment => {
      return { ...payment, payoutDT: (new Date(payment.payout_date)).getTime() };
    });
    paymentList.sort((a, b) => b.payoutDT - a.payoutDT);

    subs.push({ ...sub, payment: paymentList[0] });
  }
  subs.sort((a, b) => b.payment.payoutDT - a.payment.payoutDT);

  for (const status of ['active', 'trialing', 'past_due', 'deleted']) {
    const sub = subs.find(sub => sub.subscription.status === status);
    if (isObject(sub)) return sub;
  }

  return subs.length === 0 ? null : subs[0];
};

const verifySubscription = async (logKey, userId, productId, token, paddleUserId) => {
  let doSandbox, tResult;
  try {
    // Bug Alert! Only 15 transactions max!
    const res = await axios.post(getTransactionsUrl(false, paddleUserId), {
      vendor_id: getVendor(false), vendor_auth_code: getAuthCode(false),
    });
    [doSandbox, tResult] = [false, res.data];

    if (
      isObject(tResult) && isObject(tResult.error) && tResult.error.code === 101
    ) {
      const res = await axios.post(getTransactionsUrl(true, paddleUserId), {
        vendor_id: getVendor(true), vendor_auth_code: getAuthCode(true),
      });
      if (isObject(res.data) && !('error' in res.data)) {
        [doSandbox, tResult] = [true, res.data];
      }
    }
  } catch (error) {
    if (!error.response || !error.response.status) {
      console.log(`(${logKey}) paddle.verifySubscription getTransactions error, return UNKNOWN`);
      return { status: UNKNOWN, verifyData: null };
    }

    console.log(`(${logKey}) paddle.verifySubscription getTransactions error: ${error.response.status}, return UNKNOWN`);
    return { status: UNKNOWN, verifyData: null };
  }

  if (!isObject(tResult)) {
    console.log(`(${logKey}) Should not reach here as no data should throw an error, return UNKNOWN`);
    return { status: UNKNOWN, verifyData: null };
  }
  if ('error' in tResult) {
    console.log(`(${logKey}) paddle.verifySubscription error, return INVALID`, tResult.error);
    return { status: INVALID, verifyData: null };
  }

  await dataApi.saveVerifyLog(logKey, PADDLE, userId, productId, token, tResult);

  let subscriptions = tResult.response;
  if (Array.isArray(subscriptions)) {
    subscriptions = subscriptions.filter(sub => {
      return isObject(sub) && getProductId(sub.product_id) === productId;
    });
  }
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    console.log(`(${logKey}) No subscription found, return INVALID`);
    return { status: INVALID, verifyData: null };
  }

  const doMatch = subscriptions.some(sub => sub.checkout_id === token);
  if (!doMatch) {
    console.log(`(${logKey}) No subscription matches with checkout_id: ${token}, return INVALID`);
    return { status: INVALID, verifyData: null };
  }

  const subIds = [];
  for (const sub of subscriptions) {
    if (subIds.includes(sub.subscription.subscription_id)) continue;
    subIds.push(sub.subscription.subscription_id);
  }

  const payments = {};
  try {
    const res = await Promise.all(subIds.map(subId => {
      return axios.post(getPaymentsUrl(doSandbox), {
        vendor_id: getVendor(doSandbox),
        vendor_auth_code: getAuthCode(doSandbox),
        subscription_id: subId,
      });
    }));
    for (let i = 0; i < subIds.length; i++) {
      const [subId, payment] = [subIds[i], res[i].data];
      if (!isObject(payment) || 'error' in payment) continue;
      payments[subId] = payment.response;
    }
  } catch (error) {
    if (!error.response || !error.response.status) {
      console.log(`(${logKey}) paddle.verifySubscription getPayments error, return UNKNOWN`);
      return { status: UNKNOWN, verifyData: null };
    }

    console.log(`(${logKey}) paddle.verifySubscription getPayments error: ${error.response.status}, return UNKNOWN`);
    return { status: UNKNOWN, verifyData: null };
  }

  const subscription = getSubscription(subscriptions, payments);
  if (!isObject(subscription)) {
    console.log(`(${logKey}) No subscription from getSubscription, return INVALID`);
    return { status: INVALID, verifyData: null };
  }

  const verifyData = {
    ...subscription, productId: getProductId(subscription.product_id),
  };
  console.log(`(${logKey}) verifyData: ${JSON.stringify(verifyData)}`);

  return { status: VALID, verifyData };
};

const verifyNotification = async (logKey, jsonObj) => {
  // ref: github.com/daveagill/verify-paddle-webhook
  const { p_signature: signature, ...otherProps } = jsonObj;

  const sorted = {};
  for (const k of Object.keys(otherProps).sort()) {
    const v = otherProps[k];
    sorted[k] = v == null ? null : v.toString();
  }

  const serialized = serialize(jsonObj);

  const verifier = crypto.createVerify('sha1');
  verifier.update(serialized);
  verifier.end();

  let result = false;
  try {
    result = verifier.verify(getPubKey(false), signature, 'base64');
  } catch (error) {
    console.log(`(${logKey}) paddle.verifyNotification error: ${error}`);
  }
  if (!result) {
    try {
      result = verifier.verify(getPubKey(true), signature, 'base64');
    } catch (error) {
      console.log(`(${logKey}) paddle.verifyNotification sandbox error: ${error}`);
    }
  }
  return result;
};

const parseNotification = async (logKey, reqBody) => {
  const originalOrderId = reqBody.subscription_id + '';
  const purchaseId = dataApi.getPurchaseId(logKey, PADDLE, null, originalOrderId);

  const purchaseData = {};
  if ('subscription_plan_id' in reqBody) {
    purchaseData.productId = getProductId(reqBody.subscription_plan_id);
  }
  if ('order_id' in reqBody) purchaseData.orderId = reqBody.order_id + '';
  if ('checkout_id' in reqBody) purchaseData.token = reqBody.checkout_id;

  let expiryDate;
  if ('cancellation_effective_date' in reqBody) {
    expiryDate = new Date(reqBody.cancellation_effective_date);
  } else if ('next_bill_date' in reqBody) {
    expiryDate = new Date(reqBody.next_bill_date);
  }
  if (expiryDate) {
    let status = dataApi.parseStatus(logKey, PADDLE, {
      subscription: { status: reqBody.status },
      payment: { payoutDT: expiryDate.getTime() },
    });
    if ('cancellation_effective_date' in reqBody && status === ACTIVE) {
      status = NO_RENEW;
    }

    purchaseData.status = status;
    purchaseData.expiryDate = expiryDate;
    purchaseData.endDate = expiryDate;
  }

  if ('user_id' in reqBody) purchaseData.paddleUserId = reqBody.user_id + '';
  if ('passthrough' in reqBody) purchaseData.passthrough = reqBody.passthrough;
  if ('receipt_url' in reqBody) purchaseData.receiptUrl = reqBody.receipt_url;
  if ('update_url' in reqBody) purchaseData.updateUrl = reqBody.update_url;
  if ('cancel_url' in reqBody) purchaseData.cancelUrl = reqBody.cancel_url;

  await dataApi.saveNotifyLog(
    logKey, PADDLE, reqBody.checkout_id || null, originalOrderId, reqBody
  );

  return { purchaseId, purchaseData };
};

const paddle = {
  verifySubscription, verifyNotification, parseNotification,
};
export default paddle;
