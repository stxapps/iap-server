// Inspired by https://github.com/ladeiko/node-apple-receipt-verify
//   and https://github.com/levibostian/dollabill-apple
// Verify JWS from App Store Server by github.com/agisboye/app-store-server-api
import * as jose from 'jose';
import { X509Certificate } from 'crypto';
import dollabillApple from 'dollabill-apple';
import { AppleVerifyReceiptErrorCode } from 'types-apple-iap';

import dataApi from './data';
import {
  APPLE_ROOT_CA_G3_FINGERPRINTS, APPSTORE, VALID, INVALID, UNKNOWN,
} from './const';
import { getAppstoreSecretKey, isObject } from './utils';

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

/**
 * Verify a certificate chain provided in the x5c field of a decoded header of a JWS.
 * The certificates must be valid and have come from Apple.
 * @throws {Error} if any of the validation checks fail
 */
const verifyCertificates = (certificates) => {
  if (!Array.isArray(certificates) || certificates.length === 0) {
    throw new Error(`Invalid certificates: ${certificates}`);
  }

  const x509certs = certificates.map(c => new X509Certificate(c));

  // Check dates
  const now = new Date();
  const datesValid = x509certs.every(c => {
    return new Date(c.validFrom) < now && now < new Date(c.validTo);
  });
  if (!datesValid) throw new Error(`Invalid dates in certificates: ${certificates}`);

  // Check that each certificate, except for the last, is issued by the subsequent one.
  if (certificates.length >= 2) {
    for (let i = 0; i < x509certs.length - 1; i++) {
      const subject = x509certs[i];
      const issuer = x509certs[i + 1];
      if (!subject.checkIssued(issuer) || !subject.verify(issuer.publicKey)) {
        throw new Error(`Invalid subsequent in certificates: ${certificates}`);
      }
    }
  }

  // Ensure that the last certificate in the chain is the expected Apple root CA.
  const fingerprint = x509certs[x509certs.length - 1].fingerprint256;
  if (!APPLE_ROOT_CA_G3_FINGERPRINTS.includes(fingerprint)) {
    throw new Error(`Invalid Apple CA in certificates: ${certificates}`);
  }
};

const verifySignedPayload = async (signedPayload) => {
  const getKey = async (protectedHeader, token) => {
    let certs;
    if (isObject(protectedHeader) && Array.isArray(protectedHeader.x5c)) {
      certs = protectedHeader.x5c.map(c => {
        return `-----BEGIN CERTIFICATE-----\n${c}\n-----END CERTIFICATE-----`;
      });
    }

    verifyCertificates(certs)
    return jose.importX509(certs[0], protectedHeader.alg);
  };

  const { payload } = await jose.compactVerify(signedPayload, getKey)
  const decoded = new TextDecoder().decode(payload)
  const json = JSON.parse(decoded)
  return json;
};

const verifyNotification = async (logKey, signedPayload) => {
  const payload = await verifySignedPayload(signedPayload);
  const transactionInfo = await verifySignedPayload(payload.data.signedTransactionInfo);
  const renewalInfo = await verifySignedPayload(payload.data.signedRenewalInfo);

  const latestReceiptInfo = {
    purchase_date_ms: transactionInfo.purchaseDate + '',
    original_purchase_date_ms: transactionInfo.originalPurchaseDate + '',
    transaction_id: transactionInfo.transactionId,
    original_transaction_id: transactionInfo.originalTransactionId,
    expires_date_ms: transactionInfo.expiresDate + '',
    product_id: transactionInfo.productId,
    subscription_group_identifier: transactionInfo.subscriptionGroupIdentifier,
    web_order_line_item_id: transactionInfo.webOrderLineItemId,
    expires_date: (new Date(transactionInfo.expiresDate)).toISOString(),
  }
  if (transactionInfo.isInIntroOfferPeriod) {
    const v = transactionInfo.isInIntroOfferPeriod + '';
    latestReceiptInfo.is_in_intro_offer_period = v;
  }
  if (
    transactionInfo.isTrialPeriod === true ||
    transactionInfo.isTrialPeriod === false
  ) {
    const v = transactionInfo.isTrialPeriod + '';
    latestReceiptInfo.is_trial_period = v;
  }
  if (transactionInfo.revocationDate) {
    const v = transactionInfo.revocationDate + '';
    latestReceiptInfo.cancellation_date_ms = v;
  }
  if (transactionInfo.isUpgraded === true || transactionInfo.isUpgraded === false) {
    const v = transactionInfo.isUpgraded + '';
    latestReceiptInfo.is_upgraded = v;
  }
  if (transactionInfo.revocationReason) {
    const v = transactionInfo.revocationReason + '';
    latestReceiptInfo.cancellation_reason = v;
  }
  if (transactionInfo.offerIdentifier) {
    const v = transactionInfo.offerIdentifier + '';
    latestReceiptInfo.promotional_offer_id = v;
  }
  if (transactionInfo.offerType) {
    const v = transactionInfo.offerType + '';
    latestReceiptInfo.offer_code_ref_name = v;
  }

  const pendingRenewalInfo = {
    original_transaction_id: renewalInfo.originalTransactionId,
    product_id: 'com.bracedotto.supporter',
    auto_renew_status: renewalInfo.autoRenewStatus + '',
    auto_renew_product_id: renewalInfo.autoRenewProductId,
  };
  if (renewalInfo.priceIncreaseStatus) {
    const v = renewalInfo.priceIncreaseStatus + '';
    pendingRenewalInfo.price_consent_status = v;
  }
  if (renewalInfo.expirationIntent) {
    const v = renewalInfo.expirationIntent + '';
    pendingRenewalInfo.expiration_intent = v;
  }
  if (renewalInfo.gracePeriodExpiresDate) {
    const v = renewalInfo.gracePeriodExpiresDate + '';
    pendingRenewalInfo.grace_period_expires_date_ms = v;
  }
  if (
    renewalInfo.isInBillingRetryPeriod === true ||
    renewalInfo.isInBillingRetryPeriod === false
  ) {
    const v = renewalInfo.isInBillingRetryPeriod = '';
    pendingRenewalInfo.is_in_billing_retry_period = v;
  }

  const verifyResult = {
    unified_receipt: {
      latest_receipt_info: [latestReceiptInfo],
      pending_renewal_info: [pendingRenewalInfo],
      environment: payload.data.environment,
      latest_receipt: null,
    },
    password: 'password',
    bid: payload.data.bundleId,
    bvrs: payload.data.bundleVersion,
    notification_type: payload.notificationType,
  };

  return verifyResult;
};

const parseNotification = async (logKey, reqBody) => {
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

const appstore = { verifySubscription, verifyNotification, parseNotification };
export default appstore;
