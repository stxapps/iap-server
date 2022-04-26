// Inspired by https://github.com/Deishelon/google-play-billing-validator
//             https://stackoverflow.com/questions/62054043/what-is-the-best-way-to-access-google-play-developers-api-with-node-js
import { google } from 'googleapis';

import dataApi from './data';
import {
  PLAYSTORE, VALID, INVALID, UNKNOWN, NO_ACK, DONE_ACK, CANT_ACK,
} from './const';
import { getAppId, sleep } from './utils';

const androidPublisher = google.androidpublisher('v3');
let didBindAuthClient = false;

const bindAuthClient = async () => {
  const auth = new google.auth.GoogleAuth({
    keyFile: 'src/playstore-service-account.json',
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const authClient = await auth.getClient();
  google.options({ auth: authClient });

  didBindAuthClient = true;
};
bindAuthClient();

const initAuthClient = async () => {
  let waits = [200, 500, 1000, 1500, 2000, 2500, 3000];
  for (const wait of waits) {
    if (didBindAuthClient) return true;
    await sleep(wait);
  }
  return didBindAuthClient;
};

const verifySubscription = async (logKey, userId, productId, token) => {
  const initResult = await initAuthClient();
  if (!initResult) {
    console.log(`(${logKey}) In playstore, auth client can't be inited, return UNKNOWN`);
    return { status: UNKNOWN, verifyData: null };
  }

  let verifyResult = null;
  try {
    verifyResult = await androidPublisher.purchases.subscriptions.get({
      packageName: getAppId(productId),
      subscriptionId: productId,
      token,
    });
  } catch (e) {
    if (!e.response || !e.response.status) {
      console.log(`(${logKey}) playstore.verifySubscription error, return UNKNOWN`);
      return { status: UNKNOWN, verifyData: null };
    }

    if (![400, 410].includes(e.response.status)) {
      // i.e. ServiceUnavailableError
      console.log(`(${logKey}) playstore.verifySubscription error: ${e.response.status}, return UNKNOWN`);
      return { status: UNKNOWN, verifyData: null };
    }

    console.log(`(${logKey}) playstore.verifySubscription error: ${e.response.status}, return INVALID`);
    return { status: INVALID, verifyData: null };
  }

  if (!verifyResult || !verifyResult.data) {
    console.log(`(${logKey}) Should not reach here as no data should throw an error, return UNKNOWN`);
    return { status: UNKNOWN, verifyData: null };
  }
  await dataApi.saveVerifyLog(
    logKey, PLAYSTORE, userId, productId, token, verifyResult
  );

  const verifyData = verifyResult.data;
  console.log(`(${logKey}) verifyData: ${JSON.stringify(verifyData)}`);

  let ackResult = NO_ACK;
  if (verifyData.acknowledgementState === 0 && verifyData.paymentState !== 0) {
    try {
      await androidPublisher.purchases.subscriptions.acknowledge({
        packageName: getAppId(productId),
        subscriptionId: productId,
        token,
      });
      ackResult = DONE_ACK;
      console.log(`(${logKey}) Completed acknowledgement`);
    } catch (e) {
      if (!e.response || !e.response.status) {
        console.log(`(${logKey}) acknowledgement error`);
        ackResult = CANT_ACK;
      } else {
        console.log(`(${logKey}) acknowledgement error: ${e.response.status}`);
        ackResult = `${CANT_ACK}_${e.response.status}`;
      }
    }
  }
  await dataApi.saveAcknowledgeLog(
    logKey, userId, productId, token, verifyData.acknowledgementState,
    verifyData.paymentState, ackResult,
  );

  return { status: VALID, verifyData };
};

const playstore = { verifySubscription };
export default playstore;
