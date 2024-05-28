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

  payload.data.transactionInfo = transactionInfo;
  payload.data.renewalInfo = renewalInfo;

  delete payload.data.signedTransactionInfo;
  delete payload.data.signedRenewalInfo;

  return payload;
};

const derivePayloadV1 = (payloadV2) => {
  const { transactionInfo, renewalInfo } = payloadV2.data;

  const latestReceiptInfo = {
    transaction_id: transactionInfo.transactionId + '',
    original_transaction_id: transactionInfo.originalTransactionId + '',
    purchase_date_ms: transactionInfo.purchaseDate + '',
    original_purchase_date_ms: transactionInfo.originalPurchaseDate + '',
    product_id: transactionInfo.productId + '',
    subscription_group_identifier: transactionInfo.subscriptionGroupIdentifier + '',
    web_order_line_item_id: transactionInfo.webOrderLineItemId + '',
    expires_date: (new Date(transactionInfo.expiresDate)).toISOString() + '',
    expires_date_ms: transactionInfo.expiresDate + '',
  }
  if ('offerType' in transactionInfo) {
    if (transactionInfo.offerType === 1) {
      latestReceiptInfo.is_in_intro_offer_period = true + '';
      // In V2, intro offer can be free as trial period
      //latestReceiptInfo.is_trial_period = true + '';
    } else {
      const v = transactionInfo.offerType + '';
      latestReceiptInfo.offer_code_ref_name = v;
    }
  }
  if ('offerIdentifier' in transactionInfo) {
    const v = transactionInfo.offerIdentifier + '';
    latestReceiptInfo.promotional_offer_id = v;
  }
  if ('isUpgraded' in transactionInfo) {
    const v = transactionInfo.isUpgraded + '';
    latestReceiptInfo.is_upgraded = v;
  }
  if ('revocationDate' in transactionInfo) {
    const v = transactionInfo.revocationDate + '';
    latestReceiptInfo.cancellation_date_ms = v;
  }
  if ('revocationReason' in transactionInfo) {
    const v = transactionInfo.revocationReason + '';
    latestReceiptInfo.cancellation_reason = v;
  }

  const pendingRenewalInfo = {
    auto_renew_product_id: renewalInfo.autoRenewProductId + '',
    auto_renew_status: renewalInfo.autoRenewStatus + '',
    original_transaction_id: renewalInfo.originalTransactionId + '',
  };
  if ('gracePeriodExpiresDate' in renewalInfo) {
    const v = renewalInfo.gracePeriodExpiresDate + '';
    pendingRenewalInfo.grace_period_expires_date_ms = v;
  }
  if ('isInBillingRetryPeriod' in renewalInfo) {
    const v = renewalInfo.isInBillingRetryPeriod ? '1' : '0';
    pendingRenewalInfo.is_in_billing_retry_period = v;
  }
  if ('expirationIntent' in renewalInfo) {
    const v = renewalInfo.expirationIntent + '';
    pendingRenewalInfo.expiration_intent = v;
  }
  if ('priceIncreaseStatus' in renewalInfo) {
    const v = renewalInfo.priceIncreaseStatus + '';
    pendingRenewalInfo.price_consent_status = v;
  }

  const payloadV1 = {
    unified_receipt: {
      latest_receipt_info: [latestReceiptInfo],
      pending_renewal_info: [pendingRenewalInfo],
      environment: payloadV2.data.environment + '',
      latest_receipt: null,
    },
    password: 'password',
    bid: payloadV2.data.bundleId + '',
    bvrs: payloadV2.data.bundleVersion + '',
    notification_type: payloadV2.notificationType + '',
  };

  return payloadV1;
};

const parseNotification = async (logKey, reqBody) => {
  const notifyResult = dollabillApple.parseServerToServerNotification({
    responseBody: reqBody, sharedSecret: reqBody.password,
  })
  if (dollabillApple.isFailure(notifyResult)) {
    // i.e. NotValidNotification
    console.log(`(${logKey}) Not valid notification, just end`);
    return { status: INVALID, notifyData: null };
  }

  const subscriptions = notifyResult.autoRenewableSubscriptions;
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    console.log(`(${logKey}) No subscription found, just end`);
    return { status: INVALID, notifyData: null };
  }
  if (subscriptions.length !== 1) {
    console.log(`(${logKey}) Found ${subscriptions.length} subscriptions, use only the first`);
  }

  const notifyData = subscriptions[0];
  console.log(`(${logKey}) notifyData: ${JSON.stringify(notifyData)}`);

  await dataApi.saveNotifyLog(
    logKey, APPSTORE, null, notifyData.originalTransactionId, notifyResult
  );

  return { status: VALID, notifyData };
};

const appstore = {
  verifySubscription, verifyNotification, derivePayloadV1, parseNotification,
};
export default appstore;
