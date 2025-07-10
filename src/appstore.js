// Inspired by https://github.com/ladeiko/node-apple-receipt-verify
//   and https://github.com/levibostian/dollabill-apple
// Verify JWS from App Store Server by github.com/agisboye/app-store-server-api
import * as jose from 'jose';
import { X509Certificate, randomUUID } from 'crypto';
import dollabillApple from 'dollabill-apple';
import { AppleVerifyReceiptErrorCode } from 'types-apple-iap';

import dataApi from './data';
import {
  APPLE_ROOT_CA_G3_FINGERPRINTS, APPSTORE, VALID, INVALID, UNKNOWN,
} from './const';
import {
  getBundleId, getAppstoreSecretKey, getAppstoreInfo, isObject, isFldStr,
} from './utils';

const verifySubscriptionOld = async (logKey, userId, productId, token) => {
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

const getAuthToken = async (issuerId, keyId, privateKey, bundleId) => {
  const privateKeyObj = await jose.importPKCS8(privateKey, 'ES256');
  const payload = { bid: bundleId, nonce: randomUUID() };
  const expirySeconds = Math.floor((Date.now() / 1000) + 3599); // must within 1 hour

  const token = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: 'JWT' })
    .setIssuer(issuerId)
    .setIssuedAt()
    .setExpirationTime(expirySeconds)
    .setAudience('appstoreconnect-v1')
    .sign(privateKeyObj);

  return token;
};

const getSubsUrl = (doSandbox, id) => {
  let base = 'https://api.storekit.itunes.apple.com';
  if (doSandbox) base = 'https://api.storekit-sandbox.itunes.apple.com';
  return `${base}/inApps/v1/subscriptions/${id}`;
};

const getSubs = async (productId, transactionId) => {
  const { issuerId, keyId, privateKey } = getAppstoreInfo();
  const bundleId = getBundleId(productId);
  const authToken = await getAuthToken(issuerId, keyId, privateKey, bundleId);

  let res = await fetch(getSubsUrl(false, transactionId), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  });
  let data = await res.json();
  if (res.ok) return data;

  if (res.status === 404 && data.errorCode === 4040010) {
    res = await fetch(getSubsUrl(true, transactionId), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    });
    data = await res.json();
    if (res.ok) return data;
  }

  let bodyText = `${data.errorCode}`;
  if (isFldStr(data.errorMessage)) bodyText += ' ' + data.errorMessage;

  let msg = `${res.status}`;
  if (isFldStr(res.statusText)) msg += ' ' + res.statusText;
  if (isFldStr(bodyText)) msg += ' ' + bodyText;
  throw new Error(msg);
};

const verifySubscriptionNew = async (logKey, userId, productId, token) => {
  let transactionId;
  try {
    const payload = await verifySignedPayload(token);
    transactionId = payload.transactionId;
  } catch (error) {
    console.log(`(${logKey}) appstore.verifySubscription verifySignedPayload error, return INVALID`, error);
    return { status: INVALID, latestReceipt: null, verifyData: null };
  }
  if (!isFldStr(transactionId)) {
    console.log(`(${logKey}) appstore.verifySubscription no transactionId, return INVALID`);
    return { status: INVALID, latestReceipt: null, verifyData: null };
  }

  let tResult;
  try {
    tResult = await getSubs(productId, transactionId);
  } catch (error) {
    console.log(`(${logKey}) appstore.verifySubscription getSubs error, return UNKNOWN`, error);
    return { status: UNKNOWN, latestReceipt: null, verifyData: null };
  }
  if (!tResult) {
    console.log(`(${logKey}) Should not reach here as no data should throw an error, return UNKNOWN`);
    return { status: UNKNOWN, latestReceipt: null, verifyData: null };
  }
  if ('errorCode' in tResult) {
    console.log(`(${logKey}) Should not reach here as error should be catched, return UNKNOWN`, tResult);
    return { status: UNKNOWN, latestReceipt: null, verifyData: null };
  }

  await dataApi.saveVerifyLog(logKey, APPSTORE, userId, productId, token, tResult);

  let verifyData;
  try {
    const lastTransaction = tResult.data[0].lastTransactions[0];
    const transactionInfo = jose.decodeJwt(lastTransaction.signedTransactionInfo);
    const renewalInfo = jose.decodeJwt(lastTransaction.signedRenewalInfo);

    const payloadV2 = {
      data: {
        environment: transactionInfo.environment,
        bundleId: transactionInfo.bundleId,
        bundleVersion: '',
        transactionInfo,
        renewalInfo
      },
      notificationType: '',
    };
    const payloadV1 = /** @type any */(derivePayloadV1(payloadV2));
    const pResult = dollabillApple.parseServerToServerNotification({
      responseBody: payloadV1, sharedSecret: payloadV1.password,
    })
    if (dollabillApple.isFailure(pResult)) {
      console.log(`(${logKey}) appstore.verifySubscription invalid pResult, return INVALID`, pResult);
      return { status: INVALID, latestReceipt: null, verifyData: null };
    }

    const subscriptions = pResult.autoRenewableSubscriptions;
    if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
      console.log(`(${logKey}) appstore.verifySubscription no subscription, return INVALID`, pResult);
      return { status: INVALID, latestReceipt: null, verifyData: null };
    }
    if (subscriptions.length !== 1) {
      console.log(`(${logKey}) Found ${subscriptions.length} subscriptions, use only the first`);
    }

    verifyData = subscriptions[0];
  } catch (error) {
    console.log(`(${logKey}) appstore.verifySubscription parse error, return INVALID`, error);
    return { status: INVALID, latestReceipt: null, verifyData: null };
  }

  return { status: VALID, latestReceipt: token, verifyData };
}

const isJWS = (token) => {
  return token.split('.').length === 3;
};

const verifySubscription = async (logKey, userId, productId, token) => {
  let res;
  if (isJWS(token)) {
    res = await verifySubscriptionNew(logKey, userId, productId, token);
  } else {
    res = await verifySubscriptionOld(logKey, userId, productId, token);
  }
  return res;
}

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
