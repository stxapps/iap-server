import axios from 'axios';
import crypto from 'crypto';
import { serialize } from 'php-serialize';

import dataApi from './data';
import {
  PADDLE, VALID, INVALID, UNKNOWN, NO_RENEW, EXPIRED, COM_BRACEDOTTO_SUPPORTER,
  COM_JUSTNOTECC_SUPPORTER,
} from './const';
import { isObject, isString } from './utils';
import paddleKeys from './paddle-keys.json' assert { type: 'json' };

const prodSubscriptionPlans = [], sandboxSubscriptionPlans = [];

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
  if ([46921, 811083].includes(parseInt(product, 10))) {
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

const getSubscriptionPlansUrl = (doSandbox) => {
  const prefix = doSandbox ? 'sandbox-' : '';
  return `https://${prefix}vendors.paddle.com/api/2.0/subscription/plans`;
};

const getPubKey = (doSandbox) => {
  return doSandbox ? paddleKeys.sandboxPubKey : paddleKeys.pubKey;
}

const getSubscription = (subscriptions, payments) => {
  // a subscription = {
  //   order_id, checkout_id, status, passthrough, product_id, ...
  //   subscription: { ... },
  //   user: { ... },
  //   [+]
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

  for (const status of ['active', 'trialing', 'past_due', 'paused', 'deleted']) {
    const sub = subs.find(sub => sub.subscription.status === status);
    if (isObject(sub)) return sub;
  }

  return subs.length === 0 ? null : subs[0];
};

const verifySubscription = async (
  logKey, userId, productId, token, paddleUserId, specificSubscriptionIds = null
) => {
  let doSandbox, tResult;
  try {
    // Bug Alert! Only 15 transactions max!
    const res = await axios.post(getTransactionsUrl(false, paddleUserId), {
      vendor_id: getVendor(false), vendor_auth_code: getAuthCode(false),
    });
    [doSandbox, tResult] = [false, res.data];

    if (
      isObject(tResult) &&
      (
        (isObject(tResult.error) && tResult.error.code === 101) ||
        (Array.isArray(tResult.response) && tResult.response.length === 0)
      )
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

  if (Array.isArray(specificSubscriptionIds)) {
    subscriptions = subscriptions.filter(sub => {
      return specificSubscriptionIds.includes(sub.subscription.subscription_id)
    });
    if (subscriptions.length === 0) {
      console.log(`(${logKey}) No subscription left for specific ids, return INVALID`);
      return { status: INVALID, verifyData: null };
    }
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

  const subscriptionPlans = doSandbox ? sandboxSubscriptionPlans : prodSubscriptionPlans;
  if (subscriptionPlans.length === 0) {
    try {
      const res = await axios.post(getSubscriptionPlansUrl(doSandbox), {
        vendor_id: getVendor(doSandbox),
        vendor_auth_code: getAuthCode(doSandbox),
      });

      const plan = res.data;
      if (isObject(plan) && 'response' in plan) {
        subscriptionPlans.push(...plan.response);
      } else {
        console.log(`(${logKey}) paddle.verifySubscription getSubscriptionPlans error`, plan);
      }
    } catch (error) {
      if (!error.response || !error.response.status) {
        console.log(`(${logKey}) paddle.verifySubscription getSubscriptionPlans error`);
      } else {
        console.log(`(${logKey}) paddle.verifySubscription getSubscriptionPlans error: ${error.response.status}`);
      }
    }
  }

  const subscription = getSubscription(subscriptions, payments);
  if (!isObject(subscription)) {
    console.log(`(${logKey}) No subscription from getSubscription, return INVALID`);
    return { status: INVALID, verifyData: null };
  }

  const subscriptionPlan = subscriptionPlans.find(pd => {
    return pd.id === subscription.product_id;
  });

  const verifyData = {
    ...subscription, productId: getProductId(subscription.product_id), subscriptionPlan,
  };
  console.log(`(${logKey}) verifyData: ${JSON.stringify(verifyData)}`);

  return { status: VALID, verifyData };
};

// developer.paddle.com/webhook-reference/ZG9jOjI1MzUzOTg2-verifying-webhooks
const ksort = (obj) => {
  const keys = Object.keys(obj).sort();
  const sortedObj = {};
  for (const key of keys) {
    sortedObj[key] = obj[key];
  }
  return sortedObj;
};

const validateWebhook = (reqBody, doSandbox) => {
  let jsonObj = { ...reqBody };
  const mySig = Buffer.from(jsonObj.p_signature, 'base64');

  delete jsonObj.p_signature;
  jsonObj = ksort(jsonObj);
  for (const property in jsonObj) {
    if (jsonObj.hasOwnProperty(property) && (typeof jsonObj[property]) !== "string") {
      if (Array.isArray(jsonObj[property])) {
        jsonObj[property] = jsonObj[property].toString();
      } else {
        jsonObj[property] = JSON.stringify(jsonObj[property]);
      }
    }
  }

  const serialized = serialize(jsonObj);

  const verifier = crypto.createVerify('sha1');
  verifier.update(serialized);
  verifier.end();

  const verification = verifier.verify(getPubKey(doSandbox), mySig);
  return verification;
};

const verifyNotification = async (logKey, reqBody) => {
  let result = false;
  try {
    result = validateWebhook(reqBody, false);
  } catch (error) {
    console.log(`(${logKey}) paddle.verifyNotification error: ${error}`);
  }
  if (!result) {
    try {
      result = validateWebhook(reqBody, true);
    } catch (error) {
      console.log(`(${logKey}) paddle.verifyNotification sandbox error: ${error}`, error);
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
  purchaseData.originalOrderId = originalOrderId;

  let expiryDate;
  if ('cancellation_effective_date' in reqBody) {
    expiryDate = new Date(reqBody.cancellation_effective_date);
  } else if ('next_bill_date' in reqBody) {
    expiryDate = new Date(reqBody.next_bill_date);
  }
  if (expiryDate) {
    if ('status' in reqBody) {
      purchaseData.status = dataApi.parseStatus(logKey, PADDLE, {
        subscription: { status: reqBody.status },
      });
      if (purchaseData.status === EXPIRED && expiryDate.getTime() > Date.now()) {
        purchaseData.status = NO_RENEW;
      }
    }
    purchaseData.expiryDate = expiryDate;
    purchaseData.endDate = expiryDate;
  }

  if ('user_id' in reqBody) purchaseData.paddleUserId = reqBody.user_id + '';
  if ('passthrough' in reqBody) {
    try {
      const jsonObj = JSON.parse(reqBody.passthrough);
      if (isString(jsonObj.randomId)) purchaseData.randomId = jsonObj.randomId;
    } catch (error) {
      console.log(`JSON.parse on reqBody.passthrough error: ${error}`);
    }
  }
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
